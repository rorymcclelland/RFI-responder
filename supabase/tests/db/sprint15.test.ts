// Sprint 15. Test numbers refer to docs/refinement/sprint-15.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one } from './fixtures';

let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

describe('S15-2 policies check the signed-in user once per query (F-65)', () => {
  it('1. no policy calls auth.uid() except as (select auth.uid())', async () => {
    const { rows } = await asSuperuser(`
      SELECT schemaname || '.' || tablename || ': ' || policyname AS policy,
             coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expr
        FROM pg_policies WHERE schemaname IN ('public', 'private', 'access')`);
    const perRow = rows
      .filter((r) => /auth\.uid\(\)/.test(String(r.expr).replace(/\(\s*SELECT\s+auth\.uid\(\)(\s+AS\s+\w+)?\s*\)/gi, '')))
      .map((r) => r.policy);
    expect(perRow).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
  });

  it('3. a member still cannot update a session directly, now with no policy pretending otherwise', async () => {
    const { rows } = await asSuperuser(`SELECT 1 FROM pg_policies WHERE tablename = 'rfi_sessions' AND cmd = 'UPDATE'`);
    expect(rows).toEqual([]);
    const opp = await one(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('S15', $1, $1) RETURNING id`, [member.id]);
    const session = await one(`INSERT INTO rfi_sessions (file_name, opportunity_id) VALUES ('s15.csv', $1) RETURNING id`, [opp.id]);
    await refused(as(member, (q) => q(`UPDATE rfi_sessions SET status = 'completed' WHERE id = $1`, [session.id])));
    await refused(as(admin, (q) => q(`UPDATE rfi_sessions SET status = 'completed' WHERE id = $1`, [session.id])));
  });
});
