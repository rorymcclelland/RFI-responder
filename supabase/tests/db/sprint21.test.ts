// Sprint 21: gaps (S21-2). Test numbers refer to docs/refinement/sprint-21.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let owner: TestUser;
let member: TestUser;
let admin: TestUser;

interface Gap { question: string; state: string; responses: number; entryRef: string | null; responseId: string; response: string; sessionId: string; questionId: string }
const result = (u: TestUser | null) => as(u, async (q) => (await q(`SELECT public.knowledge_gaps() AS g`)).rows[0].g as { total: number; gaps: Gap[] });
const gaps = async (u: TestUser | null) => (await result(u)).gaps;
const find = (list: Gap[], text: RegExp) => list.filter((g) => text.test(g.question));

/** A question the knowledge base could not answer, in a new response's file. */
async function gap(text: string, o: { name?: string; daysAgo?: number; status?: string; final?: string; gate?: string; draftKind?: string } = {}) {
  const opp = await response(owner.id, { name: o.name ?? `Response for ${text}` });
  const s = await session(opp);
  if (o.daysAgo) await asSuperuser(`UPDATE rfi_sessions SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [s, o.daysAgo]);
  const id = await question(s, { text, generated: 'Insufficient evidence: a person writes this.', draftKind: o.draftKind ?? 'insufficient_evidence', gate: o.gate ?? null, cited: [] });
  if (o.final) await asSuperuser(`UPDATE rfi_questions SET final_answer = $2 WHERE id = $1`, [id, o.final]);
  if (o.status) await asSuperuser(`UPDATE rfi_questions SET status = $2 WHERE id = $1`, [id, o.status]);
  return { opp, s, id };
}

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Priya Owner' });
  member = await createUser({ name: 'James Member' });
  admin = await createUser({ admin: true, name: 'Sarah Admin' });
});
afterAll(closePool);

describe('S21-2 knowledge_gaps()', () => {
  it('1. lists a question from the last 90 days; not one from 91 days ago, archived or not', async () => {
    const recent = await gap('In which regions is data stored (S21 1a)?', { daysAgo: 89 });
    await gap('Who is your data protection officer (S21 1b)?', { daysAgo: 91 });
    const old = await gap('What is your staff turnover (S21 1c)?', { daysAgo: 120 });
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'won' WHERE id = $1`, [old.opp]);
    const list = await gaps(member);
    expect(find(list, /S21 1a/)).toMatchObject([{ state: 'open', responses: 1, questionId: recent.id, sessionId: recent.s, responseId: recent.opp }]);
    expect(find(list, /S21 1b|S21 1c/)).toEqual([]);
  });

  it('1. lists only questions the knowledge base could not answer', async () => {
    await gap('How do you encrypt data at rest (S21 1d)?', { draftKind: 'generated' });
    expect(find(await gaps(member), /S21 1d/)).toEqual([]);
  });

  it('2. never lists pricing questions, whatever their state', async () => {
    await gap('What are your fees (S21 2a)?', { draftKind: 'person_required', gate: 'pricing' });
    await gap('What does support cost (S21 2b)?', { gate: 'pricing' });
    await gap('What is the price per user (S21 2c)?', { gate: 'pricing', final: '£10 a month.', status: 'accepted' });
    expect(find(await gaps(member), /S21 2/)).toEqual([]);
  });

  it('3. the same wording but for case, spaces and punctuation forms one group, with how many responses asked it', async () => {
    await gap('Do you offer on-site training (S21 3)?', { name: 'Acme (S21 3)' });
    await gap('  do you offer ON SITE training   (s21 3)', { name: 'Bluefin (S21 3)' });
    await gap('Do you offer remote training (S21 3)?', { name: 'Acme (S21 3) again' });
    const list = find(await gaps(member), /\(s21 3\)/i);
    expect(list.map((g) => g.responses).sort()).toEqual([1, 2]);
    expect(list.find((g) => g.responses === 2)?.question).toMatch(/on.site training/i);
  });

  it('3. groups Japanese questions too, ignoring full-width punctuation', async () => {
    await gap('データはどこに保存されますか？（S21 3j）', { name: 'Japan A (S21 3j)' });
    await gap('データはどこに保存されますか（S21 3j）', { name: 'Japan B (S21 3j)' });
    expect(find(await gaps(member), /S21 3j/).map((g) => g.responses)).toEqual([2]);
  });

  it('4. each state: learned (with its entry), answered and not yet sent, still to do, left unanswered', async () => {
    const learned = await gap('Learned question (S21 4a)?', { final: 'A person wrote this.', status: 'accepted' });
    const e = await entry({ question: 'Learned question (S21 4a)?', answer: 'A person wrote this.', origin: 'response' });
    await asSuperuser(`UPDATE rfi_questions SET learned_at = now(), learn_outcome = 'added', learned_entry_id = $2 WHERE id = $1`, [learned.id, e.id]);
    await gap('Answered question (S21 4b)?', { final: 'Answered, not yet sent.', status: 'accepted' });
    await gap('Open question (S21 4c)?');
    await gap('Unanswered question (S21 4d)?', { status: 'skipped' });
    const notLearned = await gap('Not learned question (S21 4e)?', { final: 'Considered, not added.', status: 'accepted' });
    await asSuperuser(`UPDATE rfi_questions SET learned_at = now(), learn_outcome = 'not_learned_unchecked' WHERE id = $1`, [notLearned.id]);
    const archivedOpen = await gap('Open in an archived response (S21 4f)?');
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'lost' WHERE id = $1`, [archivedOpen.opp]);
    const list = await gaps(member);
    const state = (t: RegExp) => find(list, t).map((g) => [g.state, g.entryRef]);
    expect(state(/S21 4a/)).toEqual([['learned', e.ref]]);
    expect(state(/S21 4b/)).toEqual([['answered', null]]);
    expect(state(/S21 4c/)).toEqual([['open', null]]);
    expect(state(/S21 4d/)).toEqual([['unanswered', null]]);
    expect(state(/S21 4e/)).toEqual([['not_learned', null]]);
    expect(state(/S21 4f/)).toEqual([['unanswered', null]]);
    // Still to do comes first.
    expect(list.findIndex((g) => g.state === 'open')).toBe(0);
  });

  it('4. a group stands where its furthest question stands, and opens that one', async () => {
    await gap('Do you have a bug bounty (S21 4g)?', { name: 'One (S21 4g)' });
    const answered = await gap('Do you have a bug bounty (S21 4g)?', { name: 'Two (S21 4g)', final: 'Yes, since 2025.', status: 'accepted' });
    expect(find(await gaps(member), /S21 4g/)).toMatchObject([{ state: 'answered', responses: 2, questionId: answered.id }]);
  });

  it('4. (QA review) learned means a current entry: a proposed change and a retired entry say so; an answer in a response archived unsent is not learned', async () => {
    const proposed = await gap('Proposed question (S21 4h)?', { final: 'A change.', status: 'accepted' });
    const base = await entry({ question: 'Proposed question (S21 4h) base?' });
    const p = await one<{ id: string }>(`INSERT INTO kb_entries (question, answer, tags, origin, proposed_replacement_of) VALUES ('Proposed question (S21 4h)?', 'A change.', '{}', 'response', $1) RETURNING id`, [base.id]);
    await asSuperuser(`UPDATE rfi_questions SET learned_at = now(), learned_entry_id = $2 WHERE id = $1`, [proposed.id, p.id]);
    const retired = await gap('Retired question (S21 4i)?', { final: 'Old.', status: 'accepted' });
    const e = await entry({ question: 'Retired question (S21 4i)?', answer: 'Old.' });
    await asSuperuser(`UPDATE kb_entries SET retired_at = now(), retired_reason = 'No longer true.' WHERE id = $1`, [e.id]);
    await asSuperuser(`UPDATE rfi_questions SET learned_at = now(), learned_entry_id = $2 WHERE id = $1`, [retired.id, e.id]);
    const unsent = await gap('Withdrawn question (S21 4j)?', { final: 'Answered.', status: 'accepted' });
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [unsent.opp]);
    const list = await gaps(member);
    expect(find(list, /S21 4h/).map((g) => g.state)).toEqual(['proposed']);
    expect(find(list, /S21 4i/).map((g) => g.state)).toEqual(['not_learned']);
    expect(find(list, /S21 4j/).map((g) => g.state)).toEqual(['not_learned']);
  });

  it('(security review) at most 500 groups, still to do first, each question cut to 500 characters, with the total', async () => {
    const opp = await response(owner.id, { name: 'Bounded (S21 sec5)' });
    const s = await session(opp);
    await asSuperuser(`INSERT INTO rfi_questions (session_id, position, question, generated_answer, status, language, draft_kind, processed_at)
      SELECT $1, g, 'Bounded ' || g || ' (S21 sec5)? ' || repeat('x', 2000), 'Insufficient evidence.', 'pending', 'en', 'insufficient_evidence', now()
        FROM generate_series(1, 600) g`, [s]);
    const r = await result(member);
    expect(r.gaps).toHaveLength(500);
    expect(r.total).toBeGreaterThan(600);
    expect(Math.max(...r.gaps.map((g) => g.question.length))).toBeLessThanOrEqual(500);
    expect(r.gaps.every((g) => g.state === 'open')).toBe(true);
    await asSuperuser(`DELETE FROM rfi_questions WHERE session_id = $1`, [s]);
  }, 60000);

  it('6. every member sees the same gaps; a visitor and the service role are refused', async () => {
    await gap('Who sees this (S21 6)?');
    const forMember = await gaps(member);
    expect(await gaps(owner)).toEqual(forMember);
    expect(await gaps(admin)).toEqual(forMember);
    expect(find(forMember, /S21 6/)).toHaveLength(1);
    expect(await refused(gaps(null))).toMatch(/permission denied/);
    expect(await refused(asServiceRole((q) => q(`SELECT public.knowledge_gaps()`)))).toMatch(/permission denied/);
    const def = await one<{ definer: boolean; config: string[]; volatile: string }>(
      `SELECT prosecdef AS definer, proconfig AS config, provolatile AS volatile FROM pg_proc WHERE proname = 'knowledge_gaps'`);
    expect(def).toEqual({ definer: false, config: ['search_path=""'], volatile: 's' });
  });

  it('7. a question\'s markup is returned as it was written, for the app to show as text', async () => {
    await gap('<img src=x onerror=alert(1)> Do you scan for malware (S21 7)?');
    expect(find(await gaps(member), /S21 7/)[0].question).toBe('<img src=x onerror=alert(1)> Do you scan for malware (S21 7)?');
  });

  it('8. answers in under a second with 5,000 questions', async () => {
    const opp = await response(owner.id, { name: 'Many (S21 8)' });
    const s = await session(opp);
    await asSuperuser(`INSERT INTO rfi_questions (session_id, position, question, generated_answer, status, language, draft_kind, processed_at)
      SELECT $1, g, 'Scale question ' || (g % 2500) || ' (S21 8)?', 'Insufficient evidence.', CASE WHEN g % 3 = 0 THEN 'skipped' ELSE 'pending' END,
             'en', CASE WHEN g % 5 = 0 THEN 'generated' ELSE 'insufficient_evidence' END, now()
        FROM generate_series(1, 5000) g`, [s]);
    await asSuperuser('ANALYZE rfi_questions');
    const t = Date.now();
    const list = await gaps(member);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(find(list, /S21 8/).length).toBeGreaterThan(400);
  }, 60000);
});

describe('BUG-45 approve_answer()', () => {
  const approve = (u: TestUser | null, id: string, text: string, onlyPending = false) =>
    as(u, async (q) => (await q(`SELECT public.approve_answer($1, $2, $3) AS r`, [id, text, onlyPending])).rows[0].r as string);
  const state = (id: string) => one<{ status: string; final_answer: string | null }>(`SELECT status, final_answer FROM rfi_questions WHERE id = $1`, [id]);
  let expert: TestUser;
  beforeAll(async () => { expert = await createUser({ name: 'Lisa Expert' }); });

  /** A question on the owner's response, assigned to the expert. */
  async function assigned(text: string) {
    const opp = await response(owner.id, { name: `Approve (${text})` });
    const s = await session(opp);
    const id = await question(s, { text, generated: 'The draft.' });
    await one(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, status, question_text)
      VALUES ($1, $2, $3, $4, $5, 'pending', $6) RETURNING id`, [id, s, opp, expert.id, owner.id, text]);
    return id;
  }

  it('saves the text and approves it, recording who approved it', async () => {
    const id = await assigned('Approve in one step (BUG-45 1)?');
    expect(await as(owner, async (q) => {
      expect((await q(`SELECT public.approve_answer($1, 'The owner''s answer.') AS r`, [id])).rows[0].r).toBe('approved');
      return (await q(`SELECT q.status, q.final_answer, a.decided_by FROM rfi_questions q JOIN approvals a ON a.question_id = q.id WHERE q.id = $1`, [id])).rows[0];
    })).toEqual({ status: 'accepted', final_answer: "The owner's answer.", decided_by: owner.id });
  });

  it('role matrix: the owner, an admin and the assignee may; another member, a visitor and the service role may not', async () => {
    const id = await assigned('Who may approve (BUG-45 2)?');
    expect(await approve(owner, id, 'A.')).toBe('approved');
    expect(await approve(admin, id, 'A.')).toBe('approved');
    expect(await approve(expert, id, 'A.')).toBe('approved');
    expect(await approve(member, id, 'A.')).toBe('refused');
    expect(await refused(approve(null, id, 'A.'))).toMatch(/permission denied/);
    expect(await refused(asServiceRole((q) => q(`SELECT public.approve_answer($1, 'A.')`, [id])))).toMatch(/permission denied/);
    expect(await state(id)).toEqual({ status: 'pending', final_answer: null });
    const def = await one<{ definer: boolean; config: string[] }>(`SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname = 'approve_answer'`);
    expect(def).toEqual({ definer: false, config: ['search_path=""'] });
  });

  it('only_pending: a question decided meanwhile is left as it is', async () => {
    const id = await assigned('Decided meanwhile (BUG-45 3)?');
    await asSuperuser(`UPDATE rfi_questions SET final_answer = 'The owner''s.', status = 'accepted' WHERE id = $1`, [id]);
    expect(await approve(expert, id, 'Stale text.', true)).toBe('decided');
    expect(await state(id)).toEqual({ status: 'accepted', final_answer: "The owner's." });
  });

  it('revising an approved answer approves the new text in one step', async () => {
    const id = await assigned('Revise (BUG-45 4)?');
    await asSuperuser(`UPDATE rfi_questions SET final_answer = 'First.' WHERE id = $1`, [id]);
    await asSuperuser(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [id]);
    // In one transaction (as() rolls back afterwards): the changed text reopens it, and it is approved again.
    expect(await as(owner, async (q) => {
      expect((await q(`SELECT public.approve_answer($1, 'Second.') AS r`, [id])).rows[0].r).toBe('approved');
      return (await q(`SELECT status, final_answer FROM rfi_questions WHERE id = $1`, [id])).rows[0];
    })).toEqual({ status: 'accepted', final_answer: 'Second.' });
  });

  it('a refused decision saves no text either', async () => {
    const id = await assigned('Refused decision (BUG-45 5)?');
    // A rule that refuses this question's decision (and nothing else), standing in for any rule that
    // refuses a decision after the text was written.
    await asSuperuser(`CREATE FUNCTION pg_temp_refuse() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.id = '${id}' AND NEW.status = 'accepted' THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $f$`);
    await asSuperuser(`CREATE TRIGGER zz_refuse_test BEFORE UPDATE OF status ON rfi_questions FOR EACH ROW EXECUTE FUNCTION pg_temp_refuse()`);
    try {
      // Outside a test transaction, so anything the call wrote would stay.
      const c = await (await import('./harness')).getPool().connect();
      try {
        await c.query('SET ROLE authenticated');
        await c.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: owner.id, role: 'authenticated' })]);
        expect(await refused(c.query(`SELECT public.approve_answer($1, 'Text that must not stay.')`, [id]))).toMatch(/refused for the test/);
      } finally {
        await c.query('RESET ROLE').catch(() => undefined);
        await c.query(`SELECT set_config('request.jwt.claims', '', false)`).catch(() => undefined);
        c.release();
      }
      expect(await state(id)).toEqual({ status: 'pending', final_answer: null });
    } finally {
      await asSuperuser('DROP TRIGGER zz_refuse_test ON rfi_questions');
      await asSuperuser('DROP FUNCTION pg_temp_refuse()');
    }
  });

  it('(security review) refuses to approve no text', async () => {
    const id = await assigned('No text (BUG-45 7)?');
    expect(await refused(approve(owner, id, '   '))).toMatch(/Write the answer/);
    expect(await refused(as(owner, (q) => q(`SELECT public.approve_answer($1, NULL)`, [id])))).toMatch(/Write the answer/);
  });

  it('(QA review) the other direction: the owner waits for a specialist\'s approval, then approves their own text', async () => {
    const id = await assigned('The race, reversed (BUG-45 8)?');
    const pool = (await import('./harness')).getPool();
    const first = await pool.connect();
    const second = await pool.connect();
    const begin = async (c: typeof first, u: TestUser) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })]);
    };
    try {
      await begin(first, expert);
      expect((await first.query(`SELECT public.approve_answer($1, 'The expert''s answer.', true) AS r`, [id])).rows[0].r).toBe('approved');
      await begin(second, owner);
      const waiting = second.query(`SELECT public.approve_answer($1, 'The owner''s answer.') AS r`, [id]);
      let settled = false;
      void waiting.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await first.query('COMMIT');
      expect((await waiting).rows[0].r).toBe('approved');
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
    // The owner's approval is of the owner's own text, never of the expert's text unseen.
    expect(await state(id)).toEqual({ status: 'accepted', final_answer: "The owner's answer." });
  });

  it('the race that staging found: a second save waits for the first, then sees the decision', async () => {
    const id = await assigned('The race (BUG-45 6)?');
    const pool = (await import('./harness')).getPool();
    const first = await pool.connect();
    const second = await pool.connect();
    const begin = async (c: typeof first, u: TestUser) => {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE authenticated');
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u.id, role: 'authenticated' })]);
    };
    try {
      await begin(first, owner);
      expect((await first.query(`SELECT public.approve_answer($1, 'The owner''s answer.') AS r`, [id])).rows[0].r).toBe('approved');
      await begin(second, expert);
      // The expert's approval, from a screen opened before, waits on the owner's transaction.
      const waiting = second.query(`SELECT public.approve_answer($1, 'The expert''s answer.', true) AS r`, [id]);
      let settled = false;
      void waiting.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await first.query('COMMIT');
      expect((await waiting).rows[0].r).toBe('decided');
      await second.query('COMMIT');
    } finally {
      await first.query('ROLLBACK').catch(() => undefined);
      await second.query('ROLLBACK').catch(() => undefined);
      first.release();
      second.release();
    }
    expect(await state(id)).toEqual({ status: 'accepted', final_answer: "The owner's answer." });
  });
});
