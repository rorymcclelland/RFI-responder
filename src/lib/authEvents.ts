/**
 * Sprint 14 (S14-6, BUG-34): what an auth event means for the screen. Supabase reports the session
 * again when the tab regains focus (SIGNED_IN) and when it renews the token (TOKEN_REFRESHED); neither
 * is a new sign-in, and reloading the profile behind the full-page loading screen threw away every
 * expanded card, open modal and half-written answer.
 *
 * - load: a different person (or nobody's profile is on screen): the full load, with the loading screen.
 * - refresh: the same person reported again or updated: reload their profile quietly, so a changed
 *   role shows, without unmounting anything (security review, L1).
 * - keep: a renewed token, or a load already under way for that person.
 * - clear: no session.
 * `loaded` is set only once a profile is actually on screen, so a failed load is retried on the next
 * sign-in rather than leaving the person on the sign-in page (security review, M1).
 */
export type AuthAction = 'load' | 'refresh' | 'keep' | 'clear';
export interface AuthState { loaded: string | null; loading: string | null }

export function authEventAction(event: string, state: AuthState, sessionUserId: string | null): AuthAction {
  if (!sessionUserId) return 'clear';
  if (sessionUserId === state.loaded) return event === 'SIGNED_IN' || event === 'USER_UPDATED' ? 'refresh' : 'keep';
  if (sessionUserId === state.loading) return 'keep';
  return 'load';
}
