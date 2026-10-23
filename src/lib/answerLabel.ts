/**
 * What the answer box on a question card is called, and what its tooltip says (Sprint 3 review).
 *
 * The draft checks (citations and figures against the entries) apply to the text the system
 * wrote. Once a person edits it, or writes an answer where no draft was offered, those checks no
 * longer describe the text, so the label must not claim them (project rule 1).
 */
import type { RFIQuestion } from '../types';

export type AnswerSource = 'draft' | 'edited' | 'person';

export function answerSource(q: Pick<RFIQuestion, 'generatedAnswer' | 'finalAnswer'>): AnswerSource {
  const draft = (q.generatedAnswer ?? '').trim();
  const final = (q.finalAnswer ?? '').trim();
  if (final === draft) return 'draft';
  return draft === '' ? 'person' : 'edited';
}

export const ANSWER_HEADING: Record<AnswerSource, string> = {
  draft: 'Proposed Response',
  edited: 'Answer (edited by a person)',
  person: 'Answer (written by a person)',
};

export const ANSWER_TIP: Record<Exclude<AnswerSource, 'draft'>, string> = {
  edited: 'A person edited the draft. The citation and figure checks applied to the draft, not to these edits.',
  person: 'A person wrote this answer; no draft was offered, so no automatic checks apply to it.',
};
