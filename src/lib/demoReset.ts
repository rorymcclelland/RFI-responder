/**
 * Sprint 15 (S15-4, F-63): an admin resets the hosted demo from the governance page. The database
 * does the work (public.reset_demo): it checks the caller is an admin and the phrase is exact, puts
 * back the demo's responses and entries, keeps accounts, roles, limits, real usage and the audit log,
 * and writes the reset to the audit log. A project where no demo was loaded has nothing to reset.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const RESET_PHRASE = 'reset the demo';

export interface DemoStatus { loaded: boolean; lastResetAt: string | null }

/** The phrase must be typed exactly, as the database requires. */
export const isConfirmed = (typed: string): boolean => typed === RESET_PHRASE;

/** Whether this installation has a demo to reset. Any failure counts as no demo, so nothing is offered. */
export async function loadDemoStatus(client: SupabaseClient): Promise<DemoStatus> {
  const { data, error } = await client.rpc('demo_status');
  if (error || !data) {
    if (error) console.error('demo_status failed', error);
    return { loaded: false, lastResetAt: null };
  }
  const d = data as { loaded?: boolean; last_reset_at?: string | null };
  return { loaded: d.loaded === true, lastResetAt: d.last_reset_at ?? null };
}

/** The database's own refusals are plain; anything else stays in the console. */
const PLAIN = [/^Only an admin can reset the demo$/, /^Type "reset the demo" to confirm$/, /^No demo is loaded in this installation/];

export async function resetDemo(client: SupabaseClient, typed: string): Promise<string> {
  if (!isConfirmed(typed)) throw new Error(`Type "${RESET_PHRASE}" to confirm.`);
  const { data, error } = await client.rpc('reset_demo', { p_confirm: typed });
  if (error) {
    if (PLAIN.some((p) => p.test(error.message))) throw new Error(error.message);
    console.error('reset_demo failed', error);
    // Security review, finding 8: a lost connection can hide a reset that did happen.
    throw new Error('The demo may not have been reset. Check Last reset (reload the page), then try again if it has not changed.');
  }
  const d = data as { entries: number; responses: number };
  return `The demo is reset: ${d.entries} knowledge-base entries and ${d.responses} responses. The reset is in the audit log.`;
}
