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

const HELPERS = ['is_admin', 'is_response_owner', 'can_decide_question', 'response_of_session', 'current_operation', 'entry_review_due'];

describe('S15-3 the policy helpers are no longer callable through the API (F-64)', () => {
  it('1. each helper is in the access schema only: definer, empty search path, signed-in users and the service role only', async () => {
    const { rows } = await asSuperuser(`
      SELECT n.nspname AS schema, p.proname AS name, p.prosecdef AS definer, p.proconfig AS config,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS member,
             has_function_privilege('service_role', p.oid, 'EXECUTE') AS service,
             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
             EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE p.proname = ANY($1) AND n.nspname IN ('public', 'private', 'access')`, [HELPERS]);
    expect(rows.map((r) => r.name).sort()).toEqual([...HELPERS].sort());
    for (const r of rows) {
      expect(r, r.name).toMatchObject({ schema: 'access', definer: true, member: true, service: true, anon: false, public: false });
      expect(r.config, r.name).toEqual(['search_path=""']);
    }
  });

  it('1. the access schema is open to signed-in users and the service role only', async () => {
    const { rows } = await asSuperuser(`
      SELECT has_schema_privilege('authenticated', 'access', 'USAGE') AS member,
             has_schema_privilege('service_role', 'access', 'USAGE') AS service,
             has_schema_privilege('anon', 'access', 'USAGE') AS anon`);
    expect(rows[0]).toEqual({ member: true, service: true, anon: false });
  });

  it('2. no function refers to a helper in public, or by a bare name', async () => {
    const { rows } = await asSuperuser(`
      SELECT n.nspname || '.' || p.proname AS fn, p.prosrc AS src
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'private', 'access')`);
    const pattern = new RegExp(`(^|[^\\w.])(public\\.)?(${HELPERS.join('|')})\\s*\\(`);
    const offenders = rows.filter((r) => pattern.test(String(r.src).replace(/access\.(\w+)\s*\(/g, ''))).map((r) => r.fn);
    expect(offenders).toEqual([]);
  });

  it('5. an anonymous visitor cannot call a helper', async () => {
    await refused(as(null, (q) => q(`SELECT access.is_admin()`)));
  });

  it('3. the rules still work through the moved helpers (admin, owner, member)', async () => {
    expect((await as(admin, (q) => q(`SELECT access.is_admin() AS a`))).rows[0].a).toBe(true);
    expect((await as(member, (q) => q(`SELECT access.is_admin() AS a`))).rows[0].a).toBe(false);
    const opp = await one(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('S15-3', $1, $1) RETURNING id`, [member.id]);
    expect((await as(member, (q) => q(`SELECT access.is_response_owner($1) AS o`, [opp.id]))).rows[0].o).toBe(true);
    await as(member, async (q) => {
      expect((await q(`UPDATE opportunities SET name = 'Renamed' WHERE id = $1 RETURNING id`, [opp.id])).rowCount).toBe(1);
    });
    const other = await createUser();
    await as(other, async (q) => {
      expect((await q(`UPDATE opportunities SET name = 'Hijacked' WHERE id = $1 RETURNING id`, [opp.id])).rowCount).toBe(0);
    });
  });
});
