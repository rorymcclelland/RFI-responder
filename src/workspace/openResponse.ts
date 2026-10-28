/**
 * Sprint 16 (S16-1, BUG-39): opening a response. The workspace shows a loading state until this
 * has read the response's sessions, so a response with questions never looks empty, and a failed
 * read is shown as an error rather than as an empty response with an upload box.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RFISession } from '../types';

export const toSession = (r: Record<string, unknown>): RFISession => ({
  id: r.id as string,
  opportunityId: r.opportunity_id as string | null,
  fileName: r.file_name as string,
  // The database allows only these two values; anything else is treated as unfinished.
  status: r.status === 'completed' ? 'completed' : 'in_progress',
  questionCount: r.question_count as number,
  acceptedCount: r.accepted_count as number,
  createdAt: r.created_at as string,
});

/** The response's sessions (newest first, at most ten) and any not linked to a response. Throws if either read fails. */
export async function loadResponseSessions(client: SupabaseClient, opportunityId: string): Promise<{ linked: RFISession[]; orphans: RFISession[] }> {
  const [linked, orphans] = await Promise.all([
    client.from('rfi_sessions').select('*').eq('opportunity_id', opportunityId).order('created_at', { ascending: false }).limit(10),
    client.from('rfi_sessions').select('*').is('opportunity_id', null).order('created_at', { ascending: false }).limit(10),
  ]);
  if (linked.error || orphans.error) {
    console.error('rfi_sessions read failed', linked.error ?? orphans.error);
    throw new Error('This response could not be loaded. Check your connection and try again.');
  }
  return { linked: (linked.data ?? []).map(toSession), orphans: (orphans.data ?? []).map(toSession) };
}

/** What to show first: the newest session, or the upload step for a response with none. */
export function firstView(linked: RFISession[]): { open: RFISession } | 'upload' {
  return linked.length > 0 ? { open: linked[0] } : 'upload';
}
