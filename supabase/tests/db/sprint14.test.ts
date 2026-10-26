// Sprint 14. Test numbers refer to docs/refinement/sprint-14.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one } from './fixtures';

let member: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

describe('S14-1 the audit log cannot be changed by the service role (F-57)', () => {
  it('1. the service role can still write and read audit rows', async () => {
    await asServiceRole(async (q) => {
      await q(`INSERT INTO audit_log (actor, action, target_id, details) VALUES (NULL, 'test.s14', NULL, '{}')`);
      expect((await q(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'test.s14'`)).rows[0].n).toBe(1);
    });
  });

  it('2. the service role cannot update, delete or truncate them', async () => {
    await one(`INSERT INTO audit_log (actor, action, target_id, details) VALUES (NULL, 'test.s14.kept', NULL, '{}') RETURNING id`);
    await refused(asServiceRole((q) => q(`UPDATE audit_log SET action = 'forged' WHERE action = 'test.s14.kept'`)));
    await refused(asServiceRole((q) => q(`DELETE FROM audit_log WHERE action = 'test.s14.kept'`)));
    await refused(asServiceRole((q) => q(`TRUNCATE audit_log`)));
  });

  it('3. audit paths still write their row (a setting change, as an admin)', async () => {
    await as(admin, async (q) => {
      const before = (await q(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n as number;
      await q(`UPDATE ai_settings SET monthly_budget_gbp = monthly_budget_gbp`);
      expect((await q(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n).toBeGreaterThan(before);
    });
  });

  it('4. members and admins still cannot change the log', async () => {
    for (const u of [member, admin]) {
      await refused(as(u, (q) => q(`UPDATE audit_log SET action = 'forged'`)));
      await refused(as(u, (q) => q(`DELETE FROM audit_log`)));
    }
  });
});
