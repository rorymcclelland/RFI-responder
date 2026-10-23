// Sprint 6 app changes. Test numbers refer to docs/refinement/sprint-6.md.
import { describe, expect, it, vi } from 'vitest';
import { approvalLabel, assignmentPeople, checkerSummary } from './format';
import { saveQuestionPatch } from './sessions';
import { toQuestion, type QuestionRow } from '../workspace/questionRows';

const row = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: 'q1', session_id: 's1', position: 0, question: 'Which SIEM do you use?', generated_answer: 'We use one.', final_answer: null,
  confidence: 0.9, retrieval_score: 0.6, sources_json: [], status: 'pending', ...over,
} as QuestionRow);

describe('S6-3 the checker on the card', () => {
  it('maps the verdict, chosen entry and reason from the row', () => {
    const q = toQuestion(row({ verdict: 'partly', judge_best_ref: 'KB-0012', judge_reason: 'Covers monitoring, not regions.', judge_model: 'claude-haiku-5-5' }), new Map());
    expect(q.checker).toEqual({ verdict: 'partly', bestRef: 'KB-0012', reason: 'Covers monitoring, not regions.' });
  });

  it('summarises a verdict with its entry and reason', () => {
    expect(checkerSummary({ verdict: 'partly', bestRef: 'KB-0012', reason: 'Covers monitoring, not regions.' }, 'claude-haiku-5-5'))
      .toEqual({ label: 'Partly', detail: 'KB-0012: Covers monitoring, not regions.' });
    expect(checkerSummary({ verdict: 'no', bestRef: null, reason: null }, 'claude-haiku-5-5')).toEqual({ label: 'No', detail: null });
  });

  it('3. a failed check reads "not available", never a verdict', () => {
    expect(checkerSummary({ verdict: null, bestRef: null, reason: null }, 'claude-haiku-5-5')).toEqual({ label: 'Not available', detail: null });
  });

  it('4. no checker configured, or an old question with a verdict but no reason', () => {
    expect(checkerSummary({ verdict: null, bestRef: null, reason: null }, null)).toBeNull();
    expect(checkerSummary({ verdict: 'yes', bestRef: 'KB-0001', reason: null }, 'claude-haiku-5-5')).toEqual({ label: 'Yes', detail: 'KB-0001' });
  });

  it('2. markup in a reason stays text (it is rendered by React, never as HTML)', () => {
    const s = checkerSummary({ verdict: 'yes', bestRef: 'KB-0001', reason: '<img src=x onerror=alert(1)>' }, 'm');
    expect(s?.detail).toBe('KB-0001: <img src=x onerror=alert(1)>');
  });
});

describe('S6-5 a refused save is reported', () => {
  const client = (rows: unknown[] | null, error: unknown = null) => {
    const select = vi.fn().mockResolvedValue({ data: rows, error });
    return { client: { from: () => ({ update: () => ({ eq: () => ({ select }) }) }) } as never, select };
  };

  it('1. no row updated: an error saying it was not saved', async () => {
    await expect(saveQuestionPatch(client([]).client, 'q1', { status: 'accepted' })).rejects.toThrow(/not saved.*cannot change this question/);
  });
  it('2. an error is reported as before', async () => {
    await expect(saveQuestionPatch(client(null, { message: 'boom' }).client, 'q1', { status: 'skipped' })).rejects.toThrow(/not saved: boom/);
  });
  it('3. one row updated: saved, and the updated row is asked for', async () => {
    const c = client([{ id: 'q1' }]);
    await expect(saveQuestionPatch(c.client, 'q1', { finalAnswer: 'x', status: 'accepted' })).resolves.toBeUndefined();
    expect(c.select).toHaveBeenCalledWith('id');
  });
});

describe('S6-6 bulk approvals say how they were made', () => {
  it('1-3', () => {
    expect(approvalLabel({ kind: 'bulk', threshold: 0 })).toBe('bulk, all eligible');
    expect(approvalLabel({ kind: 'bulk', threshold: 0.8 })).toBe('bulk at 80%');
    expect(approvalLabel({ kind: 'bulk', threshold: null })).toBe('bulk');
    expect(approvalLabel({ kind: 'individual', threshold: null })).toBe('');
  });
});

describe('S6-7 the Sent list names the assignee', () => {
  const a = { assignedByProfile: { displayName: 'Sarah Chen' }, assignedToProfile: { displayName: 'Maya Patel' } };
  it('1. Sent shows who it went to', () => expect(assignmentPeople('sent', a)).toBe('to Maya Patel'));
  it('2. My Inbox shows who assigned it; All shows both', () => {
    expect(assignmentPeople('mine', a)).toBe('by Sarah Chen');
    expect(assignmentPeople('all', a)).toBe('by Sarah Chen, to Maya Patel');
  });
  it('3. an unreadable profile reads "a colleague"', () => {
    expect(assignmentPeople('sent', { assignedByProfile: null, assignedToProfile: null })).toBe('to a colleague');
    expect(assignmentPeople('mine', { assignedByProfile: undefined, assignedToProfile: null })).toBe('by a colleague');
  });
});
