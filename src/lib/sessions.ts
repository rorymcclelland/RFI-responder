/** Saving review decisions and creating a session's questions. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BulkResult {
  accepted: number;
  heldGated: number;
  heldUncalibrated: number;
  belowThreshold: number;
}

/**
 * Approve in bulk through the database function bulk_accept (S2-2a), which checks that the
 * caller owns the response (or is an admin) and never accepts gated or uncalibrated questions.
 */
export async function bulkAcceptInDb(client: SupabaseClient, sessionId: string, minConfidence: number): Promise<BulkResult> {
  const { data, error } = await client.rpc('bulk_accept', { p_session: sessionId, p_min_confidence: minConfidence });
  if (error) throw new Error(`Bulk approval was not saved: ${error.message}`);
  return data as BulkResult;
}

/** Describe what bulk approval did and what it held back, in plain words. */
export function describeBulk(r: BulkResult, threshold: number): string {
  const parts = [`${r.accepted} accepted`];
  if (r.belowThreshold) parts.push(`${r.belowThreshold} below ${Math.round(threshold * 100)}%`);
  if (r.heldGated) parts.push(`${r.heldGated} held back for individual review (pricing, legal, unchecked or translated)`);
  if (r.heldUncalibrated) parts.push(`${r.heldUncalibrated} without calibrated confidence`);
  return `${parts.join('; ')}.`;
}

/** Save one question's review decision (F-9: failures are reported, not swallowed). */
export async function saveQuestionPatch(
  client: SupabaseClient,
  id: string,
  patch: { status?: string; finalAnswer?: string },
): Promise<void> {
  const db: Record<string, unknown> = {};
  if (patch.status !== undefined) db.status = patch.status;
  if (patch.finalAnswer !== undefined) db.final_answer = patch.finalAnswer;
  if (Object.keys(db).length === 0) return;
  const { error } = await client.from('rfi_questions').update(db).eq('id', id);
  if (error) throw new Error(`Your change was not saved: ${error.message}`);
}

/**
 * Insert a session's questions (text only: scores are written server-side) in batches, and
 * return their ids in order. A failure says how many were saved first.
 */
export async function insertQuestions(
  client: SupabaseClient,
  sessionId: string,
  questions: { position: number; question: string }[],
  batch = 25,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < questions.length; i += batch) {
    const rows = questions.slice(i, i + batch).map((q) => ({ session_id: sessionId, position: q.position, question: q.question }));
    const { data, error } = await client.from('rfi_questions').insert(rows).select('id');
    if (error || !data) throw new Error(`Only ${i} of ${questions.length} questions were saved: ${error?.message ?? 'no response'}`);
    ids.push(...data.map((d: { id: string }) => d.id));
  }
  return ids;
}

/** Ask the server to process questions in batches of ten; returns ids it could not process. */
export async function processInBatches(
  client: SupabaseClient,
  sessionId: string,
  questionIds: string[],
  onProgress: (done: number, total: number) => void,
  batch = 10,
): Promise<{ failed: string[]; reasons: string[] }> {
  const failed: string[] = [];
  const reasons: string[] = [];
  for (let i = 0; i < questionIds.length; i += batch) {
    const ids = questionIds.slice(i, i + batch);
    const { data, error } = await client.functions.invoke('process-questions', { body: { sessionId, questionIds: ids } });
    if (error || !data) {
      failed.push(...ids);
      reasons.push(error?.message ?? 'no response');
    } else {
      for (const p of data.processed as { id: string; saved: boolean }[]) if (!p.saved) failed.push(p.id);
    }
    onProgress(Math.min(i + batch, questionIds.length), questionIds.length);
  }
  return { failed, reasons: [...new Set(reasons)] };
}
