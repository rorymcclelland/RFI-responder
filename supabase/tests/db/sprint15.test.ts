// Sprint 15. Test numbers refer to docs/refinement/sprint-15.md. Role matrix: decision 0003.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, getPool, createUser, refused, type TestUser } from './harness';
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
    // Bare, public.-qualified or quoted ("public"."is_admin") calls; calls into access are fine (security review, finding 11).
    const pattern = new RegExp(`(^|[^\\w."])("?public"?\\.)?"?(${HELPERS.join('|')})"?\\s*\\(`);
    const offenders = rows.filter((r) => pattern.test(String(r.src).replace(/"?access"?\."?\w+"?\s*\(/g, ''))).map((r) => r.fn);
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

describe('S15-4 reset the demo from the app (F-63)', () => {
  const ROOT = join(__dirname, '../../..');
  const load = (file: string) => asSuperuser(readFileSync(join(ROOT, file), 'utf8'));
  const PHRASE = 'reset the demo';

  /** Everything a reset should restore, without ids and times, which differ on every load. */
  const state = async () => (await asSuperuser(`
    SELECT json_build_object(
      'entries', (SELECT json_agg(json_build_object('ref', ref, 'q', question, 'a', answer, 'lang', language, 'origin', origin,
                    'reviewed', reviewed_at IS NOT NULL, 'replaced', superseded_by IS NOT NULL, 'from', translated_from,
                    'by', (SELECT email FROM auth.users WHERE id = created_by)) ORDER BY ref) FROM kb_entries),
      'responses', (SELECT json_agg(json_build_object('name', name, 'owner', (SELECT email FROM auth.users WHERE id = owner_id),
                    'exported', exported_at IS NOT NULL, 'archived', archived_at IS NOT NULL, 'outcome', outcome) ORDER BY name) FROM opportunities),
      'sessions', (SELECT json_agg(json_build_object('file', file_name, 'status', status, 'accepted', accepted_count) ORDER BY file_name) FROM rfi_sessions),
      'questions', (SELECT json_agg(json_build_object('q', question, 'status', status, 'gate', gate, 'kind', draft_kind,
                    'refs', cited_refs, 'learned', learn_outcome, 'final', final_answer) ORDER BY question, position) FROM rfi_questions),
      'approvals', (SELECT json_agg(json_build_object('kind', kind, 'by', (SELECT email FROM auth.users WHERE id = decided_by)) ORDER BY kind, decided_by) FROM approvals),
      'assignments', (SELECT count(*) FROM question_assignments),
      'usage', (SELECT count(*) FROM ai_usage WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@example.invalid'))
    ) AS s`)).rows[0].s;
  /** As the app does it: signed in, committed (the harness's as() always rolls back). */
  const reset = async (u: TestUser | null, phrase: string | null = PHRASE, legacySub = false) => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${u ? 'authenticated' : 'anon'}`);
      await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(u ? { sub: u.id, role: 'authenticated' } : { role: 'anon' })]);
      // The older claim setting auth.uid() also reads (security review, finding 5).
      if (legacySub && u) await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [u.id]);
      const r = (await client.query(`SELECT public.reset_demo($1) AS r`, [phrase])).rows[0].r;
      await client.query('COMMIT');
      return r;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
  const status = (u: TestUser | null) => as(u, async (q) => (await q(`SELECT public.demo_status() AS s`)).rows[0].s);

  it('3. with no demo loaded, the reset refuses and the status says so', async () => {
    expect(await status(admin)).toMatchObject({ loaded: false });
    expect(await refused(reset(admin))).toMatch(/no demo/i);
  });

  it('2. after loading, the button gives exactly what the SQL reset gives', async () => {
    await load('supabase/demo-hosted.sql');
    expect(await status(admin)).toMatchObject({ loaded: true, last_reset_at: null });
    await load('supabase/demo-hosted-reset.sql');
    const viaSql = await state();
    await reset(admin);
    expect(await state()).toEqual(viaSql);
    expect((viaSql as { entries: unknown[] }).entries).toHaveLength(132);
  });

  it('2. entry numbers start again at KB-0001, so the demo responses still cite the right entries', async () => {
    await one(`INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ('Numbering (S15-4)?', 'Yes.', '{}', 'manual', $1) RETURNING id`, [member.id]);
    await reset(admin);
    const r = await one<{ min: string; max: string; ja: string }>(
      `SELECT min(ref) AS min, max(ref) AS max, (SELECT ref FROM kb_entries WHERE language = 'ja' ORDER BY seq LIMIT 1) AS ja FROM kb_entries`);
    expect(r).toEqual({ min: 'KB-0001', max: 'KB-0132', ja: 'KB-0101' });
  });

  it('1. removes what reviewers added, keeps accounts, roles, limits, real usage and the audit log, and audits the reset', async () => {
    const opp = await one<{ id: string }>(`INSERT INTO opportunities (name, created_by, owner_id) VALUES ('Reviewer (S15-4)', $1, $1) RETURNING id`, [member.id]);
    await one(`INSERT INTO kb_entries (question, answer, tags, origin, created_by) VALUES ('Reviewer entry (S15-4)?', 'Yes.', '{}', 'manual', $1) RETURNING id`, [member.id]);
    await asSuperuser(`INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens, output_tokens) VALUES ($1, 'embed', 'embed', 'voyage', 'voyage-4', 10, 0)`, [member.id]);
    await asSuperuser(`UPDATE ai_settings SET daily_question_cap = 51`);
    const audit = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log`)).n;
    const before = await state();

    const r = await reset(admin);
    expect(r).toMatchObject({ entries: 132, responses: 4 });
    expect(await one(`SELECT count(*)::int AS n FROM opportunities WHERE id = $1`, [opp.id])).toEqual({ n: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM kb_entries WHERE question LIKE 'Reviewer entry%'`)).toEqual({ n: 0 });
    expect(await one(`SELECT count(*)::int AS n FROM ai_usage WHERE user_id = $1`, [member.id])).toEqual({ n: 1 });
    expect(await one(`SELECT daily_question_cap AS c FROM ai_settings`)).toEqual({ c: 51 });
    expect(await one(`SELECT count(*)::int AS n, bool_or(is_admin) AS a FROM user_profiles WHERE id IN ($1, $2)`, [member.id, admin.id])).toEqual({ n: 2, a: true });
    const after = await one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_log`);
    expect(after.n).toBeGreaterThan(audit);
    const row = await one<{ actor: string; details: Record<string, unknown> }>(`SELECT actor, details FROM audit_log WHERE action = 'demo.reset' ORDER BY id DESC LIMIT 1`);
    expect(row).toMatchObject({ actor: admin.id, details: { entries: 132, responses: 4 } });
    expect(await status(admin)).toMatchObject({ loaded: true });
    expect((await status(admin) as { last_reset_at: string | null }).last_reset_at).not.toBeNull();
    expect(await state()).not.toEqual(before);
  });

  it('2. the reload runs as nobody even when the older claim setting names the admin', async () => {
    await reset(admin);
    const expected = await state();
    await reset(admin, PHRASE, true);
    expect(await state()).toEqual(expected);
  });

  it('4. twice in a row gives the same state, and the demo usage is not counted twice', async () => {
    await reset(admin);
    const once = await state();
    await reset(admin);
    expect(await state()).toEqual(once);
  });

  it('3. refused: a member, an anonymous visitor, a wrong or missing phrase', async () => {
    expect(await refused(reset(member))).toMatch(/admin/i);
    await refused(reset(null));
    for (const p of [null, '', 'Reset the demo', 'reset the demo ', 'yes']) expect(await refused(reset(admin, p))).toMatch(/reset the demo/);
    await refused(status(member));
    await refused(status(null));
  });

  it('5. no API role can read or write the stored reload script', async () => {
    for (const u of [member, admin]) {
      await refused(as(u, (q) => q(`SELECT script FROM private.demo_reload`)));
      await refused(as(u, (q) => q(`UPDATE private.demo_reload SET script = 'SELECT 1'`)));
    }
    await refused(asServiceRole((q) => q(`UPDATE private.demo_reload SET script = 'SELECT 1'`)));
    await refused(as(admin, (q) => q(`SELECT public.reset_demo($1)`, [`reset the demo'; DROP TABLE kb_entries; --`])));
    expect(await one(`SELECT count(*)::int AS n FROM kb_entries`)).toEqual({ n: 132 });
  });
});

describe('Sprint 15 security review: invitations are reserved before anything is sent (findings 2 and 3)', () => {
  const reserve = (id: string, email: string, limit = 20) =>
    asSuperuser(`SELECT public.reserve_invitation($1, $2, $3) AS r`, [id, email, limit]).then((x) => x.rows[0].r);

  it('only the service role may reserve or release', async () => {
    for (const u of [null, member, admin]) {
      await refused(as(u, (q) => q(`SELECT public.reserve_invitation($1, 'x@y.co', 20)`, [admin.id])));
      await refused(as(u, (q) => q(`SELECT public.release_invitation(1)`)));
    }
    const r = await asServiceRole(async (q) => (await q(`SELECT public.reserve_invitation($1, 'svc@y.co', 20) AS r`, [admin.id])).rows[0].r);
    expect(r).toMatchObject({ outcome: 'ok' });
  });

  it('refuses a member as the inviter', async () => {
    expect(await reserve(member.id, 'someone@y.co')).toEqual({ outcome: 'not_admin' });
  });

  it('refuses any address with an account, confirmed or not, in any case', async () => {
    const unconfirmed = await one<{ email: string }>(`INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (gen_random_uuid(), 'pending.reviewer@y.co', NULL) RETURNING email`);
    expect(await reserve(admin.id, ' Pending.Reviewer@Y.CO ')).toEqual({ outcome: 'exists' });
    expect(await reserve(admin.id, member.email.toUpperCase())).toEqual({ outcome: 'exists' });
    expect(unconfirmed.email).toBe('pending.reviewer@y.co');
  });

  it('holds the daily limit, counting only slots kept; a released slot is given back', async () => {
    const other = await createUser({ admin: true });
    for (let i = 0; i < 3; i++) expect(await reserve(other.id, `n${i}@y.co`, 3)).toMatchObject({ outcome: 'ok' });
    const over = await reserve(other.id, 'n3@y.co', 3);
    expect(over).toEqual({ outcome: 'limit' });
    const { rows } = await asSuperuser(`SELECT id FROM private.invitation_slots WHERE admin = $1 ORDER BY id DESC LIMIT 1`, [other.id]);
    await asSuperuser(`SELECT public.release_invitation($1)`, [rows[0].id]);
    expect(await reserve(other.id, 'n3@y.co', 3)).toMatchObject({ outcome: 'ok' });
    expect(await reserve(admin.id, 'n4@y.co', 3)).toMatchObject({ outcome: 'ok' });
  });

  it('parallel reservations cannot pass the limit', async () => {
    const busy = await createUser({ admin: true });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(busy.id, `p${i}@y.co`, 5)));
    expect(results.filter((r) => r.outcome === 'ok')).toHaveLength(5);
  });

  it('no API role can read the slots', async () => {
    for (const u of [member, admin]) await refused(as(u, (q) => q(`SELECT * FROM private.invitation_slots`)));
    await refused(asServiceRole((q) => q(`SELECT * FROM private.invitation_slots`)));
  });

  it('functions added to the access schema later are not executable by everyone (finding 10)', async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE FUNCTION access.future_helper() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$');
      const r = await client.query(`SELECT has_function_privilege('authenticated', 'access.future_helper()', 'EXECUTE') AS ok`);
      expect(r.rows[0].ok).toBe(false);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
