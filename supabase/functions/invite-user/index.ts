/**
 * POST { email, displayName? } -> { message }
 * Sprint 15 (S15-5, F-3): a signed-in admin invites someone, who joins as a member. Inviting needs the
 * service role key, which stays here, server-side (decision 0005). At most 20 invitations per admin per
 * day (UTC). Each invitation is in the audit log (user.invited), by account id only.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, requireUser, serve } from '../_shared/http.ts';
import { inviteUser, type SendOutcome } from '../_shared/invite-core.ts';

/** Where the invitation's link leads: the app, the first of the allowed origins. */
const appOrigin = () => (Deno.env.get('APP_ORIGIN') ?? 'http://localhost:5173').split(',')[0].trim();

serve(async (req) => {
  const { user } = await requireUser(req);
  const body = await req.json().catch(() => null);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const result = await inviteUser({
    async isAdmin(id) {
      const { data, error } = await admin.rpc('user_is_admin', { p_user: id });
      if (error) throw error;
      return data === true;
    },
    async invitesToday(id) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count, error } = await admin.from('audit_log').select('id', { count: 'exact', head: true })
        .eq('action', 'user.invited').eq('actor', id).gte('at', startOfDay.toISOString());
      if (error) throw error;
      return count ?? 0;
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
