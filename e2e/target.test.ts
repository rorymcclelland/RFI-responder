import { describe, expect, it } from 'vitest';
import { peopleOf, requestAllowedIn, targetProblem } from './target';

describe('where a browser test run may go (Sprint 20, S20-1 test case 3)', () => {
  it('runs locally only against this machine', () => {
    expect(targetProblem({})).toBeNull();
    expect(targetProblem({ E2E_BASE_URL: 'http://localhost:5173' })).toBeNull();
    expect(targetProblem({ E2E_BASE_URL: 'https://rfi-responder.vercel.app' })).toMatch(/only on a local install/);
    expect(requestAllowedIn({}, 'https://mnlbqsnekdzvmkxvjiti.supabase.co/auth/v1/token')).toBe(false);
    expect(requestAllowedIn({}, 'http://127.0.0.1:54321/rest/v1/x')).toBe(true);
  });

  const staging = {
    E2E_TARGET: 'staging', E2E_BASE_URL: 'https://rfi-responder-git-sprint-20.vercel.app',
    E2E_FORBIDDEN_HOSTS: 'rfi-responder.vercel.app,mnlbqsnekdzvmkxvjiti.supabase.co',
    E2E_ADMIN_EMAIL: 'e2e-admin@example.com', E2E_MEMBER_EMAIL: 'e2e-member@example.com', E2E_PASSWORD: 'made-for-the-run',
  };

  it('on staging, refuses the live demo and needs the run\'s people', () => {
    expect(targetProblem(staging)).toBeNull();
    expect(targetProblem({ ...staging, E2E_BASE_URL: 'https://rfi-responder.vercel.app' })).toMatch(/live demo/);
    expect(targetProblem({ ...staging, E2E_FORBIDDEN_HOSTS: '' })).toMatch(/E2E_FORBIDDEN_HOSTS/);
    expect(targetProblem({ ...staging, E2E_BASE_URL: 'http://example.com' })).toMatch(/https/);
    expect(targetProblem({ ...staging, E2E_PASSWORD: '' })).toMatch(/E2E_PASSWORD/);
    expect(requestAllowedIn(staging, 'https://mnlbqsnekdzvmkxvjiti.supabase.co/rest/v1/x')).toBe(false);
    expect(requestAllowedIn(staging, 'https://abcdefghijklmnopqrst.supabase.co/rest/v1/x')).toBe(true);
    expect(peopleOf(staging).admin.email).toBe('e2e-admin@example.com');
  });

  it('locally plays the seed admin and a member who owns nothing', () => {
    expect(peopleOf({}).admin.name).toBe('Sarah Chen');
    expect(peopleOf({}).member.name).toBe('Tom Richardson');
  });
});
