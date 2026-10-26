// Sprint 14. Test numbers refer to docs/refinement/sprint-14.md. Role matrix: decision 0003.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
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

describe('S14-2 hosted demo data loads on a hosted-like database', () => {
  const load = (file: string) => asSuperuser(readFileSync(join(ROOT, file), 'utf8'));
  const counts = () => one<{ kb: number; ja: number; opps: number; users: number; signable: number }>(
    `SELECT (SELECT count(*)::int FROM kb_entries) AS kb, (SELECT count(*)::int FROM kb_entries WHERE language = 'ja') AS ja,
            (SELECT count(*)::int FROM opportunities) AS opps,
            (SELECT count(*)::int FROM auth.users WHERE email LIKE '%@example.invalid') AS users,
            (SELECT count(*)::int FROM auth.users WHERE email LIKE '%@example.invalid'
               AND (coalesce(encrypted_password, '') <> '' OR banned_until IS NULL OR banned_until < now()
                    OR EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = auth.users.id))) AS signable`);

  // 130 seeded entries and 2 learned when the demo's exported responses record their export, as locally.
  it('2. gives the knowledge base and responses of the local seed, with fictional people who cannot sign in', async () => {
    await load('supabase/demo-hosted.sql');
    expect(await counts()).toEqual({ kb: 132, ja: 30, opps: 4, users: 8, signable: 0 });
  });

  it('3. loading it twice changes nothing', async () => {
    await load('supabase/demo-hosted.sql');
    expect(await counts()).toEqual({ kb: 132, ja: 30, opps: 4, users: 8, signable: 0 });
  });

  it('3. the reset removes what a real account added, keeps the account and its role, and restores the demo', async () => {
    const real = await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Reviewer response (S14-2)', $1, $1) RETURNING id`, [member.id]);
    await one(`INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ('Reviewer entry (S14-2)?', 'Yes.', '{}', 'manual', $1) RETURNING id`, [member.id]);
    expect(real.id).toBeTruthy();
    await load('supabase/demo-hosted-reset.sql');
    expect(await counts()).toEqual({ kb: 132, ja: 30, opps: 4, users: 8, signable: 0 });
    const kept = await one<{ n: number; admin: boolean }>(`SELECT count(*)::int AS n, bool_or(is_admin) AS admin FROM user_profiles WHERE id IN ($1, $2)`, [member.id, admin.id]);
    expect(kept).toEqual({ n: 2, admin: true });
  });
});
