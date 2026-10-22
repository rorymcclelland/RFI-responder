/**
 * Fixed texts and the assembled draft (Sprint 0's method), used when grounded drafting is not
 * possible: Claude unreachable, or keyword-only matching. Nothing is generated or invented.
 */
import type { Source } from './sources.ts';

/** Below the calibrated floor: the sources stay visible, but no draft is offered. */
export const NO_CONFIDENT_MATCH_TEXT =
  'No confident match in the knowledge base: the closest entries are listed under Sources, but they may not answer this question. It needs an answer written by a person.';

/** No entry shares anything with the question. */
export const NO_MATCH_TEXT = 'No matching knowledge-base entry was found for this question. It needs an answer written by a person.';

/** Pricing questions are never drafted (product rule: a person answers them). */
export const PRICING_TEXT = 'Pricing question: a person answers this. No draft is written, and pricing answers are never added to the knowledge base automatically.';

/** Sentences shorter than this are usually fragments ("e.g", "v2") and are skipped. */
const MIN_SENTENCE_LENGTH = 30;
const SENTENCES_PER_SOURCE = 2;

function keySentences(answer: string): string[] {
  return answer
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= MIN_SENTENCE_LENGTH);
}

/** Assemble a draft from matched sources only. Sources with a zero score are ignored. */
export function draftAnswer(sources: Source[]): string {
  const used = sources.filter((s) => s.score > 0);
  if (used.length === 0) return NO_MATCH_TEXT;
  const paragraphs = used
    .map((s) => keySentences(s.entry.answer).slice(0, SENTENCES_PER_SOURCE).join(' '))
    .filter((p) => p.length > 0);
  const body = [...new Set(paragraphs)].join(' ');
  const refs = used.map((s) => s.entry.id).join(', ');
  return `${body}\n\n[References: ${refs}]`;
}
