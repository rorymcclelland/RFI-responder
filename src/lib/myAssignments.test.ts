// Sprint 19, S19-1 (U-3): questions for you. Test numbers: docs/refinement/sprint-19.md.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const m = await import('./myAssignments');
type A = import('./myAssignments').MyAssignment;

const a = (o: Partial<A> = {}, q: Partial<A['question']> = {}): A => ({
  id: 'a1', status: 'pending', notes: null, answerText: 'copy', assignedTo: 'me', assignedBy: 'owner', createdAt: 'x', updatedAt: 'x',
  responseId: 'r1', response: 'Bluefin', dueDate: null, ownerId: 'owner', sessionId: 's1',
  question: { id: 'q1', text: 'Q?', position: 0, status: 'pending', generatedAnswer: 'Draft.', finalAnswer: 'Draft.', draftKind: 'generated',
    confidence: 0.9, verdict: 'yes', judgeReason: 'r', gate: null, gateReason: null, language: 'en', citedRefs: ['KB-0001'], sources: [], ...q },
  ...o,
});

/** A client that records writes, and can refuse the nth update. */
function client(refuse: number[] = []) {
  const calls: { table: string; patch: Record<string, unknown> }[] = [];
  let n = 0;
  return {
    calls,
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({ eq: () => ({ select: async () => {
        n++; calls.push({ table, patch });
        return refuse.includes(n) ? { data: [], error: null } : { data: [{ id: 'x' }], error: null };
      } }) }),
    }),
  };
}

describe('forYouState (test 9)', () => {
  it('words each state, and whether there is anything left to do', () => {
    expect(m.forYouState(a())).toEqual({ label: 'Asked', open: true });
    expect(m.forYouState(a({ status: 'in_review' }))).toEqual({ label: 'Working on it', open: true });
    expect(m.forYouState(a({ status: 'answered', answerText: 'Mine.' })).label).toMatch(/sent your answer/);
    expect(m.forYouState(a({ status: 'answered', answerText: '  ' })).label).toMatch(/handed this back/);
    // 6. A question the owner has decided needs nothing more.
    expect(m.forYouState(a({}, { status: 'accepted' }))).toMatchObject({ open: false });
    expect(m.forYouState(a({}, { status: 'skipped' }))).toMatchObject({ open: false });
  });
});

describe('startingAnswer', () => {
  it('starts from the answer sent, else the current answer', () => {
    expect(m.startingAnswer(a({ status: 'answered', answerText: 'Mine.' }))).toBe('Mine.');
    expect(m.startingAnswer(a({}, { finalAnswer: 'Edited by the owner.' }))).toBe('Edited by the owner.');
  });
  it('7. starts empty when there is no draft (pricing, or nothing to draft from)', () => {
    expect(m.startingAnswer(a({}, { draftKind: 'person_required', generatedAnswer: 'A person must answer.', finalAnswer: 'A person must answer.' }))).toBe('');
  });
});

describe('answerProblem and handBackProblem (tests 5, 7, 8)', () => {
  it('needs an answer, written by a person when there is no draft, of at most 20,000 characters', () => {
    expect(m.answerProblem(a(), '  ')).toMatch(/Write the answer/);
    expect(m.answerProblem(a(), 'x'.repeat(20001))).toMatch(/20,000/);
    expect(m.answerProblem(a({}, { draftKind: 'person_required', generatedAnswer: 'P.' }), 'P.')).toMatch(/no draft/);
    expect(m.answerProblem(a(), 'Yes.')).toBeNull();
  });
  it('needs a note of 5 to 500 characters to hand back', () => {
    for (const n of ['', ' ', 'no', 'abcd']) expect(m.handBackProblem(n), n).toMatch(/at least 5/);
    expect(m.handBackProblem('x'.repeat(501))).toMatch(/500/);
    expect(m.handBackProblem('Ask the legal team.')).toBeNull();
  });
});

describe('the actions (tests 3 to 5)', () => {
  it('3. approve: the answer, then the decision, then the assignment', async () => {
    const c = client();
    await m.approveAssigned(c as never, a(), 'Yes, AES-256.');
    expect(c.calls.map((x) => [x.table, Object.keys(x.patch).sort().join(',')])).toEqual([
      ['rfi_questions', 'final_answer'], ['rfi_questions', 'status'], ['question_assignments', 'answer_text,completed_at,status,updated_at'],
    ]);
    expect(c.calls[1].patch.status).toBe('accepted');
    expect(c.calls[2].patch.status).toBe('approved');
  });
  it('3. says plainly when the question was approved but the assignment did not move', async () => {
    await expect(m.approveAssigned(client([3]) as never, a(), 'Yes.')).rejects.toThrow(/^The question is approved, but your assignment was not saved/);
  });
  it('4. send to the owner touches only the assignment', async () => {
    const c = client();
    await m.sendToOwner(c as never, a(), 'Yes, AES-256.');
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ table: 'question_assignments', patch: { status: 'answered', answer_text: 'Yes, AES-256.' } });
  });
  it('5. hand back saves the note and no answer, and refuses without a note', async () => {
    const c = client();
    await expect(m.handBack(c as never, a(), 'no')).rejects.toThrow();
    expect(c.calls).toHaveLength(0);
    await m.handBack(c as never, a(), '  Ask the legal team.  ');
    expect(c.calls[0]).toMatchObject({ table: 'question_assignments', patch: { status: 'answered', answer_text: '', notes: 'Ask the legal team.' } });
    expect(m.isHandedBack({ status: 'answered', answerText: '' })).toBe(true);
  });
  it('opening an asked question moves it to Working on it, once', async () => {
    const c = client();
    expect(await m.startWorking(c as never, a())).toBe(true);
    expect(await m.startWorking(c as never, a({ status: 'in_review' }))).toBe(false);
    expect(c.calls).toEqual([expect.objectContaining({ patch: expect.objectContaining({ status: 'in_review' }) })]);
  });
});
