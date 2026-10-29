/** Saving review decisions and creating a session's questions. */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BulkResult {
  accepted: number;
  heldGated: number;
  heldUncalibrated: number;
  /** Processed and calibrated, but with no draft to approve ("insufficient evidence"). */
  heldNoDraft?: number;
  /** Sprint 7 (F-33): at the threshold, but the checker said only "partly" or "no". */
  heldPartly?: number;
  /** Security review, Sprint 7: a checker ran (a reranker) but gave a score, not a verdict. */
  heldNoVerdict?: number;
  /** Sprint 9 (F-40): no checker configured, so confidence comes from similarity alone. */
  heldNoChecker?: number;
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
  const parts = [`${r.accepted} approved`];
  if (r.belowThreshold) parts.push(`${r.belowThreshold} below ${Math.round(threshold * 100)}%`);
  if (r.heldGated) parts.push(`${r.heldGated} held back for individual review (pricing, legal, unchecked, translated or Japanese, matched before every entry was indexed, or citing an entry that is unreviewed or overdue for review)`);
  if (r.heldUncalibrated) parts.push(`${r.heldUncalibrated} without calibrated confidence`);
  if (r.heldNoDraft) parts.push(`${r.heldNoDraft} with no draft to approve`);
  if (r.heldPartly) parts.push(`${r.heldPartly} held because the checker said the entries answer them only in part (approve them one at a time)`);
  if (r.heldNoChecker) parts.push(`${r.heldNoChecker} held because no checker is configured (approve ${r.heldNoChecker === 1 ? 'it' : 'them'} one at a time)`);
  if (r.heldNoVerdict) parts.push(`${r.heldNoVerdict} held because the checker gave a score but no verdict (approve ${r.heldNoVerdict === 1 ? 'it' : 'them'} one at a time)`);
  return `${parts.join('; ')}.`;
}

/** Save one question's review decision (F-9: failures are reported, not swallowed). */
export async function saveQuestionPatch(
  client: SupabaseClient,
  id: string,
  patch: { status?: string; finalAnswer?: string },
): Promise<void> {
  // The answer first, then the decision: changing an accepted answer reopens the question in the
  // database (security review, Sprint 2), so accepting the revised text is a separate, later step.
  const steps: Record<string, unknown>[] = [];
  if (patch.finalAnswer !== undefined) steps.push({ final_answer: patch.finalAnswer });
  if (patch.status !== undefined) steps.push({ status: patch.status });
  for (const [i, db] of steps.entries()) {
    // Row-level security refuses by updating nothing, without an error (Sprint 6, S6-5).
    const { data, error } = await client.from('rfi_questions').update(db).eq('id', id).select('id');
    const problem = error ? error.message : !data || data.length === 0 ? 'you cannot change this question' : null;
    if (!problem) continue;
    // The answer saved but the decision did not: say so, so the screen reloads rather than rolling
    // back an answer that is in the database (Sprint 6 security review, finding 5).
    if (i > 0) throw Object.assign(new Error(`Your edited answer was saved, but it was not approved: ${problem}.`), { partial: true });
    throw new Error(`Your change was not saved: ${problem}${error ? '' : '.'}`);
  }
}

/**
 * Insert a session's questions (text only: scores are written server-side) in batches, and
 * return their ids in order. A failure says how many were saved first.
 */
export async function insertQuestions(
  client: SupabaseClient,
  sessionId: string,
  questions: { position: number; question: string; customerRef?: string | null }[],
  batch = 25,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < questions.length; i += batch) {
    const rows = questions.slice(i, i + batch).map((q) => ({
      session_id: sessionId, position: q.position, question: q.question, ...(q.customerRef ? { customer_ref: q.customerRef } : {}),
    }));
    const { data, error } = await client.from('rfi_questions').insert(rows).select('id');
    if (error || !data) throw new Error(`Only ${i} of ${questions.length} questions were saved: ${error?.message ?? 'no response'}`);
    ids.push(...data.map((d: { id: string }) => d.id));
  }
  return ids;
}

/**
 * The reason an Edge Function gave for refusing, from its JSON reply ({ error }), or the client's
 * own message. supabase-js puts the reply in `error.context` and only says "non-2xx" itself.
 */
export async function functionErrorMessage(error: unknown): Promise<{ message: string; status: number | null }> {
  const e = error as { message?: string; context?: unknown } | null;
  const ctx = e?.context;
  if (ctx instanceof Response) {
    const body = (await ctx.clone().json().catch(() => null)) as { error?: unknown; message?: unknown } | null;
    if (body && typeof body.error === 'string') return { message: body.error, status: ctx.status };
    // The local gateway answers { message } when the functions server is not running.
    if (body && typeof body.message === 'string') {
      const down = ctx.status === 503 && /name resolution failed/i.test(body.message);
      return { message: down ? 'The AI service is not running (start it with: npx supabase functions serve)' : body.message, status: ctx.status };
    }
    return { message: e?.message ?? 'no response', status: ctx.status };
  }
  // Sprint 18 (found at Rory's check): supabase-js says "Failed to send a request to the Edge
  // Function" when it cannot reach the function at all (not deployed, offline, or blocked).
  if (e?.message && /failed to send a request/i.test(e.message)) {
    return { message: 'The service could not be reached. Check your connection and try again shortly; if it keeps happening, an admin should check the Edge Functions are deployed.', status: null };
  }
  return { message: e?.message ?? 'no response', status: null };
}

/**
 * Ask the server to process questions in batches of ten; returns ids it could not process.
 * At a usage cap (429) it stops: later batches would be refused too (Sprint 4, S4-1).
 */
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
      const { message, status } = await functionErrorMessage(error);
      reasons.push(message);
      if (status === 429) {
        failed.push(...questionIds.slice(i));
        onProgress(questionIds.length, questionIds.length);
        break;
      }
      failed.push(...ids);
    } else {
      for (const p of data.processed as { id: string; saved: boolean }[]) if (!p.saved) failed.push(p.id);
      if (typeof data.limit === 'string' && data.limit) reasons.push(data.limit);
    }
    onProgress(Math.min(i + batch, questionIds.length), questionIds.length);
  }
  return { failed, reasons: [...new Set(reasons)] };
}

/**
 * Sprint 11 (S11-1, F-42; Rory, Q1): a session's export, and whether it has changed since. Answers
 * can still change after an export is recorded; the database then marks the session, and the
 * export must be recorded again.
 */
export interface ExportState { exportedAt: string | null; changedSinceExportAt: string | null }

export async function loadExportState(client: SupabaseClient, sessionId: string): Promise<ExportState> {
  const { data, error } = await client.from('rfi_sessions').select('exported_at, changed_since_export_at').eq('id', sessionId).maybeSingle();
  if (error || !data) return { exportedAt: null, changedSinceExportAt: null };
  return { exportedAt: (data.exported_at as string | null) ?? null, changedSinceExportAt: (data.changed_since_export_at as string | null) ?? null };
}

/** What the workspace says about the export, or null when there is nothing to say. */
export function exportNotice(s: ExportState, step: 'review' | 'export' | string): string | null {
  if (!s.exportedAt) return null;
  const when = new Date(s.exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (s.changedSinceExportAt) {
    return `Answers have changed since the export was recorded on ${when}, so the files already downloaded do not show them. When you are ready, choose Record export again and download the answers again.`;
  }
  if (step === 'export') {
    return 'Changing an answer or a decision now reopens the export: the change is recorded in the audit log, and the export must be recorded again.';
  }
  return null;
}
