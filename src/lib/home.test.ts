// Sprint 19, S19-3 (U-4): Home. Test numbers: docs/refinement/sprint-19.md.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { needsYou, yourResponses } = await import('./home');
type A = import('./myAssignments').MyAssignment;

const names = new Map([['priya', 'Priya Sharma'], ['james', 'James Okafor']]);
const asg = (o: Partial<A> = {}, q: Partial<A['question']> = {}): A => ({
  id: 'a1', status: 'pending', notes: null, answerText: null, assignedTo: 'james', assignedBy: 'priya', createdAt: '2026-10-01', updatedAt: 'x',
  responseId: 'r1', response: 'Bluefin', dueDate: '2026-11-05', ownerId: 'priya', sessionId: 's1',
  question: { id: 'q1', text: 'Q?', position: 0, status: 'pending', generatedAnswer: 'D', finalAnswer: 'D', draftKind: 'generated',
    confidence: 0.5, verdict: 'yes', judgeReason: null, gate: null, gateReason: null, language: 'en', citedRefs: [], sources: [], ...q },
  ...o,
});
const resp = (o: Record<string, unknown> = {}) => ({ id: 'r1', name: 'Bluefin', ownerId: 'priya', archivedAt: null, exportedAt: null,
  dueDate: '2026-10-30', overdue: false, atRisk: false, total: 10, pending: 4, ...o }) as never;
const kb = (states: Record<string, number>) => ({ states: { reviewed: 0, waiting: 0, translations: 0, proposals: 0, overdue: 0, retired: 0, ...states } }) as never;

describe('needsYou', () => {
  it('1. orders questions for you by due date, then answers from colleagues, then responses, then the admin line', () => {
    const items = needsYou({
      me: 'priya', isAdmin: true, names,
      toMe: [asg({ id: 'late', dueDate: '2026-12-01', assignedTo: 'priya', assignedBy: 'james' }), asg({ id: 'soon', dueDate: '2026-11-01', assignedTo: 'priya', assignedBy: 'james' })],
      fromMe: [asg({ id: 'ans', status: 'answered', answerText: 'Yes.' })],
      responses: [resp({ atRisk: true })],
      knowledge: kb({ translations: 30 }),
    });
    expect(items.map((i) => i.key)).toEqual(['for-you-soon', 'for-you-late', 'answered-ans', 'response-r1', 'review']);
    expect(items[2].detail).toBe('James Okafor answered · Bluefin');
    expect(items[3].detail).toBe('At risk: due 30 Oct, with 4 questions still to do');
    expect(items[4].detail).toBe('30 translations to check');
  });

  it('1. a member never sees the admin line', () => {
    expect(needsYou({ me: 'james', isAdmin: false, names, toMe: [], fromMe: [], responses: [], knowledge: kb({ waiting: 3 }) })).toEqual([]);
  });

  it('2. leaves out what is decided, answered already, or not the person\'s', () => {
    const items = needsYou({
      me: 'james', isAdmin: false, names,
      toMe: [asg({ id: 'decided' }, { status: 'accepted' }), asg({ id: 'sent', status: 'answered', answerText: 'Mine.' }), asg({ id: 'open' })],
      fromMe: [asg({ id: 'asked' }), asg({ id: 'decided2', status: 'answered', answerText: 'x' }, { status: 'accepted' })],
      responses: [resp({ ownerId: 'priya', atRisk: true }), resp({ id: 'r2', ownerId: 'james', overdue: false, atRisk: false })],
      knowledge: null,
    });
    expect(items.map((i) => i.key)).toEqual(['for-you-open']);
    expect(items[0].detail).toBe('Priya Sharma asked you · Bluefin · due 5 Nov');
  });

  it('a handed-back question says so, with the note', () => {
    const [i] = needsYou({ me: 'priya', isAdmin: false, names, toMe: [], fromMe: [asg({ status: 'answered', answerText: '', notes: 'Ask legal.' })], responses: [], knowledge: null });
    expect(i.detail).toBe('James Okafor handed this back: Ask legal. · Bluefin');
    expect(i.action).toEqual({ kind: 'question', target: { responseId: 'r1', sessionId: 's1', questionId: 'q1' } });
  });

  it('a hand-back with an empty note says there was none', () => {
    const [i] = needsYou({ me: 'priya', isAdmin: false, names, toMe: [], fromMe: [asg({ status: 'answered', answerText: '', notes: ' ' })], responses: [], knowledge: null });
    expect(i.detail).toBe('James Okafor handed this back: no note · Bluefin');
  });

  it('3. nothing needs you: an empty list', () => {
    expect(needsYou({ me: 'x', isAdmin: true, names, toMe: [], fromMe: [], responses: [], knowledge: kb({}) })).toEqual([]);
  });

  it('a response with no questions yet says so', () => {
    const [i] = needsYou({ me: 'priya', isAdmin: false, names, toMe: [], fromMe: [], responses: [resp({ overdue: true, total: 0, pending: 0 })], knowledge: null });
    expect(i.detail).toBe('Overdue: it was due 30 Oct, with no questions added yet');
  });
});

describe('yourResponses', () => {
  it('lists your responses in progress, soonest due first', () => {
    const r = yourResponses([resp({ id: 'b', dueDate: '2026-12-01' }), resp({ id: 'a', dueDate: '2026-11-01' }), resp({ id: 'x', exportedAt: 'y' }), resp({ id: 'o', ownerId: 'other' })], 'priya');
    expect(r.map((x: { id: string }) => x.id)).toEqual(['a', 'b']);
  });
});
