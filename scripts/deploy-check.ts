/**
 * Sprint 20 (S20-3): after a deploy, checks that what the repository holds is what the project runs.
 * Both of Sprint 18's live failures were deployment slips (a migration that failed on the push, and a
 * function not deployed), found by Rory by hand; this finds them first.
 *
 *   tsx scripts/deploy-check.ts <migration-list-output-file>
 *
 * Checks, and fails the workflow with the reason:
 * 1. Every migration in supabase/migrations is applied (from `supabase migration list --linked`).
 * 2. Every Edge Function in supabase/functions is deployed: an unsigned call gets 401 from Supabase's
 *    gateway, where a function that is not deployed gets 404.
 * 3. The app answers at APP_URL with its page.
 * 4. Supabase's security advisor reports no error-level finding (warnings are listed, not failed:
 *    the accepted ones are in docs/governance/RISK-REGISTER.md).
 *
 * Needs SUPABASE_URL (https://<ref>.supabase.co), APP_URL, SUPABASE_ACCESS_TOKEN; VERCEL_BYPASS for a
 * protected preview. Prints no secret.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Migration versions in the repository, from the file names. */
export function repoMigrations(dir = 'supabase/migrations'): string[] {
  return readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).map((f) => f.slice(0, 14)).sort();
}

/**
 * Versions the project has applied, from `supabase migration list --linked`, whose rows read
 * "  <local> | <remote> | <time>"; a migration only in the repository has an empty remote column.
 */
export function appliedMigrations(listOutput: string): string[] {
  const out: string[] = [];
  for (const line of listOutput.split(/\r?\n/)) {
    const cols = line.split('|').map((c) => c.trim());
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

interface Lint { level?: string; name?: string; title?: string; detail?: string }

/** Error-level advisor findings, as lines to print. */
export function advisorErrors(lints: Lint[]): string[] {
  return lints.filter((l) => (l.level ?? '').toUpperCase() === 'ERROR').map((l) => `${l.name ?? l.title ?? 'finding'}: ${l.detail ?? ''}`.trim());
}

async function main() {
  const problems: string[] = [];
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const ref = supabaseUrl.match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1];
  if (!ref) throw new Error('SUPABASE_URL must be https://<project-ref>.supabase.co.');

  // 1. Migrations.
  const listFile = process.argv[2];
  if (!listFile) throw new Error('Give the output of `supabase migration list --linked` as a file.');
  const missing = missingMigrations(repoMigrations(), appliedMigrations(readFileSync(listFile, 'utf8')));
  if (missing.length) problems.push(`Migrations not applied: ${missing.join(', ')}`);
  else console.log(`Migrations: all ${repoMigrations().length} applied.`);

  // 2. Functions.
  for (const fn of repoFunctions()) {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const v = functionVerdict(res.status);
    if (v === 'deployed') console.log(`Function ${fn}: deployed.`);
    else problems.push(v === 'missing' ? `${fn} is not deployed (an unsigned call got 404).` : `${fn} answered an unsigned call with ${res.status}, not 401.`);
  }

  // 3. The app.
  const appUrl = process.env.APP_URL ?? '';
  if (appUrl) {
    const headers: Record<string, string> = process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {};
    const res = await fetch(appUrl, { headers });
    const body = await res.text();
    if (res.status !== 200 || !body.includes('id="root"')) problems.push(`The app at ${appUrl} answered ${res.status} without its page.`);
    else console.log(`App: ${appUrl} answers.`);
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
  main().catch((e) => {
    console.error(`::error::${(e as Error).message}`);
    process.exit(1);
  });
}
