// Sprint 0, story S0-4: the knowledge base lives in the database.
// Test numbers refer to docs/refinement/sprint-0.md (S0-4).
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

interface Entry { question: string; answer: string; tags: string[]; source: string }
interface ImportResult { inserted: number; duplicates: number; invalid: number }

// The synthetic 100-question file shipped with the repo, mapped as the import screen maps it.
const csv = Papa.parse<Record<string, string>>(
  readFileSync(new URL('../../../sample-data/security-qa.csv', import.meta.url), 'utf8'),
  { header: true, skipEmptyLines: true },
).data;
const securityQA: Entry[] = csv.map((r) => ({
  question: r.question,
  answer: r.answer,
  tags: r.tags.split(',').map((t) => t.trim()).filter(Boolean),
  source: r.source,
}));

let admin: TestUser;
let member: TestUser;

const importAs = (user: TestUser | null, entries: unknown, origin = 'import', ref = 'security-qa.csv') =>
  (q: Parameters<Parameters<typeof as>[1]>[0]) =>
    q<{ r: ImportResult }>('SELECT import_kb_entries($1::jsonb, $2::kb_origin, $3) AS r', [
      JSON.stringify(entries), origin, ref,
    ]).then((res) => res.rows[0].r);

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true });
  member = await createUser();
});
afterAll(closePool);

describe('import_kb_entries', () => {
  it('1. imports the 100 synthetic security Q&As with their source, origin and importer', async () => {
    await as(member, async (q) => {
      const r = await importAs(member, securityQA)(q);
      expect(r).toEqual({ inserted: 100, duplicates: 0, invalid: 0 });
      const rows = await q<{ source: string; origin: string; origin_ref: string; created_by: string; ref: string }>(
        `SELECT source, origin, origin_ref, created_by, ref FROM kb_entries ORDER BY seq LIMIT 1`,
      );
      expect(rows.rows[0]).toEqual({
        source: 'Data Protection Policy v3.1',
        origin: 'import',
        origin_ref: 'security-qa.csv',
        created_by: member.id,
        ref: expect.stringMatching(/^KB-\d{4}$/),
      });
    });
  });

  it('3. importing the same file twice adds nothing the second time', async () => {
    await as(member, async (q) => {
      await importAs(member, securityQA)(q);
      const again = await importAs(member, securityQA)(q);
      expect(again).toEqual({ inserted: 0, duplicates: 100, invalid: 0 });
    });
  });

  it('3b. duplicates are matched ignoring case and spacing, including within one file', async () => {
    await as(member, async (q) => {
      const r = await importAs(member, [
        { question: 'Do you use MFA?', answer: 'Yes, for all staff.', tags: [], source: '' },
        { question: '  do you   use mfa? ', answer: 'Yes.', tags: [], source: '' },
      ])(q);
      expect(r).toEqual({ inserted: 1, duplicates: 1, invalid: 0 });
    });
  });

  it('4. a row with no answer is skipped and counted; the rest are imported', async () => {
    await as(member, async (q) => {
      const r = await importAs(member, [
        { question: 'Q with answer?', answer: 'An answer.', tags: [], source: '' },
        { question: 'Q without answer?', answer: '   ', tags: [], source: '' },
        { question: '', answer: 'Answer without question', tags: [], source: '' },
      ])(q);
      expect(r).toEqual({ inserted: 1, duplicates: 0, invalid: 2 });
    });
  });

  it('5. an import is all or nothing: a failure saves no rows', async () => {
    await as(member, async (q) => {
      // tags must be an array of strings; an object makes the whole call fail.
      await refused(importAs(member, [
        { question: 'Fine?', answer: 'Fine.', tags: [], source: '' },
        { question: 'Broken?', answer: 'Broken.', tags: { not: 'an array' }, source: '' },
      ])(q));
    });
    const r = await asSuperuser(`SELECT 1 FROM kb_entries WHERE question = 'Fine?'`);
    expect(r.rowCount).toBe(0);
  });

  it('records answers added back from a response with origin "response"', async () => {
    await as(member, async (q) => {
      await importAs(member, [{ question: 'From a response?', answer: 'Yes.', tags: [], source: 'RFI: acme.xlsx' }], 'response', 'acme.xlsx')(q);
      const r = await q<{ origin: string }>(`SELECT origin FROM kb_entries WHERE question = 'From a response?'`);
      expect(r.rows[0].origin).toBe('response');
    });
  });

  it('refuses the "seed" origin through the API', async () => {
    await refused(as(member, importAs(member, [{ question: 'x?', answer: 'y', tags: [], source: '' }], 'seed')));
  });

  it('refuses oversized text', async () => {
    const r = await as(member, importAs(member, [{ question: 'Long?', answer: 'x'.repeat(20_001), tags: [], source: '' }]));
    expect(r).toEqual({ inserted: 0, duplicates: 0, invalid: 1 });
  });
});

describe('6. access (role matrix, decision 0003)', () => {
  let entryId: string;
  beforeAll(async () => {
    const r = await asSuperuser<{ id: string }>(
      `INSERT INTO kb_entries (question, answer, origin, created_by) VALUES ('Shared?', 'Yes.', 'manual', $1) RETURNING id`,
      [admin.id],
    );
    entryId = r.rows[0].id;
  });

  it('every member can read the knowledge base', async () => {
    const r = await as(member, (q) => q('SELECT id FROM kb_entries WHERE id = $1', [entryId]));
    expect(r.rowCount).toBe(1);
  });

  it('a member can add an entry directly, but only as themselves', async () => {
    await as(member, async (q) => {
      const r = await q<{ created_by: string }>(
        `INSERT INTO kb_entries (question, answer, origin) VALUES ('Manual?', 'Yes.', 'manual') RETURNING created_by`,
      );
      expect(r.rows[0].created_by).toBe(member.id);
    });
    await refused(as(member, (q) =>
      q(`INSERT INTO kb_entries (question, answer, origin, created_by) VALUES ('Spoof?', 'x', 'manual', $1)`, [admin.id]),
    ));
  });

  it('a member cannot edit or delete entries; an admin can delete', async () => {
    expect((await as(member, (q) => q(`UPDATE kb_entries SET answer = 'changed' WHERE id = $1`, [entryId]).catch(() => ({ rowCount: 0 })))).rowCount).toBe(0);
    expect((await as(member, (q) => q('DELETE FROM kb_entries WHERE id = $1', [entryId]))).rowCount).toBe(0);
    expect((await as(admin, (q) => q('DELETE FROM kb_entries WHERE id = $1', [entryId]))).rowCount).toBe(1);
  });

  it('anonymous visitors see nothing and cannot import', async () => {
    const r = await as(null, (q) => q('SELECT * FROM kb_entries').catch(() => ({ rowCount: 0 })));
    expect(r.rowCount).toBe(0);
    await refused(as(null, importAs(null, [{ question: 'x?', answer: 'y', tags: [], source: '' }])));
  });
});
