// Sprint 14, S14-6 (BUG-34): a session check on refocus must not reload the app.
import { describe, expect, it } from 'vitest';
import { authEventAction } from './authEvents';

describe('authEventAction (S14-6)', () => {
  it('1. the same person signed in again (refocus) or a renewed token changes nothing on screen', () => {
    expect(authEventAction('SIGNED_IN', 'u1', 'u1')).toBe('keep');
    expect(authEventAction('TOKEN_REFRESHED', 'u1', 'u1')).toBe('keep');
    expect(authEventAction('USER_UPDATED', 'u1', 'u1')).toBe('keep');
    expect(authEventAction('INITIAL_SESSION', 'u1', 'u1')).toBe('keep');
  });

  it('2. a different person, or someone signing in from signed out, loads their profile', () => {
    expect(authEventAction('SIGNED_IN', 'u1', 'u2')).toBe('load');
    expect(authEventAction('SIGNED_IN', null, 'u2')).toBe('load');
    expect(authEventAction('INITIAL_SESSION', null, 'u2')).toBe('load');
  });

  it('3. signing out, or a session that has gone, clears the user', () => {
    expect(authEventAction('SIGNED_OUT', 'u1', null)).toBe('clear');
    expect(authEventAction('TOKEN_REFRESHED', 'u1', null)).toBe('clear');
  });

  it('nothing to do when signed out and still signed out', () => {
    expect(authEventAction('INITIAL_SESSION', null, null)).toBe('clear');
  });
});
