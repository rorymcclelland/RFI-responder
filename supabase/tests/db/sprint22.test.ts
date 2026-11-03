// Sprint 22: spend by use and the audit log by person and response (S22-2). Test numbers refer to
// docs/refinement/sprint-22.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let owner: TestUser;
let member: TestUser;
let admin: TestUser;

interface Row { id: number; at: string; action: string; actor: string | null; actorName: string | null; targetId: string | null; details: Record<string, unknown> }
interface Found { rows: Row[]; more: boolean }
const search = (u: TestUser | null, o: { actions?: string[] | null; actor?: string | null; response?: string | null; limit?: number } = {}) =>
  as(u, async (q) => (await q(`SELECT public.audit_log_search($1, $2, $3, $4) AS r`,
    [o.actions ?? null, o.actor ?? null, o.response ?? null, o.limit ?? 200])).rows[0].r as Found);

/** An audit row as the database writes it (the stamp trigger sets who and when). */
const audit = (actor: string | null, action: string, target: string | null, details: Record<string, unknown> = {}) =>
  asSuperuser(`INSERT INTO audit_log (actor, action, target_id, details) VALUES ($1, $2, $3, $4)`, [actor, action, target, details]);

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Priya Owner (S22)' });
  member = await createUser({ name: 'James Member (S22)' });
  admin = await createUser({ admin: true, name: 'Sarah Admin (S22)' });
});
afterAll(closePool);

describe('S22-2 spend by use', () => {
  it('2. usage_report gives calls and spend for each function this month, adding up to the total', async () => {
    await asSuperuser(`DELETE FROM ai_usage`);
    const add = (fn: string, kind: string, cost: number | null, daysAgo = 0) => asSuperuser(
      `INSERT INTO ai_usage (user_id, function, kind, provider, model, input_tokens, output_tokens, at)
       VALUES ($1, $2, $3, 'anthropic', 'test-model', 100, 10, now() - make_interval(days => $4))
       RETURNING id`, [admin.id, fn, kind, daysAgo]).then(async (r) => {
        if (cost !== null) await asSuperuser(`UPDATE ai_usage SET cost_usd = $2 WHERE id = $1`, [r.rows[0].id, cost]);
        else await asSuperuser(`UPDATE ai_usage SET cost_usd = NULL WHERE id = $1`, [r.rows[0].id]);
      });
    await add('process-questions', 'draft', 0.01);
    await add('process-questions', 'judge', 0.02);
    await add('ask-knowledge', 'draft', 0.004);
    await add('embed-entries', 'embed', 0.001);
    await add('a-new-function', 'draft', null);
    await add('process-questions', 'draft', 5, 40); // last month or before: not counted
    const r = await as(admin, async (q) => (await q(`SELECT public.usage_report() AS r`)).rows[0].r as {
      byFunction: { function: string; calls: number; spentGbp: number }[]; byUser: { spentGbp: number }[] });
    const fns = Object.fromEntries(r.byFunction.map((f) => [f.function, f]));
    const rate = Number((await one<{ g: string }>(`SELECT gbp_per_usd AS g FROM ai_settings`)).g);
    expect(fns['process-questions']).toMatchObject({ calls: 2 });
    expect(Number(fns['process-questions'].spentGbp)).toBeCloseTo(0.03 * rate, 4);
    expect(fns['ask-knowledge']).toMatchObject({ calls: 1 });
    expect(fns['a-new-function']).toMatchObject({ calls: 1, spentGbp: 0 });
    const byUse = r.byFunction.reduce((t, f) => t + Number(f.spentGbp), 0);
    const byUser = r.byUser.reduce((t, u) => t + Number(u.spentGbp), 0);
    expect(byUse).toBeCloseTo(byUser, 4);
  });

  it('2. only an admin reads it, as before', async () => {
    expect(await refused(as(member, (q) => q(`SELECT public.usage_report()`)))).toMatch(/admin/i);
  });
});

describe('S22-2 audit_log_search()', () => {
  let opp: string; let s: string; let qid: string;
  let other: string; let otherQ: string;

  beforeAll(async () => {
    opp = await response(owner.id, { name: 'Acme (fictional) S22 audit' });
    s = await session(opp);
    qid = await question(s, { text: 'Do you hold ISO 27001 (S22)?' });
    other = await response(owner.id, { name: 'Bluefin (fictional) S22 audit' });
    otherQ = await question(await session(other), { text: 'Other response question (S22)?' });
    await audit(owner.id, 'question.held', qid, { reason: 'S22 held' });
    await audit(owner.id, 'response.exported', s, { learned: 1 });
    await audit(admin.id, 'kb.confirmed', qid, { refs: ['KB-0001'] });
    await audit(owner.id, 'question.changed_after_export', qid, { session: s });
    await audit(admin.id, 'response.archived', opp, { outcome: 'won' });
    await audit(owner.id, 'question.held', otherQ, { reason: 'S22 other' });
    await audit(admin.id, 'settings.changed', null, { before: {}, after: {} });
  });

  it('4. by response: its own rows, its files\' and its questions\', and nothing about another response or none', async () => {
    const r = await search(admin, { response: opp });
    expect(r.rows.map((x) => x.action).sort()).toEqual(
      ['kb.confirmed', 'question.changed_after_export', 'question.held', 'response.archived', 'response.exported']);
    expect(r.rows.every((x) => x.targetId !== otherQ && x.action !== 'settings.changed')).toBe(true);
    expect(r.more).toBe(false);
  });

  it('3. by person: only rows that person did, with their name', async () => {
    const r = await search(admin, { actor: owner.id, response: null });
    expect(r.rows.length).toBeGreaterThanOrEqual(4);
    expect(r.rows.every((x) => x.actor === owner.id && x.actorName === 'Priya Owner (S22)')).toBe(true);
  });

  it('3. someone whose profile was deleted since can still be found, with no name', async () => {
    const gone = await createUser({ name: 'Gone Person (S22)' });
    await audit(gone.id, 'question.held', qid, { reason: 'S22 gone' });
    await asSuperuser(`DELETE FROM user_profiles WHERE id = $1`, [gone.id]);
    const r = await search(admin, { actor: gone.id });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ actor: gone.id, actorName: null });
    const people = await as(admin, async (q) => (await q(`SELECT public.audit_log_people() AS p`)).rows[0].p as { id: string; name: string | null }[]);
    expect(people).toContainEqual({ id: gone.id, name: null });
    expect(people).toContainEqual({ id: owner.id, name: 'Priya Owner (S22)' });
  });

  it('5. the filters combine with the kind, newest first, at most the limit, saying when more match', async () => {
    const r = await search(admin, { actions: ['question.held'], actor: owner.id, response: opp });
    expect(r.rows.map((x) => x.details.reason)).toEqual(['S22 held']);
    for (let i = 0; i < 3; i++) await audit(member.id, 'question.released', qid, { n: i });
    const two = await search(admin, { actions: ['question.released'], actor: member.id, limit: 2 });
    expect(two.rows.map((x) => x.details.n)).toEqual([2, 1]);
    expect(two.more).toBe(true);
    const all = await search(admin, { actions: ['question.released'], actor: member.id, limit: 3 });
    expect(all.more).toBe(false);
  });

  it('5. the limit is between 1 and 200', async () => {
    expect((await search(admin, { limit: 5000 })).rows.length).toBeLessThanOrEqual(200);
    expect((await search(admin, { limit: 0 })).rows.length).toBeGreaterThanOrEqual(1);
  });

  it('6. a member and a signed-out caller get nothing; an admin gets the rows', async () => {
    expect((await search(member, { response: opp })).rows).toEqual([]);
    expect(await refused(search(null, { response: opp }))).toMatch(/permission denied/i);
    expect(await refused(as(null, (q) => q(`SELECT public.audit_log_people()`)))).toMatch(/permission denied/i);
    expect(await as(member, async (q) => (await q(`SELECT public.audit_log_people() AS p`)).rows[0].p)).toEqual([]);
    expect(await refused(asServiceRole((q) => q(`SELECT public.audit_log_search(NULL, NULL, NULL, 10)`)))).toMatch(/permission denied/i);
  });

  it('8. with 50,000 audit rows the filtered read answers in under a second', async () => {
    await asSuperuser(`INSERT INTO audit_log (actor, action, target_id, details)
      SELECT $1, 'question.held', $2, jsonb_build_object('n', g) FROM generate_series(1, 50000) g`, [member.id, otherQ]);
    for (const o of [{ response: opp }, { actor: owner.id }, { actions: ['settings.changed'] }, {}]) {
      const t = Date.now();
      await search(admin, o);
      expect(Date.now() - t).toBeLessThan(1000);
    }
  }, 60_000);
});
