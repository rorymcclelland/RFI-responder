// Sprint 10, S10-6: whether a person has seen the introduction is theirs to record, and only theirs.
// Test numbers refer to docs/refinement/sprint-10.md. Role matrix: decision 0003.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';

let member: TestUser;
let other: TestUser;
let admin: TestUser;

beforeAll(async () => {
  await buildDatabase();
  member = await createUser();
  other = await createUser();
  admin = await createUser({ admin: true });
});
afterAll(closePool);

const onboarded = async (u: TestUser) =>
  (await asSuperuser<{ onboarded_at: string | null }>(`SELECT onboarded_at FROM user_profiles WHERE id = $1`, [u.id])).rows[0].onboarded_at;

type Q = (sql: string, p?: unknown[]) => Promise<{ rows: { t: string | null }[] }>;
// Each `as` block is a transaction that is rolled back, so results are read inside it. A person reads
// their own through my_onboarded_at() (security review, L3: nobody reads anyone else's).
const mine = async (q: Q) => (await q(`SELECT my_onboarded_at() AS t`)).rows[0].t;

describe('S10-6 test 1: onboarded_at', () => {
  it('starts empty for a new person', async () => {
    expect(await onboarded(member)).toBeNull();
  });

  it('a member records their own, through mark_onboarded(), and can read it back', async () => {
    await as(member, async (q) => {
      await q(`SELECT mark_onboarded()`);
      expect(await mine(q as Q)).not.toBeNull();
    });
    expect(await onboarded(other)).toBeNull();
  });

  it('nobody can write the column directly: not the person, not an admin for someone else', async () => {
    await refused(as(other, (q) => q(`UPDATE user_profiles SET onboarded_at = now() WHERE id = $1`, [other.id])));
    await refused(as(admin, (q) => q(`UPDATE user_profiles SET onboarded_at = now() WHERE id = $1`, [other.id])));
    expect(await onboarded(other)).toBeNull();
  });

  it('mark_onboarded() takes no target, so an admin calling it records only their own', async () => {
    await as(admin, async (q) => {
      const before = await q(`SELECT count(*)::text AS t FROM user_profiles`);
      await q(`SELECT mark_onboarded()`);
      expect(await mine(q as Q)).not.toBeNull();
      expect(before.rows[0].t).not.toBe('0');
    });
    expect(await onboarded(other)).toBeNull();
  });

  it('calling it again is harmless, and keeps the first time', async () => {
    // Set an earlier time directly, then call it: the earlier time stays (onboarded_at IS NULL guard).
    await asSuperuser(`UPDATE user_profiles SET onboarded_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [other.id]);
    try {
      await as(other, async (q) => {
        await q(`SELECT mark_onboarded()`);
        expect(new Date((await mine(q as Q))!).toISOString()).toBe('2026-01-01T00:00:00.000Z');
      });
    } finally {
      await asSuperuser(`UPDATE user_profiles SET onboarded_at = NULL WHERE id = $1`, [other.id]);
    }
  });

  it('an anonymous visitor cannot call it', async () => {
    await refused(as(null, (q) => q(`SELECT mark_onboarded()`)));
  });

  it('the other profile columns keep their rules: a member still cannot make themself admin', async () => {
    await refused(as(member, (q) => q(`UPDATE user_profiles SET is_admin = true WHERE id = $1`, [member.id])));
  });

  it('nobody reads anyone else\'s, not even an admin; everyone still reads the rest of every profile', async () => {
    await refused(as(member, (q) => q(`SELECT onboarded_at FROM user_profiles WHERE id = $1`, [other.id])));
    await refused(as(admin, (q) => q(`SELECT onboarded_at FROM user_profiles`)));
    await refused(as(member, (q) => q(`SELECT * FROM user_profiles`)));
    await as(member, async (q) => {
      const r = await q(`SELECT id, display_name, job_title, department, expertise_tags, is_admin, created_at, updated_at FROM user_profiles`);
      expect(r.rows.length).toBeGreaterThanOrEqual(3);
    });
    await refused(as(null, (q) => q(`SELECT my_onboarded_at()`)));
  });
});
