/** Saving review decisions on an RFI session's questions. */
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Accept every pending question in a session whose confidence is at least
 * `minConfidence` (or all pending questions when it is null), in one update,
 * so the decision is saved for everyone who opens the response.
 */
export async function bulkAcceptInDb(
  client: SupabaseClient,
  sessionId: string,
  minConfidence: number | null,
): Promise<void> {
  let query = client
    .from('rfi_questions')
    .update({ status: 'accepted' })
    .eq('session_id', sessionId)
    .eq('status', 'pending');
  if (minConfidence !== null) query = query.gte('confidence', minConfidence);
  const { error } = await query;
  if (error) throw new Error(`Bulk accept was not saved: ${error.message}`);
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

/** Insert a session's questions in batches; a failure says how many were saved first. */
export async function insertQuestions(client: SupabaseClient, rows: Record<string, unknown>[], batch = 25): Promise<void> {
  for (let i = 0; i < rows.length; i += batch) {
    const { error } = await client.from('rfi_questions').insert(rows.slice(i, i + batch));
    if (error) throw new Error(`Only ${i} of ${rows.length} questions were saved: ${error.message}`);
  }
}
