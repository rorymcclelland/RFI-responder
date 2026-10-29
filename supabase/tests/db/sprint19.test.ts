// Sprint 19: questions for you, and Home. Test numbers refer to docs/refinement/sprint-19.md.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, asServiceRole, asSuperuser, buildDatabase, closePool, createUser, refused, type TestUser } from './harness';
import { one, question, response, session } from './fixtures';

let owner: TestUser;
let expert: TestUser;
let other: TestUser;
let admin: TestUser;

type Row = { id: string; status: string; answerText: string | null; response: string; question: { id: string; text: string; status: string; generatedAnswer: string; finalAnswer: string | null } };
const mine = (u: TestUser | null) => as(u, async (q) => (await q(`SELECT public.my_assignments() AS m`)).rows[0].m as { toMe: Row[]; fromMe: Row[] });
const assign = (qid: string, s: string, opp: string, to: TestUser, by: TestUser, status = 'pending') =>
  one<{ id: string }>(`INSERT INTO question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, status, question_text, answer_text)
    VALUES ($1, $2, $3, $4, $5, $6, 'copy of the question', 'copy of the answer') RETURNING id`, [qid, s, opp, to.id, by.id, status]);

beforeAll(async () => {
  await buildDatabase();
  owner = await createUser({ name: 'Priya Owner' });
  expert = await createUser({ name: 'James Expert' });
  other = await createUser({ name: 'Maya Other' });
  admin = await createUser({ admin: true, name: 'Sarah Admin' });
});
afterAll(closePool);

describe('S19-1 my_assignments()', () => {
  let opp: string; let s: string; let qid: string; let aid: string;
  beforeAll(async () => {
    opp = await response(owner.id, { name: 'Bluefin (S19)' });
    s = await session(opp);
    qid = await question(s, { text: 'How do you protect data at rest (S19)?', generated: 'We encrypt it.' });
    aid = (await assign(qid, s, opp, expert, owner)).id;
  });

  it('1. returns my assignments with each question as it is now, not the copy', async () => {
    await asSuperuser(`UPDATE rfi_questions SET generated_answer = 'We encrypt it with AES-256.' WHERE id = $1`, [qid]);
    const m = await mine(expert);
    expect(m.toMe).toHaveLength(1);
    expect(m.toMe[0]).toMatchObject({ id: aid, status: 'pending', response: 'Bluefin (S19)',
      question: { id: qid, text: 'How do you protect data at rest (S19)?', generatedAnswer: 'We encrypt it with AES-256.', status: 'pending' } });
    expect(m.fromMe).toEqual([]);
  });

  it('2. role matrix: the assigner and the owner see it from them; another member, a visitor and the service role do not', async () => {
    expect((await mine(owner)).fromMe.map((r) => r.id)).toEqual([aid]);
    expect((await mine(owner)).toMe).toEqual([]);
    const o = await mine(other);
    expect(o).toEqual({ toMe: [], fromMe: [] });
    // An admin can read every assignment, but my_assignments lists only their own.
    expect(await mine(admin)).toEqual({ toMe: [], fromMe: [] });
    await refused(mine(null));
    expect(await refused(asServiceRole((q) => q(`SELECT public.my_assignments()`)))).toMatch(/permission denied/);
    const def = await one<{ definer: boolean; config: string[] }>(`SELECT prosecdef AS definer, proconfig AS config FROM pg_proc WHERE proname = 'my_assignments'`);
    expect(def).toEqual({ definer: false, config: ['search_path=""'] });
  });

  it('1. leaves out closed assignments and those on archived responses', async () => {
    const opp2 = await response(owner.id, { name: 'Archived (S19)' });
    const s2 = await session(opp2);
    const q2 = await question(s2, { text: 'Archived question (S19)?' });
    await assign(q2, s2, opp2, expert, owner);
    const q3 = await question(s, { text: 'Closed question (S19)?' });
    await assign(q3, s, opp, expert, owner, 'closed');
    expect((await mine(expert)).toMe.map((r) => r.question.text)).toContain('Archived question (S19)?');
    await asSuperuser(`UPDATE opportunities SET archived_at = now(), outcome = 'withdrawn' WHERE id = $1`, [opp2]);
    const texts = (await mine(expert)).toMe.map((r) => r.question.text);
    expect(texts).not.toContain('Archived question (S19)?');
    expect(texts).not.toContain('Closed question (S19)?');
  });

  it('3. the assignee approves the question and their assignment, as the rules allow', async () => {
    await as(expert, async (q) => {
      await q(`UPDATE rfi_questions SET final_answer = 'Yes, AES-256.' WHERE id = $1`, [qid]);
      await q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [qid]);
      await q(`UPDATE question_assignments SET status = 'approved', completed_at = now(), updated_at = now() WHERE id = $1`, [aid]);
      const ap = (await q(`SELECT decided_by, kind FROM approvals WHERE question_id = $1 ORDER BY decided_at DESC LIMIT 1`, [qid])).rows[0];
      expect(ap).toEqual({ decided_by: expert.id, kind: 'individual' });
      const m = (await q(`SELECT public.my_assignments() AS m`)).rows[0].m;
      expect(m.toMe[0]).toMatchObject({ status: 'approved', question: { status: 'accepted', finalAnswer: 'Yes, AES-256.' } });
    });
  });

  it('4 and 5. sending to the owner, or handing back, changes only the assignment; another member cannot', async () => {
    await as(expert, async (q) => {
      await q(`UPDATE question_assignments SET answer_text = 'Yes, AES-256 at rest.', status = 'answered', updated_at = now() WHERE id = $1`, [aid]);
      expect((await q(`SELECT status FROM rfi_questions WHERE id = $1`, [qid])).rows[0].status).toBe('pending');
    });
    await refused(as(other, (q) => q(`UPDATE question_assignments SET answer_text = 'x' WHERE id = $1`, [aid]).then((r) => { if (!r.rowCount) throw new Error('no rows'); })));
    await refused(as(other, (q) => q(`UPDATE rfi_questions SET status = 'accepted' WHERE id = $1`, [qid]).then((r) => { if (!r.rowCount) throw new Error('no rows'); })));
  });
});
