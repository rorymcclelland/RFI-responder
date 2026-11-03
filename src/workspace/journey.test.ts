// Sprint 22 (S22-1, U-5): the questions grouped by what they need, one reason each. Test numbers
// refer to docs/refinement/sprint-22.md.
import { describe, expect, it } from 'vitest';
import type { DraftKind, QuestionGate, RFIQuestion } from '../types';
import { bulkEligible } from './questionRows';
import { ASSIGNMENT_WORD, GATE_LABEL, expertItems, groupQuestions, needReason } from './journey';
import type { QuestionAssignment } from '../types';

const base: RFIQuestion = {
  id: 'q', sessionId: 's', position: 0, customerRef: null, question: 'Q?', generatedAnswer: 'Drafted.', finalAnswer: 'Drafted.',
  confidence: 0.9, retrievalScore: 0.5, sources: [], status: 'pending', gate: null, gateReason: null, draftKind: 'generated',
  language: 'en', processingNote: null,
  provenance: { embeddingModel: null, judgeModel: null, draftModel: null, promptVersion: null, calibrationSet: null },
  processed: true, approval: null, learnOutcome: null,
  checker: { verdict: 'yes', bestRef: 'KB-0001', reason: 'r' },
};
const q = (over: Partial<RFIQuestion>, id = 'q'): RFIQuestion => ({ ...base, id, ...over });

const GATES: (QuestionGate | null)[] = [null, 'pricing', 'legal', 'unchecked', 'translation', 'japanese', 'unreviewed_source', 'stale_source', 'unindexed_entries'];
const KINDS: (DraftKind | null)[] = [null, 'generated', 'assembled', 'insufficient_evidence', 'person_required'];
const VERDICTS: RFIQuestion['checker']['verdict'][] = [null, 'yes', 'partly', 'no'];

/** Every combination of what decides a to-do question's group. */
function everyCombination(): RFIQuestion[] {
  const all: RFIQuestion[] = [];
  let n = 0;
  for (const processed of [true, false]) for (const gate of GATES) for (const draftKind of KINDS)
    for (const verdict of VERDICTS) for (const confidence of [null, 0.2, 0.95]) {
      all.push(q({ processed, gate, draftKind, confidence, checker: { verdict, bestRef: null, reason: null } }, `c${n++}`));
    }
  return all;
}

describe('S22-1 needReason()', () => {
  it('3. a to-do question needs no reason exactly when bulk approval could take it', () => {
    const all = everyCombination();
    expect(all.length).toBe(2 * 9 * 5 * 4 * 3);
    for (const x of all) expect(needReason(x) === null, JSON.stringify({ ...x.checker, g: x.gate, k: x.draftKind, p: x.processed, c: x.confidence })).toBe(bulkEligible(x));
  });

  it('3. gives one reason, the first in a fixed order: processing, the gate, the draft, calibration, the checker', () => {
    expect(needReason(q({ processed: false, gate: 'pricing' }))?.key).toBe('unprocessed');
    expect(needReason(q({ gate: 'pricing', draftKind: 'person_required', confidence: null }))).toEqual({ key: 'pricing', label: GATE_LABEL.pricing });
    expect(needReason(q({ gate: 'legal', checker: { verdict: 'no', bestRef: null, reason: null } }))?.label).toBe('Legal: review individually');
    expect(needReason(q({ draftKind: 'insufficient_evidence', confidence: null }))?.label).toBe('No draft: the knowledge base does not answer it');
    expect(needReason(q({ draftKind: null }))?.label).toBe('No draft');
    expect(needReason(q({ confidence: null, checker: { verdict: 'partly', bestRef: null, reason: null } }))?.label).toBe('Not calibrated');
    expect(needReason(q({ checker: { verdict: 'partly', bestRef: null, reason: null } }))?.label).toBe('The checker found it partly answered');
    expect(needReason(q({ checker: { verdict: 'no', bestRef: null, reason: null } }))?.label).toBe('The checker found it not answered');
    expect(needReason(q({ checker: { verdict: null, bestRef: null, reason: null } }))?.label).toBe('Not checked by the checker');
  });

  it('every gate has a label', () => {
    for (const g of GATES.filter((x): x is QuestionGate => x !== null)) expect(GATE_LABEL[g]).toMatch(/\w/);
  });

  it('a decided question needs nothing', () => {
    expect(needReason(q({ status: 'accepted', gate: 'pricing' }))).toBeNull();
    expect(needReason(q({ status: 'skipped', draftKind: 'insufficient_evidence' }))).toBeNull();
  });
});

describe('S22-1 groupQuestions()', () => {
  it('2. puts every question in exactly one group, and the counts add up', () => {
    const all = [
      ...everyCombination(),
      q({ status: 'accepted' }, 'a1'), q({ status: 'accepted', gate: 'pricing' }, 'a2'), q({ status: 'skipped' }, 's1'),
    ];
    const g = groupQuestions(all);
    const ids = [...g.needs, ...g.ready, ...g.approved, ...g.unanswered].map((x) => x.id);
    expect(ids.sort()).toEqual(all.map((x) => x.id).sort());
    expect(new Set(ids).size).toBe(all.length);
    expect(g.approved.map((x) => x.id).sort()).toEqual(['a1', 'a2']);
    expect(g.unanswered.map((x) => x.id)).toEqual(['s1']);
    expect(g.ready.every(bulkEligible)).toBe(true);
    expect(g.needs.every((x) => x.status === 'pending' && !bulkEligible(x))).toBe(true);
  });

  it('Q2: ready to approve at any confidence, the most confident first', () => {
    const g = groupQuestions([q({ confidence: 0.3 }, 'low'), q({ confidence: 0.97 }, 'high'), q({ confidence: 0.6 }, 'mid')]);
    expect(g.ready.map((x) => x.id)).toEqual(['high', 'mid', 'low']);
  });

  it('keeps the order it was given within the other groups', () => {
    const g = groupQuestions([q({ gate: 'legal' }, 'n1'), q({ gate: 'pricing' }, 'n2')]);
    expect(g.needs.map((x) => x.id)).toEqual(['n1', 'n2']);
  });
});

describe('S22-1 expertItems()', () => {
  const a = (id: string, questionId: string, status: QuestionAssignment['status'], updatedAt: string): QuestionAssignment => ({
    id, questionId, sessionId: 's', opportunityId: 'o', assignedTo: 'u', assignedBy: 'o', questionText: 'copy', answerText: '',
    status, notes: '', completedAt: null, createdAt: updatedAt, updatedAt,
  });

  it('5. lists every assignment, an answer to look at first, then work in progress, then the rest, newest first', () => {
    const items = expertItems([q({}, 'q1'), q({}, 'q2')], {
      q1: [a('closed', 'q1', 'closed', '2026-11-01'), a('asked', 'q1', 'pending', '2026-11-02')],
      q2: [a('old-answer', 'q2', 'answered', '2026-10-01'), a('new-answer', 'q2', 'answered', '2026-11-03'), a('working', 'q2', 'in_review', '2026-11-03')],
    });
    expect(items.map((i) => i.assignment.id)).toEqual(['new-answer', 'old-answer', 'working', 'asked', 'closed']);
    expect(items[0].question?.id).toBe('q2');
  });

  it('has a word for every stage', () => {
    for (const s of ['pending', 'in_review', 'answered', 'approved', 'closed']) expect(ASSIGNMENT_WORD[s]).toMatch(/\w/);
  });
});
