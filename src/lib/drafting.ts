/**
 * Drafting and scoring for one RFI question.
 *
 * Sprint 0's keyword method, kept as the evaluation baseline and for column detection.
 * The app's drafting runs server-side from Sprint 2 (supabase/functions/process-questions).
 * Originally (Sprint 0) this was deliberately simple and fully deterministic:
 * - retrieval is keyword based (TF-IDF with cosine similarity, see ../retrieval.ts);
 * - the draft is assembled from the best-matching knowledge-base answers, with
 *   their references, and nothing is generated or invented;
 * - confidence is the top match score scaled onto 0..1.
 *
 * Sprint 1 replaces the retrieval and calibrates confidence; Sprint 2 replaces
 * the drafting with grounded generation. Keep this module pure (no React, no
 * database) so it stays easy to test.
 */
import { retrieveTopK } from '../retrieval';
import type { KnowledgeEntry } from '../types';
import { draftAnswer } from '../../supabase/functions/_shared/assemble.ts';

export { draftAnswer, NO_CONFIDENT_MATCH_TEXT, NO_MATCH_TEXT } from '../../supabase/functions/_shared/assemble.ts';

/**
 * A raw TF-IDF cosine score of this size or more is treated as a full match.
 * Chosen by eye on the synthetic security Q&As in the prototype; it is a
 * heuristic, not a calibrated probability. Sprint 1 replaces it.
 */
export const SCORE_CEILING = 0.3;

/** Number of knowledge-base entries retrieved per question. */
export const TOP_K = 3;

export interface ScoredQuestion {
  sources: ReturnType<typeof retrieveTopK>;
  generatedAnswer: string;
  /** 0..1, from the top retrieval score scaled by SCORE_CEILING. */
  confidence: number;
  /** The raw similarity of the best-matching entry. */
  retrievalScore: number;
}

export function scoreQuestion(question: string, kb: KnowledgeEntry[]): ScoredQuestion {
  const sources = retrieveTopK(question, kb, TOP_K);
  const retrievalScore = sources[0]?.score ?? 0;
  const confidence = Math.round(Math.min(1, retrievalScore / SCORE_CEILING) * 1000) / 1000;
  return { sources, generatedAnswer: draftAnswer(sources), confidence, retrievalScore };
}

/** Header names that usually mark the question column, in priority order. */
const QUESTION_HEADER_ALIASES = ['question', 'q', 'query', 'prompt', 'rfp question', 'sq question', 'topic', 'item', 'requirement'];

/** Guess which column holds the questions; falls back to the first column. */
export function detectQuestionColumn(headers: string[]): string {
  const low = headers.map((h) => h.toLowerCase().trim());
  for (const alias of QUESTION_HEADER_ALIASES) {
    const i = low.findIndex((h) => h === alias || h.startsWith(alias));
    if (i !== -1) return headers[i];
  }
  return headers[0] ?? '';
}
