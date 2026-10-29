// Sprint 18: each answer's story, and asking the knowledge base. Test numbers refer to docs/refinement/sprint-18.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, type TestUser } from './harness';
import { one } from './fixtures';

const ROOT = join(__dirname, '../../..');
let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

describe('S18-1 entry numbers past KB-9999 (BUG-42)', () => {
  it('1 and 4. the demo keeps every number, starting at KB-0001', async () => {
    await asSuperuser(readFileSync(join(ROOT, 'supabase/demo-hosted.sql'), 'utf8'));
    const r = await one<{ min: string; max: string; n: number; bad: number }>(
      `SELECT min(ref) AS min, max(ref) AS max, count(*)::int AS n,
              count(*) FILTER (WHERE ref <> 'KB-' || lpad(seq::text, 4, '0'))::int AS bad FROM kb_entries`);
    expect(r).toMatchObject({ min: 'KB-0001', bad: 0 });
    expect(r.n).toBeGreaterThan(100);
  });

  it('2. KB-9999 is followed by KB-10000, and both are saved', async () => {
    await asSuperuser(`SELECT setval(pg_get_serial_sequence('public.kb_entries', 'seq'), 9998)`);
    const add = (q: string) => one<{ ref: string }>(
      `INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ($1, 'Yes.', '{}', 'manual', $2) RETURNING ref`, [q, admin.id]);
    expect((await add('Numbering 9999 (S18-1)?')).ref).toBe('KB-9999');
    expect((await add('Numbering 10000 (S18-1)?')).ref).toBe('KB-10000');
    expect((await add('Numbering 10001 (S18-1)?')).ref).toBe('KB-10001');
    expect(await as(member, async (q) => (await q(`SELECT count(*)::int AS n FROM kb_entries WHERE ref IN ('KB-9999', 'KB-10000')`)).rows[0].n)).toBe(2);
  });

  it('the number stays unique and generated: nobody can set it', async () => {
    const { rows } = await asSuperuser(`SELECT is_generated, generation_expression FROM information_schema.columns WHERE table_name = 'kb_entries' AND column_name = 'ref'`);
    expect(rows[0].is_generated).toBe('ALWAYS');
    const u = await asSuperuser(`SELECT count(*)::int AS n FROM pg_indexes WHERE tablename = 'kb_entries' AND indexdef ILIKE '%UNIQUE%(ref)%'`);
    expect(u.rows[0].n).toBe(1);
  });
});
