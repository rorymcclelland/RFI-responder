/**
 * Sprint 14 (S14-6, BUG-34): what an auth event means for the screen. Supabase reports the session
 * again when the tab regains focus (SIGNED_IN) and when it renews the token (TOKEN_REFRESHED); neither
 * is a new sign-in, and reloading the profile behind the full-page loading screen threw away every
 * expanded card, open modal and half-written answer. The profile is loaded only when the person changes.
 */
export type AuthAction = 'load' | 'keep' | 'clear';

export function authEventAction(_event: string, currentUserId: string | null, sessionUserId: string | null): AuthAction {
  if (!sessionUserId) return 'clear';
  return sessionUserId === currentUserId ? 'keep' : 'load';
}
