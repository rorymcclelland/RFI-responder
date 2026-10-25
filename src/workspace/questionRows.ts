/**
 * Reading a session's questions from the database into the screen's shape, including the
 * knowledge-base entries each draft cites (the database stores only their refs and scores).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DraftKind, KnowledgeEntry, QuestionGate, RFIQuestion, RFIStatus } from '../types';

export interface QuestionRow {
  id: string;
  session_id: string;
  position: number;
  question: string;
  customer_ref?: string | null;
  generated_answer: string | null;
  final_answer: string | null;
  confidence: number | string | null;
  retrieval_score: number | string | null;
  status: string;
  sources_json: { id: string; score: number }[] | null;
  gate?: string | null;
  gate_reason?: string | null;
  draft_kind?: string | null;
  language?: string | null;
  processing_note?: string | null;
  embedding_model?: string | null;
  judge_model?: string | null;
  verdict?: string | null;
  judge_best_ref?: string | null;
  judge_reason?: string | null;
  draft_model?: string | null;
  prompt_version?: string | null;
  calibration_set?: string | null;
  processed_at?: string | null;
  learn_outcome?: string | null;
  skipped_by?: string | null;
  skipped_at?: string | null;
}

export interface ApprovalRow { question_id: string; decided_by: string | null; decided_at: string; kind: 'individual' | 'bulk'; threshold: number | string | null }

const num = (v: number | string | null | undefined) => (v === null || v === undefined ? null : Number(v));

export function toQuestion(r: QuestionRow, entriesByRef: Map<string, KnowledgeEntry>, approval: ApprovalRow | null = null): RFIQuestion {
  const generated = r.generated_answer ?? '';
  return {
    id: r.id,
    sessionId: r.session_id,
    position: r.position,
    customerRef: r.customer_ref ?? null,
    question: r.question,
    generatedAnswer: generated,
    finalAnswer: r.final_answer ?? generated,
    confidence: num(r.confidence),
    retrievalScore: num(r.retrieval_score) ?? 0,
    sources: (r.sources_json ?? [])
      .map((s) => ({ entry: entriesByRef.get(s.id), score: s.score }))
      .filter((s): s is { entry: KnowledgeEntry; score: number } => Boolean(s.entry)),
    status: r.status as RFIStatus,
    gate: (r.gate ?? null) as QuestionGate | null,
    gateReason: r.gate_reason ?? null,
    draftKind: (r.draft_kind ?? null) as DraftKind | null,
    language: r.language === 'ja' || r.language === 'en' ? r.language : null,
    processingNote: r.processing_note ?? null,
    provenance: {
      embeddingModel: r.embedding_model ?? null,
      judgeModel: r.judge_model ?? null,
      draftModel: r.draft_model ?? null,
      promptVersion: r.prompt_version ?? null,
      calibrationSet: r.calibration_set ?? null,
    },
    // Only the server sets processed_at. Questions scored in the browser before Sprint 2 have none,
    // are never bulk-approved (security review), and can be processed now.
    processed: Boolean(r.processed_at),
    skip: r.status === 'skipped' && r.skipped_at ? { by: r.skipped_by ?? null, at: r.skipped_at } : null,
    approval: approval && r.status === 'accepted'
      ? { by: approval.decided_by, at: approval.decided_at, kind: approval.kind, threshold: num(approval.threshold) }
      : null,
    learnOutcome: r.learn_outcome ?? null,
    checker: {
      verdict: r.verdict === 'yes' || r.verdict === 'partly' || r.verdict === 'no' ? r.verdict : null,
      bestRef: r.judge_best_ref ?? null,
      reason: r.judge_reason ?? null,
    },
  };
}

/** A session's questions, least confident first; questions without calibrated confidence come first of all. */
export async function loadQuestions(client: SupabaseClient, sessionId: string): Promise<RFIQuestion[]> {
  const { data, error } = await client.from('rfi_questions').select('*').eq('session_id', sessionId).order('position');
  if (error) throw new Error(`Could not load the questions: ${error.message}`);
  const rows = (data ?? []) as QuestionRow[];
  const refs = [...new Set(rows.flatMap((r) => (r.sources_json ?? []).map((s) => s.id)))];
  const entriesByRef = new Map<string, KnowledgeEntry>();
  if (refs.length) {
    const { data: entries } = await client.from('kb_entries').select('ref, question, answer, tags, source').in('ref', refs);
    for (const e of entries ?? []) {
      entriesByRef.set(e.ref, { id: e.ref, question: e.question, answer: e.answer, tags: e.tags ?? [], source: e.source ?? undefined });
    }
  }
  // The latest recorded approval of each question (S3-2).
  const { data: approvals } = await client.from('approvals').select('question_id, decided_by, decided_at, kind, threshold')
    .eq('session_id', sessionId).order('decided_at', { ascending: true });
  const latest = new Map<string, ApprovalRow>();
  for (const a of (approvals ?? []) as ApprovalRow[]) latest.set(a.question_id, a);
  return rows.map((r) => toQuestion(r, entriesByRef, latest.get(r.id) ?? null)).sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1));
}

/** Pending questions an owner could approve in bulk: processed by the server, calibrated, drafted and not gated. */
export const bulkEligible = (q: RFIQuestion) =>
  q.status === 'pending' && q.processed && q.gate === null && q.confidence !== null &&
  (q.draftKind === 'generated' || q.draftKind === 'assembled') &&
  // The checker must have said "yes" (Sprint 7, F-33), in every configuration since Sprint 9 (F-40):
  // a reranker's score and similarity alone are held.
  q.checker.verdict === 'yes';
