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
