// Sprint 23: Try it (S23-1). Test numbers refer to docs/refinement/sprint-23.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let visitor: TestUser;
let other: TestUser;
let admin: TestUser;

/** A try as the app makes it: the visitor inserts a response marked as a try, then its file. */
const makeTry = (u: TestUser, name = 'Try it: Coral Bay Retail (fictional)') =>
  as(u, async (q) => (await q<{ id: string }>(`INSERT INTO opportunities (name, trial) VALUES ($1, true) RETURNING id`, [name])).rows[0].id);

beforeAll(async () => {
  await buildDatabase();
  visitor = await createUser({ name: 'Visiting Manager (S23)' });
  other = await createUser({ name: 'Other Member (S23)' });
  admin = await createUser({ admin: true, name: 'Admin (S23)' });
});
afterAll(closePool);

describe('S23-1 making a try', () => {
  it('1. a member makes a try they own, marked as a try', async () => {
    const id = await as(visitor, async (q) => {
      const r = (await q<{ id: string; owner_id: string; trial: boolean }>(
        `INSERT INTO opportunities (name, trial) VALUES ('Try it (S23 1)', true) RETURNING id, owner_id, trial`)).rows[0];
      expect(r).toMatchObject({ owner_id: visitor.id, trial: true });
      return r.id;
    });
    expect(id).toBeTruthy(); // rolled back with the transaction
  });

  it('6. one open try per person: a second is refused until the first is archived', async () => {
    await asSuperuser(`DELETE FROM opportunities WHERE trial`);
    const first = await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('First try (S23 6)', $1, true) RETURNING id`, [visitor.id]).then((r) => r.rows[0].id as string);
    expect(await refused(makeTry(visitor))).toMatch(/opportunities_one_open_try|duplicate/);
    // Someone else's try does not count against the visitor; an ordinary response never counts.
    await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('Other try (S23 6)', $1, true)`, [other.id]);
    await asSuperuser(`INSERT INTO opportunities (name, owner_id) VALUES ('Ordinary (S23 6)', $1)`, [visitor.id]);
    await as(visitor, (q) => q(`SELECT archive_response($1, 'withdrawn')`, [first]));
    // archive_response rolls back with as(); archive for real, then a new try is allowed.
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [first]);
    expect(await makeTry(visitor)).toBeTruthy();
  });

  it('7. a try stays a try, and an ordinary response stays ordinary', async () => {
    const owner7 = await createUser({ name: 'Try owner (S23 7)' });
    const t = await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('Fixed try (S23 7)', $1, true) RETURNING id`, [owner7.id]).then((r) => r.rows[0].id as string);
    const o = await response(visitor.id, { name: 'Fixed ordinary (S23 7)' });
    expect(await refused(as(owner7, (q) => q(`UPDATE opportunities SET trial = false WHERE id = $1`, [t])))).toMatch(/permission denied/i);
    expect(await refused(as(visitor, (q) => q(`UPDATE opportunities SET trial = true WHERE id = $1`, [o])))).toMatch(/permission denied/i);
    expect(await refused(as(admin, (q) => q(`UPDATE opportunities SET trial = false WHERE id = $1`, [t])))).toMatch(/permission denied/i);
  });

  it('7. nobody makes a try for someone else, and a signed-out caller makes none', async () => {
    expect(await refused(as(visitor, (q) => q(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('For another (S23 7)', $1, true)`, [other.id])))).toMatch(/permission denied/i);
    expect(await refused(as(null, (q) => q(`INSERT INTO opportunities (name, trial) VALUES ('Anonymous (S23 7)', true)`)))).toMatch(/permission denied|row-level security/i);
  });

  it('the overview says which responses are tries, to everyone who reads them (Q2: the lists filter, access is unchanged)', async () => {
    const t = await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('Listed try (S23)', $1, true) RETURNING id`, [admin.id]).then((r) => r.rows[0].id as string);
    for (const u of [visitor, other, admin]) {
      const row = await as(u, async (q) => (await q<{ trial: boolean }>(`SELECT trial FROM response_overview WHERE id = $1`, [t])).rows[0]);
      expect(row).toEqual({ trial: true });
    }
  });
});

describe('S23-1 3: marking a try as sent learns nothing', () => {
  it('records it as sent, adds or proposes no entry, confirms no entry, and says why', async () => {
    const cited = await entry({ question: 'How is data at rest protected (S23)?', answer: 'AES-256.', lastReviewedAt: '2026-01-01' });
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE owner_id = $1 AND trial AND archived_at IS NULL`, [visitor.id]);
    const t = await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('Sent try (S23 3)', $1, true) RETURNING id`, [visitor.id]).then((r) => r.rows[0].id as string);
    const s = await session(t);
    const edited = await question(s, { text: 'Do you encrypt backups (S23)?', sources: [cited.ref] });
    const asIs = await question(s, { text: 'Is data at rest encrypted (S23)?', sources: [cited.ref] });
    const pricing = await question(s, { text: 'What does it cost (S23)?', gate: 'pricing', draftKind: 'person_required' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'A visitor''s own words (S23).' WHERE id = $1`, [edited]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = generated_answer WHERE id = $1`, [asIs]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Ask us (S23).' WHERE id = $1`, [pricing]);
    const entriesBefore = Number((await one<{ n: string }>(`SELECT count(*) AS n FROM kb_entries`)).n);
    const reviewedBefore = (await one<{ at: string }>(`SELECT last_reviewed_at AS at FROM kb_entries WHERE id = $1`, [cited.id])).at;

    const result = await as(visitor, async (q) => {
      const r = (await q<{ r: Record<string, number> }>(`SELECT record_response_export(test_only.response_of($1)) AS r`, [s])).rows[0].r;
      const after = (await q<{ n: string }>(`SELECT count(*) AS n FROM kb_entries`)).rows[0].n;
      expect(Number(after)).toBe(entriesBefore);
      const reviewed = (await q<{ at: string }>(`SELECT last_reviewed_at AS at FROM kb_entries WHERE id = $1`, [cited.id])).rows[0].at;
      expect(String(reviewed)).toBe(String(reviewedBefore));
      const outcomes = (await q<{ o: string }>(`SELECT learn_outcome AS o FROM rfi_questions WHERE session_id = $1 ORDER BY position`, [s])).rows.map((x) => x.o);
      expect(outcomes).toEqual(['not_learned_try', 'not_learned_try', 'not_learned_try']);
      const sent = (await q<{ at: string | null }>(`SELECT exported_at AS at FROM rfi_sessions WHERE id = $1`, [s])).rows[0].at;
      expect(sent).not.toBeNull();
      const audit = (await q<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE action = 'kb.confirmed' AND target_id IN ($1, $2)`, [edited, asIs])).rows[0].n;
      expect(Number(audit)).toBe(0);
      return r;
    });
    expect(result).toMatchObject({ not_learned_try: 3, accepted: 3 });
  });

  it('an ordinary response still learns, as before (control)', async () => {
    const o = await response(visitor.id, { name: 'Ordinary sent (S23 3)' });
    const s = await session(o);
    const id = await question(s, { text: 'Do you run penetration tests (S23 control)?' });
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted', final_answer = 'Yes, yearly, by an outside firm (S23).' WHERE id = $1`, [id]);
    const r = await as(visitor, async (q) => (await q<{ r: Record<string, number> }>(`SELECT record_response_export(test_only.response_of($1)) AS r`, [s])).rows[0].r);
    expect(r.not_learned_try).toBeUndefined();
    expect(Object.keys(r).some((k) => ['added', 'proposed', 'superseded'].includes(k))).toBe(true);
  });
});

describe('S23-1 4: a try\'s questions are never gaps', () => {
  it('knowledge_gaps leaves tries out, and still lists an ordinary response\'s', async () => {
    const owner4 = await createUser({ name: 'Try owner (S23 4)' });
    const t = await asSuperuser(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('Gaps try (S23 4)', $1, true) RETURNING id`, [owner4.id]).then((r) => r.rows[0].id as string);
    const o = await response(other.id, { name: 'Gaps ordinary (S23 4)' });
    await question(await session(t), { text: 'Unanswerable in a try (S23 4)?', draftKind: 'insufficient_evidence' });
    await question(await session(o), { text: 'Unanswerable in a response (S23 4)?', draftKind: 'insufficient_evidence' });
    const gaps = await as(other, async (q) => (await q<{ g: { gaps: { question: string }[] } }>(`SELECT knowledge_gaps() AS g`)).rows[0].g.gaps.map((x) => x.question));
    expect(gaps).toContain('Unanswerable in a response (S23 4)?');
    expect(gaps).not.toContain('Unanswerable in a try (S23 4)?');
  });
});

describe('S23-1 roles', () => {
  it('the rebuilt overview is still closed to a signed-out caller', async () => {
    expect(await refused(as(null, (q) => q(`SELECT id FROM response_overview LIMIT 1`)))).toMatch(/permission denied/i);
  });

  it('the service role is unchanged: it may read tries, as any response', async () => {
    const n = await asServiceRole(async (q) => (await q<{ n: string }>(`SELECT count(*) AS n FROM opportunities WHERE trial`)).rows[0].n);
    expect(Number(n)).toBeGreaterThan(0);
  });
});

describe('Sprint 23 reviews', () => {
  it('security M1, QA 9: a try is never given to someone else, and trial never changes, for any role', async () => {
    const giver = await createUser({ name: 'Giver (S23 review)' });
    const tryId = (await asSuperuser(`INSERT INTO opportunities (name, owner_id, created_by, trial) VALUES ('Given try (S23 review)', $1, $1, true) RETURNING id`, [giver.id])).rows[0].id as string;
    for (const u of [giver, admin]) {
      expect(await refused(as(u, (q) => q(`UPDATE opportunities SET owner_id = $2 WHERE id = $1`, [tryId, other.id])))).toMatch(/cannot be given to someone else/);
    }
    expect(await refused(asServiceRole((q) => q(`UPDATE opportunities SET owner_id = $2 WHERE id = $1`, [tryId, other.id])))).toMatch(/cannot be given to someone else/);
    expect(await refused(asServiceRole((q) => q(`UPDATE opportunities SET trial = false WHERE id = $1`, [tryId])))).toMatch(/stays a try/);
    // An ordinary response can still be handed over, as before.
    const o = await response(giver.id, { name: 'Handed over (S23 review)' });
    await as(giver, (q) => q(`UPDATE opportunities SET owner_id = $2 WHERE id = $1`, [o, other.id]));
  });

  it('security L1: at most five tries a person a day', async () => {
    const keen = await createUser({ name: 'Keen visitor (S23 review)' });
    for (let i = 0; i < 5; i++) {
      await asSuperuser(`INSERT INTO opportunities (name, owner_id, created_by, trial, archived_at, outcome) VALUES ($2, $1, $1, true, now(), 'withdrawn')`, [keen.id, `Try ${i} (S23 review)`]);
    }
    expect(await refused(makeTry(keen))).toMatch(/five tries today/);
    // Tries older than a day do not count.
    await asSuperuser(`UPDATE opportunities SET created_at = now() - interval '25 hours' WHERE owner_id = $1 AND trial`, [keen.id]);
    expect(await makeTry(keen)).toBeTruthy();
  });

  it('QA 4: a try\'s questions cannot be assigned to a colleague; an ordinary response\'s can', async () => {
    const solo = await createUser({ name: 'Solo visitor (S23 review)' });
    const t = (await asSuperuser(`INSERT INTO opportunities (name, owner_id, created_by, trial) VALUES ('Solo try (S23 review)', $1, $1, true) RETURNING id`, [solo.id])).rows[0].id as string;
    const s = await session(t);
    const qid = await question(s, { text: 'Assigned in a try (S23 review)?' });
    const assign = (u: TestUser, sess: string, opp: string, id: string) => as(u, (q) => q(
      `INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, status, question_text, answer_text)
       VALUES ($1, $2, $3, $4, $5, 'pending', 'copy', '')`, [id, sess, opp, other.id, u.id]));
    expect(await refused(assign(solo, s, t, qid))).toMatch(/cannot be assigned to colleagues/);
    expect(await refused(assign(admin, s, t, qid))).toMatch(/cannot be assigned to colleagues/);
    const o = await response(solo.id, { name: 'Solo ordinary (S23 review)' });
    const s2 = await session(o);
    const q2 = await question(s2, { text: 'Assigned in a response (S23 review)?' });
    await assign(solo, s2, o, q2);
  });

  it('security L2: a try is not a use of the entries it cited, on the entry\'s page or in the overviews', async () => {
    const cited = await entry({ question: 'Cited by a try (S23 review)?', answer: 'Yes.', lastReviewedAt: '2020-01-01' });
    await asSuperuser(`UPDATE kb_entries SET tags = '{s23review}' WHERE id = $1`, [cited.id]);
    const visitorR = await createUser({ name: 'Citing visitor (S23 review)' });
    const t = (await asSuperuser(`INSERT INTO opportunities (name, owner_id, created_by, trial) VALUES ('Citing try (S23 review)', $1, $1, true) RETURNING id`, [visitorR.id])).rows[0].id as string;
    await question(await session(t), { text: 'In the try (S23 review)?', sources: [cited.ref] });
    const o = await response(visitorR.id, { name: 'Citing response (S23 review)' });
    await question(await session(o), { text: 'In the response (S23 review)?', sources: [cited.ref] });

    const detail = await as(other, async (q) => (await q<{ d: { used: { response: string }[] } }>(`SELECT entry_detail($1) AS d`, [cited.ref])).rows[0].d);
    expect(detail.used.map((u) => u.response)).toEqual(['Citing response (S23 review)']);
    const ov = await as(other, async (q) => (await q<{ o: { topics: { tag: string; citations: number }[] } }>(`SELECT knowledge_overview() AS o`)).rows[0].o);
    expect(ov.topics.find((x) => x.tag === 's23review')).toMatchObject({ citations: 1 });
    await asSuperuser(`UPDATE rfi_questions SET processed_at = now() WHERE cited_refs @> ARRAY[$1]`, [cited.ref]);
    const overdue = await as(admin, async (q) => (await q<{ ref: string; recent_citations: string }>(`SELECT ref, recent_citations FROM overdue_entries()`)).rows.find((r) => r.ref === cited.ref));
    expect(Number(overdue?.recent_citations)).toBe(1);
  });

  it('security L3: members hold only read on the overview view', async () => {
    const r = await one<{ ins: boolean; upd: boolean; del: boolean; sel: boolean }>(
      `SELECT has_table_privilege('authenticated', 'public.response_overview', 'INSERT') AS ins,
              has_table_privilege('authenticated', 'public.response_overview', 'UPDATE') AS upd,
              has_table_privilege('authenticated', 'public.response_overview', 'DELETE') AS del,
              has_table_privilege('authenticated', 'public.response_overview', 'SELECT') AS sel`);
    expect(r).toEqual({ ins: false, upd: false, del: false, sel: true });
  });

  it('security L6: an admin makes a try of their own like anyone, and no try for another', async () => {
    const boss = await createUser({ admin: true, name: 'Trying admin (S23 review)' });
    expect(await makeTry(boss)).toBeTruthy();
    expect(await refused(as(boss, (q) => q(`INSERT INTO opportunities (name, owner_id, trial) VALUES ('For another (S23 review)', $1, true)`, [other.id])))).toMatch(/permission denied/i);
  });
});
