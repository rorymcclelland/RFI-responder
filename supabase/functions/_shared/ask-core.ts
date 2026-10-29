/**
 * Sprint 18 (S18-4, K-3): ask the knowledge base a question. The question goes through the same
 * pipeline as a question in a response (processQuestions: matching, the answerability checker, the
 * pricing and legal gates, drafting, calibration and the source gates), unchanged, so the
 * evaluation figures still hold. Nothing is saved but the cost (Rory, Q4).
 */
import { HttpError } from './errors.ts';
import { processQuestions, type ProcessDeps, type ProcessedQuestion } from './process-core.ts';

export const MAX_ASK_CHARS = 2000;

/** The request body: { question: string }, 1 to 2,000 characters once trimmed. */
export function validateAskRequest(body: unknown): { question: string } {
  const b = body as { question?: unknown } | null;
  if (!b || typeof b !== 'object' || typeof b.question !== 'string') throw new HttpError('question must be text', 400);
  const question = b.question.trim();
  if (question.length === 0) throw new HttpError('Type a question to ask.', 400);
  if (question.length > MAX_ASK_CHARS) throw new HttpError(`Keep the question to ${MAX_ASK_CHARS} characters.`, 400);
  return { question };
}

/** What the screen is given: the draft and how it was made. No ids, models' keys or internal notes beyond the reviewer's. */
export interface AskResult {
  question: string;
  draft: string;
  draftKind: ProcessedQuestion['draft_kind'];
  confidence: number | null;
  verdict: string | null;
  judgeReason: string | null;
  gate: ProcessedQuestion['gate'];
  gateReason: string | null;
  language: 'en' | 'ja';
  cited: string[];
  sources: { ref: string; score: number }[];
  note: string | null;
}

export async function askKnowledge(question: string, deps: ProcessDeps): Promise<AskResult> {
  const [r] = await processQuestions([{ id: 'ask', question }], deps);
  return {
    question,
    draft: r.generated_answer,
    draftKind: r.draft_kind,
    confidence: r.confidence,
    verdict: r.verdict,
    judgeReason: r.judge_reason,
    gate: r.gate,
    gateReason: r.gate_reason,
    language: r.language,
    cited: r.cited_refs,
    sources: r.sources_json.map((s) => ({ ref: s.id, score: s.score })),
    note: r.processing_note,
  };
}
