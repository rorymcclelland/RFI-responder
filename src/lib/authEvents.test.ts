// Sprint 14, S14-6 (BUG-34): a session check on refocus must not reload the app; and its security review.
import { describe, expect, it } from 'vitest';
import { authEventAction, type AuthState } from './authEvents';

const st = (loaded: string | null, loading: string | null = null): AuthState => ({ loaded, loading });

describe('authEventAction (S14-6)', () => {
  it('1. a renewed token for the same person changes nothing', () => {
    expect(authEventAction('TOKEN_REFRESHED', st('u1'), 'u1')).toBe('keep');
    expect(authEventAction('INITIAL_SESSION', st('u1'), 'u1')).toBe('keep');
  });

  it('1. the same person reported again (refocus) or updated refreshes the profile quietly, never the loading screen', () => {
    expect(authEventAction('SIGNED_IN', st('u1'), 'u1')).toBe('refresh');
    expect(authEventAction('USER_UPDATED', st('u1'), 'u1')).toBe('refresh');
  });

  it('2. a different person, or someone signing in from signed out, loads their profile', () => {
    expect(authEventAction('SIGNED_IN', st('u1'), 'u2')).toBe('load');
    expect(authEventAction('SIGNED_IN', st(null), 'u2')).toBe('load');
    expect(authEventAction('INITIAL_SESSION', st(null), 'u2')).toBe('load');
  });

  it('a load already under way for that person is not started twice', () => {
    expect(authEventAction('INITIAL_SESSION', st(null, 'u2'), 'u2')).toBe('keep');
    expect(authEventAction('SIGNED_IN', st(null, 'u2'), 'u2')).toBe('keep');
  });

  it('security review, M1: after a failed load, signing in again as the same person loads again', () => {
    expect(authEventAction('SIGNED_IN', st(null, null), 'u1')).toBe('load');
  });

  it('3. signing out, or a session that has gone, clears the user', () => {
    expect(authEventAction('SIGNED_OUT', st('u1'), null)).toBe('clear');
    expect(authEventAction('TOKEN_REFRESHED', st('u1'), null)).toBe('clear');
    expect(authEventAction('INITIAL_SESSION', st(null), null)).toBe('clear');
  });
});
