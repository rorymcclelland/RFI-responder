/**
 * Sprint 14 (S14-3): a hosted build must point at a hosted Supabase project. Run before `vite build` by
 * `npm run build:hosted`, which the static host uses (vercel.json); a local build (`npm run build`) does
 * not need it. Fails with the reasons, so a deployment never ships pointing at a developer's machine,
 * at nothing, or with the secret key in the bundle.
 */
import { keyRole } from '../src/lib/config';
import { isLocalUrl } from './local-only';

export function hostedBuildProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const url = env.VITE_SUPABASE_URL?.trim() ?? '';
  const key = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
  if (!url) problems.push('VITE_SUPABASE_URL is not set: give the hosted project\'s address (Project Settings, API).');
  else {
    let u: URL | null = null;
    try { u = new URL(url); } catch { /* reported below */ }
    if (!u) problems.push(`VITE_SUPABASE_URL is not an address: ${url}`);
    else if (isLocalUrl(url) || ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) problems.push('VITE_SUPABASE_URL points at this machine; a hosted build needs the hosted project.');
    else if (u.protocol !== 'https:') problems.push('VITE_SUPABASE_URL must use https.');
    else if (u.username || u.password) problems.push('VITE_SUPABASE_URL must not contain a user name or password.');
    // Security review, L5: the content security policy allows only Supabase's hosts, so anything else fails at run time.
    else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)) problems.push('VITE_SUPABASE_URL must be a hosted Supabase project address, https://<project-ref>.supabase.co.');
  }
  if (!key) problems.push('VITE_SUPABASE_ANON_KEY is not set: give the hosted project\'s anon (publishable) key.');
  else if (keyRole(key) === 'service_role' || /^sb_secret_/.test(key)) problems.push('VITE_SUPABASE_ANON_KEY holds the secret (service-role) key, which must never reach the browser.');
  return problems;
}

if (process.argv[1]?.endsWith('hosted-build.ts')) {
  const problems = hostedBuildProblems(process.env);
  if (problems.length) {
    console.error(`The hosted build stopped:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
}
