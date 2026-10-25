/**
 * BUG-30 (Sprint 10 accuracy review): the links in invitation and password-reset emails signed the
 * person in but never let them choose a password. Supabase marks those links with type=invite or
 * type=recovery in the address's fragment; the app reads it before the client clears it, and asks for
 * a new password before anything else.
 */

export type LinkPurpose = 'invite' | 'recovery' | null;

export function linkPurpose(hash: string): LinkPurpose {
  const type = new URLSearchParams(hash.replace(/^#/, '')).get('type');
  return type === 'invite' || type === 'recovery' ? type : null;
}

/** The rules in supabase/config.toml: at least 12 characters, with letters and digits. */
export const MIN_PASSWORD_LENGTH = 12;

/** Why a new password cannot be used, in plain words; null when it can. */
export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use letters and at least one digit.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}
