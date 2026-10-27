/**
 * Sprint 15 (S15-5, F-3): an admin invites someone from the app. The logic, with the Supabase calls
 * passed in so it can be tested without them; supabase/functions/invite-user/index.ts wires it up.
 * The person always joins as a member: only an email address and an optional name are read from the
 * request, and an admin makes them an admin afterwards with set_user_admin, which is audited.
 */
import { HttpError } from './errors.ts';

/** Per admin, per day (UTC); counted from the audit log (Rory, Q6). */
export const MAX_INVITES_PER_DAY = 20;
const MAX_EMAIL = 254;
const MAX_LOCAL = 64;
const MAX_NAME = 100;
// Control characters and line separators: refused in an address or a name (no header injection).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteRequest { email: string; displayName: string | null }

export type SendOutcome = { outcome: 'sent'; userId: string } | { outcome: 'exists' | 'rate_limited' | 'failed' };

export interface InviteDeps {
  isAdmin(userId: string): Promise<boolean>;
  invitesToday(userId: string): Promise<number>;
  sendInvite(email: string, displayName: string | null, redirectTo: string): Promise<SendOutcome>;
  /** Records who invited whom by account id only, so deleting the person later leaves no address in the log. */
  audit(actor: string, invitedUserId: string): Promise<void>;
}

const bad = (message: string) => new HttpError(message, 400);

/** The address (trimmed, lower-cased, checked) and the optional name. Anything else is ignored. */
export function validateInvite(body: unknown): InviteRequest {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof b.email !== 'string') throw bad('Give the email address to invite.');
  const email = b.email.trim().toLowerCase();
  if (CONTROL.test(email) || !EMAIL.test(email) || email.length > MAX_EMAIL || email.split('@')[0].length > MAX_LOCAL) {
    throw bad('That is not an email address the app can invite.');
  }
  let displayName: string | null = null;
  if (b.displayName !== undefined && b.displayName !== null) {
    if (typeof b.displayName !== 'string') throw bad('The name must be text.');
    const name = b.displayName.trim();
    if (CONTROL.test(name)) throw bad('The name cannot contain line breaks or control characters.');
    if (name.length > MAX_NAME) throw bad(`The name can be at most ${MAX_NAME} characters.`);
    displayName = name || null;
  }
  return { email, displayName };
}

export async function inviteUser(deps: InviteDeps, callerId: string, body: unknown, redirectTo: string): Promise<{ message: string }> {
  const { email, displayName } = validateInvite(body);
  if (!(await deps.isAdmin(callerId))) throw new HttpError('Only an admin can invite people.', 403);
  if ((await deps.invitesToday(callerId)) >= MAX_INVITES_PER_DAY) {
    throw new HttpError(`An admin can send ${MAX_INVITES_PER_DAY} invitations a day (UTC), and you have sent them all today. Try again tomorrow.`, 429);
  }
  const sent = await deps.sendInvite(email, displayName, redirectTo);
  const outcome = sent.outcome;
  if (outcome === 'exists') throw new HttpError(`${email} already has an account. Nothing was sent.`, 409);
  if (outcome === 'rate_limited') throw new HttpError('The project has sent too many emails this hour. The invitation was not sent; try again later.', 429);
  if (outcome === 'failed') throw new HttpError('The invitation was not sent: the email could not be delivered to the mail service. Check the project\'s email settings, then try again.', 502);
  if (sent.outcome !== 'sent') throw new HttpError('The invitation was not sent.', 502);
  try {
    await deps.audit(callerId, sent.userId);
  } catch {
    // The email has gone, so say so, and that the record is missing.
    return { message: `Invitation sent to ${email}, but it could not be recorded in the audit log. Tell whoever runs the installation.` };
  }
  return { message: `Invitation sent to ${email}. They join as a member.` };
}
