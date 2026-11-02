// Sprint 21: gaps (S21-2). Test numbers refer to docs/refinement/sprint-21.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { entry, one, question, response, session } from './fixtures';

let owner: TestUser;
let member: TestUser;
let admin: TestUser;

interface Gap { question: string; state: string; responses: number; entryRef: string | null; responseId: string; response: string; sessionId: string; questionId: string }
const gaps = (u: TestUser | null) => as(u, async (q) => (await q(`SELECT public.knowledge_gaps() AS g`)).rows[0].g as Gap[]);
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
    expect(find(list, /S21 8/).length).toBeGreaterThan(1500);
  }, 60000);
});
