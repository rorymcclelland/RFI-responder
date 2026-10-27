/**
 * POST { email, displayName? } -> { message }
 * Sprint 15 (S15-5, F-3): a signed-in admin invites someone, who joins as a member. Inviting needs the
 * service role key, which stays here, server-side (decision 0005). reserve_invitation checks the admin,
 * refuses an address with any account and holds the daily limit (20, UTC) under a lock per admin before
 * anything is sent. Each invitation is in the audit log (user.invited), by account id only.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, requireUser, serve } from '../_shared/http.ts';
import { inviteUser, type Reservation, type SendOutcome } from '../_shared/invite-core.ts';

/** Where the invitation's link leads: the app, the first of the allowed origins. */
const appOrigin = () => (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',')[0].trim();

serve(async (req) => {
  const { user } = await requireUser(req);
  const body = await req.json().catch(() => null);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const result = await inviteUser({
    async reserve(id, email, dailyLimit) {
      const { data, error } = await admin.rpc('reserve_invitation', { p_admin: id, p_email: email, p_daily_limit: dailyLimit });
      if (error) throw error;
      return data as Reservation;
    },
    async release(slot) {
      const { error } = await admin.rpc('release_invitation', { p_slot: slot });
      if (error) console.error('release_invitation failed', error);
    },
    async sendInvite(email, displayName, redirectTo): Promise<SendOutcome> {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        ...(displayName ? { data: { display_name: displayName } } : {}),
      });
      if (!error && data.user) return { outcome: 'sent', userId: data.user.id };
      const code = (error as { code?: string } | null)?.code ?? '';
      if (code === 'email_exists' || /already (been )?registered/i.test(error?.message ?? '')) return { outcome: 'exists' };
      if (code === 'over_email_send_rate_limit' || error?.status === 429) return { outcome: 'rate_limited' };
      console.error('inviteUserByEmail failed', error);
      return { outcome: 'failed' };
    },
    async audit(actor, invitedUserId) {
      const { error } = await admin.from('audit_log').insert({ actor, action: 'user.invited', target_id: invitedUserId, details: {} });
      if (error) {
        console.error('audit of an invitation failed', error);
        throw error;
      }
    },
  }, user.id, body, appOrigin());
  return json(req, 200, result);
});
