/**
 * Sprint 20 (S20-2): before the acceptance tests run on staging, CI calls this to make the two test
 * people and reset the demo data, so each run starts from the same place.
 *
 * - The people are `e2e-admin@example.com` and `e2e-member@example.com` (example.com: no email is sent;
 *   the admin API confirms them directly). Each run gives both a new random password, made here,
 *   masked in the CI log and handed to the tests through GITHUB_ENV; it is never written anywhere else
 *   and nobody reads it. A password from an earlier run stops working.
 * - It refuses to touch the live demo: the project must not be the one named in PRODUCTION_SUPABASE_REF.
 *
 * Needs STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SERVICE_ROLE_KEY and
 * PRODUCTION_SUPABASE_REF. Runs only in CI (GitHub Actions); never in the browser.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

export const TEST_PEOPLE = [
  { email: 'e2e-admin@example.com', name: 'Ellis Admin (test)', admin: true },
  { email: 'e2e-member@example.com', name: 'Morgan Member (test)', admin: false },
] as const;

const REF = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/;

/** Why these settings must not be used, or null. Pure, and tested. */
export function stagingProblem(env: Record<string, string | undefined>): string | null {
  const url = env.STAGING_SUPABASE_URL?.trim() ?? '';
  const prod = env.PRODUCTION_SUPABASE_REF?.trim() ?? '';
  const m = url.match(REF);
  if (!m) return 'STAGING_SUPABASE_URL must be https://<project-ref>.supabase.co.';
  if (!/^[a-z0-9]{20}$/.test(prod)) return 'PRODUCTION_SUPABASE_REF must be the live demo\'s project ref, so this can refuse it.';
  if (m[1] === prod) return 'STAGING_SUPABASE_URL is the live demo\'s project: refusing to make test users or reset its data.';
  if (!env.STAGING_SUPABASE_ANON_KEY?.trim() || !env.STAGING_SERVICE_ROLE_KEY?.trim()) return 'STAGING_SUPABASE_ANON_KEY and STAGING_SERVICE_ROLE_KEY are needed.';
  return null;
}

/** A password of 32 random URL-safe characters. */
export const newPassword = () => randomBytes(24).toString('base64url');

async function main() {
  const problem = stagingProblem(process.env);
  if (problem) throw new Error(problem);
  const url = process.env.STAGING_SUPABASE_URL!.trim();
  const service = createClient(url, process.env.STAGING_SERVICE_ROLE_KEY!.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
  const password = newPassword();
  // Masked before anything could print it.
  console.log(`::add-mask::${password}`);

  const { data: list, error: listError } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(`Could not list users: ${listError.message}`);
  for (const p of TEST_PEOPLE) {
    const existing = list.users.find((u) => u.email?.toLowerCase() === p.email);
    const attrs = { password, email_confirm: true, user_metadata: { display_name: p.name } };
    const { data, error } = existing
      ? await service.auth.admin.updateUserById(existing.id, attrs)
      : await service.auth.admin.createUser({ email: p.email, ...attrs });
    if (error || !data.user) throw new Error(`Could not set up ${p.email}: ${error?.message ?? 'no user returned'}`);
    const { error: profileError } = await service.from('user_profiles')
      .update({ display_name: p.name, is_admin: p.admin, onboarded_at: null }).eq('id', data.user.id);
    if (profileError) throw new Error(`Could not set ${p.email}'s profile: ${profileError.message}`);
  }

  // The demo reset, as the test admin would press it in the app (admins only, audited).
  const anon = createClient(url, process.env.STAGING_SUPABASE_ANON_KEY!.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await anon.auth.signInWithPassword({ email: TEST_PEOPLE[0].email, password });
  if (signInError) throw new Error(`The test admin could not sign in: ${signInError.message}`);
  const { data: reset, error: resetError } = await anon.rpc('reset_demo', { p_confirm: 'reset the demo' });
  if (resetError) throw new Error(`The demo reset failed: ${resetError.message}`);
  console.log(`Staging demo reset: ${JSON.stringify(reset)}`);

  const out = process.env.GITHUB_ENV;
  if (out) {
    appendFileSync(out, [
      `E2E_ADMIN_EMAIL=${TEST_PEOPLE[0].email}`, `E2E_ADMIN_NAME=${TEST_PEOPLE[0].name}`,
      `E2E_MEMBER_EMAIL=${TEST_PEOPLE[1].email}`, `E2E_MEMBER_NAME=${TEST_PEOPLE[1].name}`,
      `E2E_PASSWORD=${password}`, '',
    ].join('\n'));
  }
}

if (process.argv[1]?.endsWith('e2e-staging-users.ts')) {
  main().catch((e) => {
    console.error(`::error::${(e as Error).message}`);
    process.exit(1);
  });
}
