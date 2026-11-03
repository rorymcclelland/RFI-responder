/**
 * Sprint 22 (S22-1, U-5): a response's questions grouped by what they need, as the owner works
 * through them. A question still to do is either Ready to approve (bulk approval could take it,
 * the same rule as `bulkEligible` and the database's bulk_accept) or Needs a person, with one
 * reason: the first, in a fixed order, of what holds it. Decided questions are Approved or Not
 * answered. Nothing here changes a rule; it only says which one applies.
 */
import type { QuestionAssignment, QuestionGate, RFIQuestion } from '../types';
import { bulkEligible } from './questionRows';

/** Why a question is never bulk-approved (S2-2a, S2-3), as the reviewer sees it. */
export const GATE_LABEL: Record<QuestionGate, string> = {
  pricing: 'Pricing: a person answers',
  legal: 'Legal: review individually',
  unchecked: 'Not fully checked',
  translation: 'Translated draft',
  // Sprint 12 (S12-2): Japanese from Japanese entries, not translated, but unverified (Q2).
  japanese: 'Japanese: review individually',
  unreviewed_source: 'Cites an unreviewed entry',
  stale_source: 'Cites an entry overdue for review',
  // Sprint 11 (S11-2): matched while some entries had no vector, so the best match may be missing.
  unindexed_entries: 'Some entries not searched',
};

export type NeedKey = 'unprocessed' | QuestionGate | 'no_answer' | 'no_draft' | 'uncalibrated' | 'partly' | 'no' | 'unchecked_verdict';
export interface NeedReason { key: NeedKey; label: string }

/**
 * The one reason a question still to do needs a person, or null when bulk approval could take it
 * (or it is decided). In order: not processed; its gate; no draft; not calibrated; the checker.
 */
export function needReason(q: RFIQuestion): NeedReason | null {
  if (q.status !== 'pending') return null;
  if (!q.processed) return { key: 'unprocessed', label: 'Not checked and drafted yet' };
  if (q.gate !== null) return { key: q.gate, label: GATE_LABEL[q.gate] };
  if (q.draftKind === 'insufficient_evidence') return { key: 'no_answer', label: 'No draft: the knowledge base does not answer it' };
  if (q.draftKind !== 'generated' && q.draftKind !== 'assembled') return { key: 'no_draft', label: 'No draft' };
  if (q.confidence === null) return { key: 'uncalibrated', label: 'Not calibrated' };
  if (q.checker.verdict === 'partly') return { key: 'partly', label: 'The checker found it partly answered' };
  if (q.checker.verdict === 'no') return { key: 'no', label: 'The checker found it not answered' };
  if (q.checker.verdict !== 'yes') return { key: 'unchecked_verdict', label: 'Not checked by the checker' };
  return null;
}

export interface QuestionGroups {
  /** Still to do, and held from bulk approval: each has a reason. */
  needs: RFIQuestion[];
  /** Still to do, and bulk approval could take them: the most confident first (Q2). */
  ready: RFIQuestion[];
  approved: RFIQuestion[];
  unanswered: RFIQuestion[];
}

/** Every question in exactly one group. */
export function groupQuestions(questions: RFIQuestion[]): QuestionGroups {
  const g: QuestionGroups = { needs: [], ready: [], approved: [], unanswered: [] };
  for (const q of questions) {
    if (q.status === 'accepted') g.approved.push(q);
    else if (q.status === 'skipped') g.unanswered.push(q);
    else if (bulkEligible(q)) g.ready.push(q);
    else g.needs.push(q);
  }
  g.ready.sort((a, b) => (b.confidence ?? -1) - (a.confidence ?? -1));
  return g;
}

/** The words for where an assignment stands (Sprint 19; Closed since Sprint 21). */
export const ASSIGNMENT_WORD: Record<string, string> = {
  pending: 'Asked', in_review: 'Working on it', answered: 'Answered', approved: 'Approved', closed: 'Closed',
};

/** What the owner needs to do first: an answer to look at, then work in progress, then the rest. */
const EXPERT_ORDER: Record<string, number> = { answered: 0, in_review: 1, pending: 2, approved: 3, closed: 4 };

export interface ExpertItem { assignment: QuestionAssignment; question: RFIQuestion | null }

/** Every assignment of the open file's questions, an answer to look at first, then the newest. */
export function expertItems(questions: RFIQuestion[], assignments: Record<string, QuestionAssignment[]>): ExpertItem[] {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return Object.values(assignments).flat()
    .map((a) => ({ assignment: a, question: byId.get(a.questionId) ?? null }))
    .sort((x, y) => (EXPERT_ORDER[x.assignment.status] ?? 9) - (EXPERT_ORDER[y.assignment.status] ?? 9)
      || y.assignment.updatedAt.localeCompare(x.assignment.updatedAt));
}
