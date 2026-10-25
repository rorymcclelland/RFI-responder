/**
 * Processing one batch of RFI questions server-side (story S2-2a): match, check answerability,
 * calibrate, gate, draft. Pure: every provider and the database are passed in, so the Edge
 * Function, the evaluation scripts and the tests share exactly this logic.
 *
 * Safety defaults (agreed in Sprint 2 refinement):
 * - If the answerability check fails, confidence is null (not calibrated) and threshold bulk
 *   approval is unavailable for that question (Q5).
 * - Pricing, legal, unchecked and translated questions carry a `gate` and are never bulk-approved.
 * - Pricing questions are never drafted.
 */
import { UnreadableReplyError, type AnswerabilityChecker } from './answerability.ts';
import { draftAnswer, NO_CONFIDENT_MATCH_TEXT, NO_MATCH_TEXT, PRICING_TEXT } from './assemble.ts';
import { calibratedConfidence, NO_MATCH_FLOOR, type CalibrationTable } from './calibration.ts';
import type { ClaudeClient } from './claude.ts';
import { draftGrounded } from './drafting.ts';
import { HttpError } from './errors.ts';
import { gateQuestion } from './gates.ts';
import { selectDraftSources, type MatchRow, type Source } from './sources.ts';

export type Gate = 'pricing' | 'legal' | 'unchecked' | 'translation' | 'unreviewed_source' | 'stale_source' | 'unindexed_entries';
export type DraftKind = 'generated' | 'assembled' | 'insufficient_evidence' | 'person_required';

export interface QuestionIn {
  id: string;
  question: string;
}

/** Exactly the columns the function writes to rfi_questions. */
export interface ProcessedQuestion {
  id: string;
  generated_answer: string;
  confidence: number | null;
  retrieval_score: number;
  sources_json: { id: string; score: number }[];
  answerability: number | null;
  verdict: string | null;
  gate: Gate | null;
  gate_reason: string | null;
  language: 'en' | 'ja';
  embedding_model: string | null;
  judge_model: string | null;
  /** The entry the answerability checker said answers it best; supersession requires it to be the top source. */
  judge_best_ref: string | null;
  /** The checker's one-sentence reason, made safe to show (Sprint 6, S6-3). */
  judge_reason: string | null;
  draft_model: string | null;
  prompt_version: string | null;
  calibration_set: string | null;
  draft_kind: DraftKind;
  /** The entries the draft actually cites (Sprint 4): what learning confirms and review gates check. */
  cited_refs: string[];
  processing_note: string | null;
  processed_at: string;
}

export interface ProcessDeps {
  /** Null when no embedding provider is configured. Throwing means "unavailable": keywords are used. */
  embed: ((texts: string[]) => Promise<{ model: string; vectors: number[][] }>) | null;
  match: (text: string, vector: number[] | null, model: string | null) => Promise<MatchRow[]>;
  /** Null means "not configured": confidence falls back to similarity calibration (Sprint 1). */
  checker: AnswerabilityChecker | null;
  classifier: { client: ClaudeClient; model: string } | null;
  drafter: { client: ClaudeClient; model: string } | null;
  tables: Record<string, CalibrationTable>;
  /**
   * Review state of the cited entries (Sprint 4, S4-3 and S4-4). A ref missing from the map is
   * treated as unreviewed. Throwing marks the question unchecked. Omitted: no review gates.
   */
  sourceStatus?: (refs: string[]) => Promise<Map<string, { reviewed: boolean; overdueSince: string | null; replacedBy?: string | null }>>;
  /**
   * Sprint 11 (S11-2, F-43): how many current knowledge-base entries still have no vector from the
   * embedding model after process-questions tried to index them. Matching by meaning cannot find
   * them, so a question matched that way says so and is held from bulk approval. Null: unknown
   * (counted as some). Omitted: 0.
   */
  unindexed?: number | null;
  /** How many questions are worked on at once (provider rate limits). */
  concurrency?: number;
  now?: () => string;
}

export const MAX_BATCH = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request body of process-questions: one session, 1 to MAX_BATCH question ids (S2-2a test 5). */
export function validateProcessRequest(body: unknown): { sessionId: string; questionIds: string[] } {
  const b = body as { sessionId?: unknown; questionIds?: unknown } | null;
  if (!b || typeof b.sessionId !== 'string' || !UUID.test(b.sessionId)) throw new HttpError('sessionId must be a UUID', 400);
  if (!Array.isArray(b.questionIds) || b.questionIds.length === 0 || b.questionIds.length > MAX_BATCH) {
    throw new HttpError(`questionIds must list 1 to ${MAX_BATCH} questions`, 400);
  }
  if (!b.questionIds.every((id) => typeof id === 'string' && UUID.test(id))) throw new HttpError('questionIds must be UUIDs', 400);
  return { sessionId: b.sessionId, questionIds: [...new Set(b.questionIds as string[])] };
}

/** Japanese if it contains kana or kanji, after folding half-width katakana (NFKC, security review). */
/** The entries an assembled draft is built from (as draftAnswer uses them). */
const assembledFrom = (sources: Source[]) => sources.filter((s) => s.score > 0).map((s) => s.entry.id);

export const languageOf = (text: string): 'en' | 'ja' => (/[぀-ヿ一-鿿]/.test(text.normalize('NFKC')) ? 'ja' : 'en');

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function processQuestions(questions: QuestionIn[], deps: ProcessDeps): Promise<ProcessedQuestion[]> {
  if (questions.length > MAX_BATCH) throw new Error(`At most ${MAX_BATCH} questions per call`);
  const now = deps.now ?? (() => new Date().toISOString());

  let embedded: { model: string; vectors: number[][] } | null = null;
  let embedNote: string | null = null;
  if (deps.embed) {
    try {
      embedded = await deps.embed(questions.map((q) => q.question));
    } catch {
      embedNote = 'Meaning-based search was unavailable, so this was matched by keywords only and confidence is not calibrated.';
    }
  } else {
    embedNote = 'No embedding provider is configured, so this was matched by keywords only and confidence is not calibrated.';
  }

  return pool(questions, deps.concurrency ?? 3, async (q, i) => {
    const notes: string[] = embedNote ? [embedNote] : [];
    const language = languageOf(q.question);
    const vector = embedded?.vectors[i] ?? null;
    const embeddingModel = embedded?.model ?? null;

    let rows: MatchRow[] = [];
    try {
      rows = await deps.match(q.question, vector, embeddingModel);
    } catch {
      notes.push('Matching against the knowledge base failed.');
    }
    const sources: Source[] = selectDraftSources(rows);
    const topSimilarity = vector ? sources[0]?.score ?? null : null;

    // Gate and answerability are independent, so they run together.
    const [gate, judged] = await Promise.all([
      gateQuestion(q.question, deps.classifier),
      (async () => {
        if (!vector || !embeddingModel || sources.length === 0) return null;
        if (!deps.checker) {
          return { method: embeddingModel, score: topSimilarity, verdict: null as string | null, model: null as string | null, bestRef: null as string | null, reason: null as string | null, failed: false, unreadable: false };
        }
        try {
          const r = await deps.checker.check(
            q.question,
            sources.map((s) => ({ ref: s.entry.id, question: s.entry.question, answer: s.entry.answer, similarity: s.score })),
          );
          return { method: `${embeddingModel} + ${deps.checker.model}`, score: r.score, verdict: r.verdict ?? null, model: r.model, bestRef: r.bestRef, reason: r.reason ?? null, failed: false, unreadable: false };
        } catch (err) {
          return { method: null, score: null, verdict: null, model: deps.checker.model, bestRef: null, reason: null, failed: true, unreadable: err instanceof UnreadableReplyError };
        }
      })(),
    ]);
    if (judged?.unreadable) notes.push('The answerability check gave an unreadable answer twice, so confidence is not calibrated and the question is reviewed individually.');
    else if (judged?.failed) notes.push('The answerability check was unavailable, so confidence is not calibrated.');

    const confidence = judged?.method ? calibratedConfidence(judged.score, judged.method, deps.tables) : null;
    const calibrationSet = judged?.method && confidence !== null ? deps.tables[judged.method]?.evaluationSet ?? null : null;
    if (judged?.method && !judged.failed && confidence === null) notes.push(`No calibration table for ${judged.method}, so confidence is not calibrated.`);

    let gateValue: Gate | null = gate.category;
    let gateReason: string | null = gate.category ? gate.reason : null;
    if (!gateValue && language === 'ja') {
      gateValue = 'translation';
      gateReason = 'Japanese question: the draft is translated from English entries, so it is reviewed individually until the Japanese evaluation items have been checked by a native reader.';
    }

    let text: string;
    let kind: DraftKind;
    let cited: string[] = [];
    let draftModel: string | null = null;
    let promptVersion: string | null = null;
    if (gateValue === 'pricing') {
      text = PRICING_TEXT;
      kind = 'person_required';
    } else if (sources.length === 0) {
      text = NO_MATCH_TEXT;
      kind = 'insufficient_evidence';
    } else if (confidence !== null && confidence < NO_MATCH_FLOOR) {
      text = NO_CONFIDENT_MATCH_TEXT;
      kind = 'insufficient_evidence';
    } else if (deps.drafter && vector) {
      try {
        const d = await draftGrounded({ client: deps.drafter.client, model: deps.drafter.model, question: q.question, language, sources });
        text = d.text;
        kind = d.kind;
        cited = d.citations;
        draftModel = d.model;
        promptVersion = d.promptVersion;
        if (d.rejected) notes.push(`A draft was not offered: ${d.rejected}.`);
      } catch {
        notes.push('Drafting was unavailable, so this draft is assembled from the entries, not generated.');
        text = draftAnswer(sources);
        kind = 'assembled';
        cited = assembledFrom(sources);
      }
    } else {
      text = draftAnswer(sources);
      kind = 'assembled';
      cited = assembledFrom(sources);
    }

    // Sprint 11 (S11-2): entries without a vector were not searched when matching by meaning. Checked
    // before the source gates (security review, M1): a source gate is released when its entries are
    // reviewed, which would let this question into bulk approval; this gate is never released.
    const unindexed = deps.unindexed === undefined ? 0 : deps.unindexed;
    if (vector && (unindexed === null || unindexed > 0)) {
      const what = unindexed === null
        ? 'Some knowledge-base entries may not have been indexed (the count could not be read), so the best match may have been missed.'
        : `${unindexed}${unindexed >= 500 ? ' or more' : ''} knowledge-base ${unindexed === 1 ? 'entry was' : 'entries were'} not yet indexed and ${unindexed === 1 ? 'was' : 'were'} not searched, so the best match may have been missed.`;
      notes.push(what);
      if (!gateValue) {
        gateValue = 'unindexed_entries';
        gateReason = `${what} It is reviewed individually.`;
      }
    }

    // Sprint 4: a draft resting on an entry nobody has reviewed, or one overdue for review, is
    // never bulk-approved. An earlier gate (pricing, legal, translation, unchecked) is kept.
    if (!gateValue && cited.length > 0 && deps.sourceStatus) {
      try {
        const states = await deps.sourceStatus(cited);
        const unreviewed = cited.filter((r) => !states.get(r)?.reviewed);
        // Sprint 7 (F-32): a replaced entry is out of date like an overdue one.
        const overdue = cited.filter((r) => states.get(r)?.reviewed && (states.get(r)?.replacedBy || states.get(r)?.overdueSince));
        if (unreviewed.length > 0) {
          gateValue = 'unreviewed_source';
          gateReason = `Cites ${unreviewed.join(', ')}, not reviewed by an admin yet, so it is reviewed individually.`;
        } else if (overdue.length > 0) {
          gateValue = 'stale_source';
          gateReason = `Cites ${overdue.map((r) => (states.get(r)!.replacedBy ? `${r} (replaced by ${states.get(r)!.replacedBy})` : `${r} (overdue for review since ${states.get(r)!.overdueSince})`)).join(', ')}, so it is reviewed individually.`;
        }
      } catch {
        gateValue = 'unchecked';
        gateReason = 'The review status of the cited entries could not be read, so it is reviewed individually.';
      }
    }

    return {
      id: q.id,
      generated_answer: text,
      confidence: confidence === null ? null : Math.round(confidence * 1000) / 1000,
      retrieval_score: sources[0]?.score ?? 0,
      sources_json: sources.map((s) => ({ id: s.entry.id, score: s.score })),
      answerability: judged?.score ?? null,
      verdict: judged?.verdict ?? null,
      gate: gateValue,
      gate_reason: gateReason,
      language,
      embedding_model: embeddingModel,
      judge_model: judged?.model ?? null,
      judge_best_ref: judged?.bestRef ?? null,
      judge_reason: judged?.reason ?? null,
      draft_model: draftModel,
      prompt_version: promptVersion,
      calibration_set: calibrationSet,
      draft_kind: kind,
      cited_refs: cited,
      processing_note: notes.length ? notes.join(' ') : null,
      processed_at: now(),
    };
  });
}
