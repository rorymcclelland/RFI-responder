/**
 * Changes to an assignment from the inbox (BUG-29, Sprint 10). Every change is checked: a refusal by
 * the database, or a change that saved nothing, is reported rather than shown as done (as F-9 did
 * for review decisions). Only the person assigned, the response owner or an admin may change an
 * assignment (decision 0003), so approving the other assignments on a question succeeds only for the
 * owner or an admin; how many it changed is returned.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssignmentStatus } from '../types';

type Saved = { data: { id: string }[] | null; error: { message: string } | null };

export async function setAssignmentStatus(
  client: SupabaseClient,
  a: { id: string; questionId: string; sessionId: string },
  status: AssignmentStatus,
): Promise<{ othersApproved: number }> {
  const now = new Date().toISOString();
  const patch = { status, updated_at: now, ...(status === 'approved' ? { completed_at: now } : {}) };
  const own = (await client.from('question_assignments').update(patch).eq('id', a.id).select('id')) as unknown as Saved;
  if (own.error || !own.data?.length) throw new Error(`The change was not saved: ${own.error?.message ?? 'you can no longer change this assignment'}`);
  if (status !== 'approved') return { othersApproved: 0 };
  const others = (await client.from('question_assignments').update(patch)
    .eq('question_id', a.questionId).eq('session_id', a.sessionId).neq('id', a.id).select('id')) as unknown as Saved;
  return { othersApproved: others.error ? 0 : others.data?.length ?? 0 };
}

export async function saveAssignmentNotes(client: SupabaseClient, id: string, notes: string): Promise<void> {
  const r = (await client.from('question_assignments').update({ notes, updated_at: new Date().toISOString() }).eq('id', id).select('id')) as unknown as Saved;
  if (r.error || !r.data?.length) throw new Error(`The notes were not saved: ${r.error?.message ?? 'you can no longer change this assignment'}`);
}
