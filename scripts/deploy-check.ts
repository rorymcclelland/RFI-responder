/**
 * Sprint 20 (S20-3): after a deploy, checks that what the repository holds is what the project runs.
 * Both of Sprint 18's live failures were deployment slips (a migration that failed on the push, and a
 * function not deployed), found by Rory by hand; this finds them first.
 *
 *   tsx scripts/deploy-check.ts <migration-list-output-file>
 *
 * Checks, and fails the workflow with the reason:
 * 1. Every migration in supabase/migrations is applied (from the project's applied versions (scripts/supabase-deploy.sh), or `supabase migration list`).
 * 2. Every Edge Function in supabase/functions is deployed: an unsigned call gets 401 from Supabase's
 *    gateway, where a function that is not deployed gets 404.
 * 3. The app answers at APP_URL with its page, built from EXPECTED_SHA (waiting for Vercel's build).
 * 4. Supabase's security advisor reports no error-level finding (warnings are listed, not failed:
 *    the accepted ones are in docs/governance/RISK-REGISTER.md).
 *
 * Needs SUPABASE_URL (https://<ref>.supabase.co), APP_URL, SUPABASE_ACCESS_TOKEN; VERCEL_BYPASS for a
 * protected preview. Prints no secret.
 *
 * Sprint 21 (S21-3, O-1, Q4):
 *
 *   tsx scripts/deploy-check.ts --auth <staging|production>
 *
 * reads the project's sign-in settings (read-only: the token has Auth Config: Read and nothing more
 * on sign-in) and fails, naming each difference, unless they match supabase/hosted-auth.json.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Migration versions in the repository, from the file names. */
export function repoMigrations(dir = 'supabase/migrations'): string[] {
  return readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
}

/**
 * Versions the project has applied, from the project's applied versions (scripts/supabase-deploy.sh), or `supabase migration list`, whose rows read
 * "  <local> | <remote> | <time>"; a migration only in the repository has an empty remote column.
 */
export function appliedMigrations(listOutput: string): string[] {
  const out: string[] = [];
  for (const line of listOutput.split(/\r?\n/)) {
    // Pipes or box-drawing bars, depending on how the CLI prints the table.
    if (/^\s*\d{14}\s*$/.test(line)) { out.push(line.trim()); continue; } // one version per line
    const cols = line.split(/[|│┃]/).map((c) => c.trim());
    if (cols.length >= 2 && /^\d{14}$/.test(cols[1])) out.push(cols[1]);
  }
  return out.sort();
}

export function missingMigrations(repo: string[], applied: string[]): string[] {
  const set = new Set(applied);
  return repo.filter((v) => !set.has(v));
}

/** Function names in the repository: each folder with an index.ts, apart from _shared. */
export function repoFunctions(dir = 'supabase/functions'): string[] {
  return readdirSync(dir)
    .filter((f) => !f.startsWith('_') && statSync(join(dir, f)).isDirectory())
    .filter((f) => { try { return statSync(join(dir, f, 'index.ts')).isFile(); } catch { return false; } })
    .sort();
}

/** What an unsigned call's status says about a function. */
export function functionVerdict(status: number): 'deployed' | 'missing' | 'unexpected' {
  if (status === 401) return 'deployed';
  if (status === 404) return 'missing';
  return 'unexpected';
}

/** The commit a built page names in its app-version meta tag (vite.config.ts), or null. */
export function appVersion(html: string): string | null {
  return html.match(/<meta name="app-version" content="([0-9a-f]{7,40})"/)?.[1] ?? null;
}

interface Lint { level?: string; name?: string; title?: string; detail?: string }

/** Error-level advisor findings, as lines to print. */
export function advisorErrors(lints: Lint[]): string[] {
  return lints.filter((l) => (l.level ?? '').toUpperCase() === 'ERROR').map((l) => `${l.name ?? l.title ?? 'finding'}: ${l.detail ?? ''}`.trim());
}

export type Environment = 'staging' | 'production';
export interface AuthSettings { disable_signup: boolean; site_url: string; uri_allow_list: string[] }

/** The sign-in settings the repository says an environment must have. */
export function expectedAuth(env: Environment, file = 'supabase/hosted-auth.json'): AuthSettings {
  const all = JSON.parse(readFileSync(file, 'utf8')) as { environments: Record<string, AuthSettings> };
  const e = all.environments[env];
  if (!e) throw new Error(`${file} has no settings for ${env}.`);
  // Accounts are invite-only (decision 0003): a change to this file cannot make the check accept
  // sign-ups (security review, Sprint 21).
  if (e.disable_signup !== true) throw new Error(`${file} says new sign-ups are allowed on ${env}; they must stay off (decision 0003).`);
  return e;
}

/** The Management API gives the redirect addresses as one comma-separated string. */
const addresses = (v: unknown): string[] =>
  (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : []).map((x) => x.trim()).filter(Boolean).sort();

/** Each way the project's settings differ from the repository's, in words that say what to change. */
export function authDifferences(expected: AuthSettings, actual: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (actual.disable_signup !== expected.disable_signup) {
    out.push(expected.disable_signup
      ? 'New sign-ups are allowed; the repository says off. Turn off "Allow new users to sign up" (Authentication, Sign In / Providers).'
      : 'New sign-ups are off; the repository says allowed.');
  }
  if (String(actual.site_url ?? '').replace(/\/$/, '') !== expected.site_url.replace(/\/$/, '')) {
    out.push(`The site address is "${String(actual.site_url ?? '')}"; the repository says "${expected.site_url}" (Authentication, URL Configuration).`);
  }
  const have = addresses(actual.uri_allow_list);
  const want = addresses(expected.uri_allow_list);
  const extra = have.filter((x) => !want.includes(x));
  const missing = want.filter((x) => !have.includes(x));
  if (missing.length) out.push(`Redirect addresses missing: ${missing.join(', ')} (Authentication, URL Configuration).`);
  if (extra.length) out.push(`Redirect addresses not in the repository: ${extra.join(', ')}. Remove them, or add them to supabase/hosted-auth.json.`);
  return out;
}

/** Reads a project's sign-in settings and compares them. Prints the three settings, never the token. */
export async function checkAuth(env: Environment, ref: string, token: string, get: typeof fetch = fetch, log: (s: string) => void = console.log): Promise<string[]> {
  const res = await get(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 || res.status === 403) {
    return [`The ${env} access token cannot read the sign-in settings (${res.status}). Make it again with Auth Config: Read added (docs/DEPLOYING.md, "Rotating the keys").`];
  }
  if (!res.ok) return [`The ${env} sign-in settings could not be read (${res.status}).`];
  const actual = (await res.json()) as Record<string, unknown>;
  const problems = authDifferences(expectedAuth(env), actual);
  log(`Sign-in settings (${env}): sign-ups ${actual.disable_signup === true ? 'off' : 'on'}; site ${String(actual.site_url ?? '')}; redirects ${addresses(actual.uri_allow_list).join(', ') || 'none'}.`);
  return problems;
}

async function authMain(env: string) {
  if (env !== 'staging' && env !== 'production') throw new Error('Say which environment: --auth staging, or --auth production.');
  const ref = (process.env.SUPABASE_URL ?? '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/)?.[1];
  if (!ref) throw new Error('SUPABASE_URL must be https://<project-ref>.supabase.co.');
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is needed to read the sign-in settings.');
  const problems = await checkAuth(env, ref, token);
  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log(`The ${env} sign-in settings match supabase/hosted-auth.json.`);
}

async function main() {
  const problems: string[] = [];
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) throw new Error('SUPABASE_URL must be https://<project-ref>.supabase.co.');

  // 1. Migrations.
  const listFile = process.argv[2];
  if (!listFile) throw new Error('Give the applied migration versions (from scripts/supabase-deploy.sh) as a file.');
  const missing = missingMigrations(repoMigrations(), appliedMigrations(readFileSync(listFile, 'utf8')));
  if (missing.length) {
    problems.push(`Migrations not applied: ${missing.join(', ')}`);
    // If none was read, the table's format is the likelier cause: show its first lines (no secrets in it).
    if (missing.length === repoMigrations().length) console.log(`The migration list began:\n${readFileSync(listFile, 'utf8').split(/\r?\n/).slice(0, 6).join('\n')}`);
  }
  else console.log(`Migrations: all ${repoMigrations().length} applied.`);

  // 2. Functions.
  for (const fn of repoFunctions()) {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const v = functionVerdict(res.status);
    if (v === 'deployed') console.log(`Function ${fn}: deployed.`);
    else problems.push(v === 'missing' ? `${fn} is not deployed (an unsigned call got 404).` : `${fn} answered an unsigned call with ${res.status}, not 401.`);
  }

  // 3. The app, serving this commit's build (security review, L5). Vercel builds after the push, so
  // this waits up to 15 minutes for the page to name the expected commit.
  const appUrl = process.env.APP_URL ?? '';
  if (appUrl) {
    const headers: Record<string, string> = process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {};
    const expected = process.env.EXPECTED_SHA ?? '';
    let last = { status: 0, version: null as string | null, page: false };
    for (let i = 0; i < 60; i++) {
      const res = await fetch(appUrl, { headers, cache: 'no-store' });
      const body = await res.text();
      last = { status: res.status, version: appVersion(body), page: body.includes('id="root"') };
      if (!expected || (last.status === 200 && last.version === expected)) break;
      await new Promise((r) => setTimeout(r, 15_000));
    }
    if (last.status !== 200 || !last.page) problems.push(`The app at ${appUrl} answered ${last.status} without its page.`);
    else if (expected && last.version !== expected) problems.push(`The app at ${appUrl} serves build ${last.version ?? '(unnamed)'}, not ${expected.slice(0, 7)}, after 15 minutes.`);
    else console.log(`App: ${appUrl} answers${expected ? `, serving ${expected.slice(0, 7)}` : ' (its build was not checked: EXPECTED_SHA is not set)'}.`);
  }

  // 4. The security advisor.
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? '';
  if (token) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/advisors/security`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const json = (await res.json()) as { lints?: Lint[] };
      const errors = advisorErrors(json.lints ?? []);
      if (errors.length) problems.push(`Security advisor errors:\n  ${errors.join('\n  ')}`);
      console.log(`Security advisor: ${errors.length} errors, ${(json.lints ?? []).length - errors.length} other findings.`);
    } else {
      problems.push(`The security advisor could not be read (${res.status}).`);
    }
  }

  if (problems.length) {
    for (const p of problems) console.error(`::error::${p}`);
    process.exit(1);
  }
  console.log('Every deploy check passed.');
}

if (process.argv[1]?.endsWith('deploy-check.ts')) {
  const auth = process.argv.indexOf('--auth');
  (auth > 0 ? authMain(process.argv[auth + 1] ?? '') : main()).catch((e) => {
    console.error(`::error::${(e as Error).message}`);
    process.exit(1);
  });
}
