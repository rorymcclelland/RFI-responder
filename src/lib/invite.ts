/**
 * Sprint 15 (S15-5, F-3): an admin invites someone from the Team page. The invite-user Edge Function
 * checks the caller is an admin, checks the address, sends Supabase's invitation and records it in the
 * audit log; the person joins as a member.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { functionErrorMessage } from './sessions';

export async function inviteSomeone(client: SupabaseClient, email: string, displayName: string): Promise<string> {
  const address = email.trim();
  if (!address) throw new Error('Give the email address to invite.');
  const name = displayName.trim();
  const { data, error } = await client.functions.invoke('invite-user', { body: name ? { email: address, displayName: name } : { email: address } });
  if (error) throw new Error((await functionErrorMessage(error)).message);
  return String((data as { message?: unknown } | null)?.message ?? 'Invitation sent.');
}
