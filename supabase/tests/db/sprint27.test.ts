// Sprint 27 (S27-3, F-62): the knowledge base cleans every kind of whitespace from the ends of a
// question and an answer, so a tab or a line break at either end does not make a second copy of a
// question already held; and two imports at the same moment that share a new question both finish.
// Test numbers refer to docs/refinement/sprint-27.md. The app trims cells before importing, so these
// paths are open only to a direct database call (hostile or careless input).
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, getPool, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

type ImportResult = { inserted: number; duplicates: number; invalid: number };

let admin: TestUser;
let member: TestUser;
let owner: TestUser;

beforeAll(async () => {
  await buildDatabase();
  admin = await createUser({ admin: true, name: 'Admin (S27)' });
  member = await createUser({ name: 'Member (S27)' });
  owner = await createUser({ name: 'Owner (S27)' });
});
afterAll(closePool);

const importAs = (user: TestUser, entries: unknown) =>
  as(user, async (q) => {
    const r = (await q<{ r: ImportResult }>(`SELECT import_kb_entries($1::jsonb, 'import', 's27.csv') AS r`, [JSON.stringify(entries)])).rows[0].r;
    const rows = (await q<{ question: string; answer: string }>(
      `SELECT question, answer FROM kb_entries WHERE question ILIKE '%(S27%' ORDER BY seq`)).rows;
    return { r, rows };
  });

const EDGES: [string, string][] = [['a tab', '\t'], ['a line break', '\n'], ['a carriage return and line break', '\r\n'], ['spaces and tabs mixed', ' \t \t']];

describe('S27-3 1: an imported question with whitespace of any kind at either end', () => {
  it.each(EDGES)('is stored without %s, and matched to the same question already held', async (_, ws) => {
    const held = `Do you encrypt backups (S27 1 ${JSON.stringify(ws)})?`;
    await entry({ question: held, answer: 'Yes.' });
    const { r, rows } = await importAs(member, [
      { question: `${ws}${held}`, answer: 'Yes, with AES-256.' },
      { question: `${ws}New question (S27 1 ${JSON.stringify(ws)})?${ws}`, answer: `${ws}Answer.${ws}` },
    ]);
    expect(r).toEqual({ inserted: 1, duplicates: 1, invalid: 0 });
    const added = rows.find((x) => x.question.startsWith('New question'))!;
    expect(added).toEqual({ question: `New question (S27 1 ${JSON.stringify(ws)})?`, answer: 'Answer.' });
    expect(rows.filter((x) => x.question === held)).toHaveLength(1);
  });

  it('a question that is only whitespace is invalid, as an empty one is', async () => {
    const { r } = await importAs(member, [{ question: '\t\n', answer: 'Answer (S27 1).' }]);
    expect(r).toEqual({ inserted: 0, duplicates: 0, invalid: 1 });
  });
});

describe('S27-3 2: editing and learning clean the same way', () => {
  it('an admin\'s edit with a tab and a line break at the ends stores the text without them', async () => {
    const e = await entry({ question: 'Edited question (S27 2)?', answer: 'Old answer.' });
    const row = await as(admin, async (q) => {
      await q(`SELECT review_entry($1, $2, $3)`, [e.id, '\tEdited question (S27 2), reworded?\n', '\r\nNew answer.\t']);
      return (await q<{ question: string; answer: string }>(`SELECT question, answer FROM kb_entries WHERE id = $1`, [e.id])).rows[0];
    });
    expect(row).toEqual({ question: 'Edited question (S27 2), reworded?', answer: 'New answer.' });
  });

  it('an edit that only adds a tab to an entry\'s question is not a change, so its embedding is kept', async () => {
    const e = await entry({ question: 'Unchanged question (S27 2)?', answer: 'Same answer.' });
    await asSuperuser(`UPDATE kb_entries SET embedding_model = 'voyage-4' WHERE id = $1`, [e.id]);
    const row = await as(admin, async (q) => {
      await q(`SELECT review_entry($1, $2, $3)`, [e.id, '\tUnchanged question (S27 2)?', 'Same answer.\n']);
      return (await q<{ m: string | null }>(`SELECT embedding_model AS m FROM kb_entries WHERE id = $1`, [e.id])).rows[0];
    });
    expect(row.m).toBe('voyage-4');
  });

  it('an edit that would clash with another entry once cleaned is refused, as before', async () => {
    await entry({ question: 'Clash target (S27 2)?' });
    const e = await entry({ question: 'Clash source (S27 2)?' });
    expect(await refused(as(admin, (q) => q(`SELECT review_entry($1, $2, NULL)`, [e.id, '\tClash target (S27 2)?\n'])))).toMatch(/already has this question/);
  });

  it('a sent answer to a question with a tab at the start is learned against the entry already held', async () => {
    const held = await entry({ question: 'Where is data hosted (S27 2)?', answer: 'In the UK.' });
    const r = await response(owner.id, { name: 'Learn (S27 2)' });
    const s = await session(r);
    const qid = await question(s, { text: '\tWhere is data hosted (S27 2)?\n', sources: [held.ref], cited: [held.ref], final: 'In the UK and Ireland.' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE session_id = $1`, [s]);
    await asSuperuser(`UPDATE rfi_sessions SET question_count = 1 WHERE id = $1`, [s]);
    const learned = await as(owner, async (q) => {
      await q(`SELECT record_response_export($1)`, [r]);
      return (await q<{ outcome: string; question: string | null; copies: number }>(
        `SELECT q.learn_outcome AS outcome, k.question,
                (SELECT count(*)::int FROM kb_entries x WHERE x.question ILIKE '%Where is data hosted (S27 2)%') AS copies
           FROM rfi_questions q LEFT JOIN kb_entries k ON k.id = q.learned_entry_id WHERE q.id = $1`, [qid])).rows[0];
    });
    expect(learned.outcome).not.toBe('added');
    expect(learned.question).toBe('Where is data hosted (S27 2)?');
    // The entry held, plus at most the proposed change to it: never a second current copy with a tab.
    expect(learned.copies).toBeLessThanOrEqual(2);
  });
});

describe('S27-3 3: two imports at once that share a new question both finish', () => {
  async function connection(u: TestUser) {
    const c = await getPool().connect();
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated', email: u.email })]);
    return c;
  }
  const run = (c: Awaited<ReturnType<typeof connection>>, entries: unknown) =>
    c.query<{ r: ImportResult }>(`SELECT import_kb_entries($1::jsonb, 'import', 'race.csv') AS r`, [JSON.stringify(entries)]).then((x) => x.rows[0].r);

  it('the second waits for the first, counts the shared question as a duplicate and keeps the rest of its file', async () => {
    const shared = { question: 'Shared new question (S27 3)?', answer: 'From the first file.' };
    const a = await connection(member);
    const b = await connection(admin);
    let second: Promise<ImportResult> | undefined;
    try {
      expect(await run(a, [shared, { question: 'Only in the first file (S27 3)?', answer: 'A.' }])).toEqual({ inserted: 2, duplicates: 0, invalid: 0 });
      second = run(b, [{ ...shared, answer: 'From the second file.' }, { question: 'Only in the second file (S27 3)?', answer: 'B.' }]);
      await new Promise((res) => setTimeout(res, 200));
      await a.query('COMMIT');
      expect(await second).toEqual({ inserted: 1, duplicates: 1, invalid: 0 });
      await b.query('COMMIT');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
    const rows = (await asSuperuser<{ question: string; answer: string }>(
      `SELECT question, answer FROM kb_entries WHERE question LIKE '%(S27 3)?' ORDER BY question`)).rows;
    expect(rows).toEqual([
      { question: 'Only in the first file (S27 3)?', answer: 'A.' },
      { question: 'Only in the second file (S27 3)?', answer: 'B.' },
      { question: 'Shared new question (S27 3)?', answer: 'From the first file.' },
    ]);
  });
});

describe('S27-3 4: whitespace inside a question, and a full-width space at either end, are as before', () => {
  it('runs of whitespace inside are kept as typed, and matched as one space', async () => {
    await entry({ question: 'Inside   spaces (S27 4)?' });
    const { r, rows } = await importAs(member, [{ question: 'Inside \t spaces (S27 4)?', answer: 'A.' }]);
    expect(r).toEqual({ inserted: 0, duplicates: 1, invalid: 0 });
    expect(rows.map((x) => x.question)).toContain('Inside   spaces (S27 4)?');
  });

  it('a full-width space at either end of a Japanese question is kept, as today', async () => {
    const q = '　データは暗号化されていますか（S27 4）？　';
    const { r } = await importAs(member, [{ question: q, answer: 'はい。' }]);
    expect(r.inserted).toBe(1);
    const row = await one<{ question: string }>(`SELECT question FROM kb_entries WHERE question LIKE '%S27 4）？%'`);
    // as() rolled the import back, so it is checked inside the same call instead.
    expect(row).toBeUndefined();
    const kept = await as(member, async (qq) => {
      await qq(`SELECT import_kb_entries($1::jsonb, 'import', 's27.csv')`, [JSON.stringify([{ question: q, answer: 'はい。' }])]);
      return (await qq<{ question: string }>(`SELECT question FROM kb_entries WHERE question LIKE '%S27 4）？%'`)).rows[0].question;
    });
    expect(kept).toBe(q);
  });
});

describe('S27-3 6: the cleaning function is not callable through the API', () => {
  it.each([['a member', () => member], ['an admin', () => admin]])('%s cannot call it', async (_, who) => {
    expect(await refused(as(who(), (q) => q(`SELECT private.clean_text(' x ')`)))).toMatch(/permission denied/);
  });

  it('it is in the private schema, which the API does not expose', async () => {
    const f = await one<{ n: number }>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
                                         WHERE p.proname = 'clean_text' AND s.nspname = 'public'`);
    expect(f.n).toBe(0);
  });
});

describe('S27-3 (Rory, Q3): the migration refuses if the cleaning would change an entry already held', () => {
  const migration = readFileSync('supabase/migrations/20261114100000_clean_whitespace.sql', 'utf8');
  const check = migration.slice(migration.indexOf('DO $$'), migration.indexOf('END $$;') + 'END $$;'.length);

  it('passes when no entry would change', async () => {
    expect(check).toMatch(/RAISE EXCEPTION 'Cleaning whitespace would change %/);
    await asSuperuser(check);
  });

  it('refuses, saying how many, when one would', async () => {
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      // Written straight to the table, as only a direct call before this sprint could.
      await c.query(`INSERT INTO kb_entries (question, answer, tags, origin) VALUES (E'\\tDirty (S27 Q3)?', 'A.', '{}', 'seed')`);
      expect(await refused(c.query(check))).toMatch(/would change 1 knowledge-base entries/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
