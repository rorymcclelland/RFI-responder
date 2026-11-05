import { describe, expect, it } from 'vitest';
import { advisorErrors, appVersion, appliedMigrations, functionVerdict, missingMigrations, repoFunctions, repoMigrations, servedIncludes } from './deploy-check';
import { newPassword, stagingProblem } from './e2e-staging-users';

describe('deploy checks (Sprint 20, S20-3)', () => {
  const list = [
    '',
    '   Local          | Remote         | Time (UTC)',
    '  ----------------|----------------|---------------------',
    '   20261106120000 | 20261106120000 | 2026-11-06 12:00:00',
    '   20261107100000 |                | 2026-11-07 10:00:00',
  ].join('\n');

  it('reads the applied migrations, and names one only in the repository (test case 2)', () => {
    expect(appliedMigrations(list)).toEqual(['20261106120000']);
    expect(missingMigrations(['20261106120000', '20261107100000'], appliedMigrations(list))).toEqual(['20261107100000']);
  });

  it('reads a plain list of versions, one per line', () => {
    expect(appliedMigrations('20261106120000\n20261107100000\n')).toEqual(['20261106120000', '20261107100000']);
  });

  it('reads the table however the CLI draws its column bars', () => {
    expect(appliedMigrations('  20261106120000 │ 20261106120000 │ 2026-11-06 12:00:00\n  20261107100000 │                │ 2026-11-07')).toEqual(['20261106120000']);
  });

  it('finds every migration and function in the repository', () => {
    expect(repoMigrations().length).toBeGreaterThan(60);
    expect(repoMigrations()).toContain('20261107100000');
    expect(repoFunctions()).toEqual(['ask-knowledge', 'embed', 'embed-entries', 'extract-questions', 'invite-user', 'process-questions']);
  });

  it('a 404 to an unsigned call means the function is not deployed (test case 3)', () => {
    expect(functionVerdict(401)).toBe('deployed');
    expect(functionVerdict(404)).toBe('missing');
    expect(functionVerdict(500)).toBe('unexpected');
  });

  it('reads the commit a built page names, and nothing else', () => {
    expect(appVersion('<head><meta name="app-version" content="a0be47f84216ce14766ee04a258dddbaf6d7e75a"></head>')).toBe('a0be47f84216ce14766ee04a258dddbaf6d7e75a');
    expect(appVersion('<meta name="app-version" content="dev">')).toBeNull();
    expect(appVersion('<div id="root"></div>')).toBeNull();
  });

  it('fails only on error-level advisor findings', () => {
    expect(advisorErrors([{ level: 'WARN', name: 'function_search_path_mutable' }, { level: 'ERROR', name: 'rls_disabled_in_public', detail: 'public.x' }]))
      .toEqual(['rls_disabled_in_public: public.x']);
  });
});

describe('staging test people (Sprint 20, S20-2)', () => {
  const ok = {
    STAGING_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
    PRODUCTION_SUPABASE_REF: 'mnlbqsnekdzvmkxvjiti',
    STAGING_SUPABASE_ANON_KEY: 'anon', STAGING_SERVICE_ROLE_KEY: 'service',
  };
  it('refuses the live demo, and anything not a Supabase project (test case 2)', () => {
    expect(stagingProblem(ok)).toBeNull();
    expect(stagingProblem({ ...ok, STAGING_SUPABASE_URL: 'https://mnlbqsnekdzvmkxvjiti.supabase.co' })).toMatch(/live demo/);
    expect(stagingProblem({ ...ok, STAGING_SUPABASE_URL: 'http://127.0.0.1:54321' })).toMatch(/must be/);
    expect(stagingProblem({ ...ok, PRODUCTION_SUPABASE_REF: '' })).toMatch(/PRODUCTION_SUPABASE_REF/);
    expect(stagingProblem({ ...ok, STAGING_SERVICE_ROLE_KEY: '' })).toMatch(/needed/);
  });
  it('makes a new long random password each time', () => {
    const a = newPassword(), b = newPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });

  it('accepts a later build that includes the expected commit, and nothing else (Sprint 24 production deploy)', async () => {
    const answers: Record<string, string | null> = { later: 'ahead', older: 'behind', other: 'diverged', unknown: null };
    const compare = async (_base: string, head: string) => answers[head] ?? null;
    expect(await servedIncludes('abc1234', 'abc1234', compare)).toBe(true);
    expect(await servedIncludes('abc1234', 'later', compare)).toBe(true);
    expect(await servedIncludes('abc1234', 'older', compare)).toBe(false);
    expect(await servedIncludes('abc1234', 'other', compare)).toBe(false);
    expect(await servedIncludes('abc1234', 'unknown', compare)).toBe(false);
    expect(await servedIncludes('abc1234', '', compare)).toBe(false);
  });
});
