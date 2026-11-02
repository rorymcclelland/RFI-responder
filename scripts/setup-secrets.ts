/**
 * Sprint 21 (S21-3, O-1): stores the deploy's keys in GitHub without anyone copying them. Rory runs it
 * on his own PC, signed in to the Supabase and GitHub command lines as himself (`npx supabase login`,
 * `gh auth login`):
 *
 *   npx tsx scripts/setup-secrets.ts staging              a dry run: lists what it would set, by name
 *   npx tsx scripts/setup-secrets.ts staging --apply      sets them
 *   npx tsx scripts/setup-secrets.ts production [--apply]
 *
 * What it does, for the environment named:
 * - reads the project's API keys with the Supabase command line, and stores the ones the deploy needs
 *   (staging: the anon key, in the environment and as a repository secret for the keep-awake ping, and
 *   the service key); production needs none;
 * - asks, without showing what is typed, for what only a dashboard issues: the project's access token
 *   (Supabase makes those only in its dashboard), the database password, and for staging Vercel's
 *   protection-bypass secret. Press Enter at a prompt to leave that secret as it is.
 *
 * It refuses a key whose kind does not match its secret (a service key where the anon key goes: the
 * Sprint 20 slip), and refuses to write staging secrets for the live demo's project. Values pass from
 * one command line to the other through standard input; none is printed, written to a file, or put on
 * a command line, and none passes through Claude.
 */
import { spawnSync } from 'node:child_process';

export type Environment = 'staging' | 'production';
export type KeyKind = 'anon' | 'service_role';

export interface Secret {
  name: string;
  /** Where GitHub keeps it: an environment's secrets, or the repository's. */
  scope: Environment | 'repository';
  /** Read from the project's keys, or asked for. */
  from: { key: KeyKind } | { ask: string };
}

/** The secrets the deploy workflow reads (docs/DEPLOYING.md), for each environment. */
export function plan(env: Environment): Secret[] {
  if (env === 'staging') {
    return [
      { name: 'STAGING_SUPABASE_ANON_KEY', scope: 'staging', from: { key: 'anon' } },
      { name: 'STAGING_SUPABASE_ANON_KEY', scope: 'repository', from: { key: 'anon' } },
      { name: 'STAGING_SERVICE_ROLE_KEY', scope: 'staging', from: { key: 'service_role' } },
      { name: 'SUPABASE_ACCESS_TOKEN', scope: 'staging', from: { ask: 'the staging access token (Supabase, Account, Access Tokens; limited to the staging project)' } },
      { name: 'STAGING_DB_PASSWORD', scope: 'staging', from: { ask: 'the staging database password' } },
      { name: 'VERCEL_BYPASS_SECRET', scope: 'staging', from: { ask: 'Vercel\'s Protection Bypass for Automation secret' } },
    ];
  }
  return [
    { name: 'SUPABASE_ACCESS_TOKEN', scope: 'production', from: { ask: 'the live demo\'s access token (limited to the live demo\'s project)' } },
    { name: 'PRODUCTION_DB_PASSWORD', scope: 'production', from: { ask: 'the live demo\'s database password' } },
  ];
}

/** What kind of key a value is, from its own claims (legacy JWT keys) or prefix (new keys), or null. */
export function keyKind(value: string): KeyKind | null {
  const v = value.trim();
  if (v.startsWith('sb_publishable_')) return 'anon';
  if (v.startsWith('sb_secret_')) return 'service_role';
  const parts = v.split('.');
  if (parts.length !== 3) return null;
  try {
    const role = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }).role;
    return role === 'anon' || role === 'service_role' ? role : null;
  } catch {
    return null;
  }
}

/** Why a value must not be stored under a secret that wants this kind of key, or null. */
export function kindProblem(secret: string, want: KeyKind, value: string): string | null {
  const got = keyKind(value);
  if (got === want) return null;
  return got
    ? `Refusing ${secret}: the key found is a ${got === 'anon' ? 'public anon' : 'secret service'} key, and ${secret} needs the ${want === 'anon' ? 'public anon' : 'secret service'} key.`
    : `Refusing ${secret}: the value is not a Supabase API key.`;
}

/** Why these project refs must not be used, or null. */
export function refProblem(env: Environment, ref: string, productionRef: string): string | null {
  if (!/^[a-z0-9]{20}$/.test(ref)) return `The ${env} project ref (repository variable ${env === 'staging' ? 'STAGING' : 'PRODUCTION'}_PROJECT_REF) is missing or not a project ref.`;
  if (env === 'staging' && ref === productionRef) return 'STAGING_PROJECT_REF is the live demo\'s project: refusing to write staging secrets for it.';
  return null;
}

/** Reads the API keys the Supabase command line lists for a project, by kind. */
export function keysFrom(json: string): Partial<Record<KeyKind, string>> {
  const rows = JSON.parse(json) as { name?: string; api_key?: string }[];
  const out: Partial<Record<KeyKind, string>> = {};
  for (const r of rows) {
    if (r.name === 'anon' && r.api_key) out.anon = r.api_key;
    if (r.name === 'service_role' && r.api_key) out.service_role = r.api_key;
  }
  return out;
}

/** Runs a command; `input` goes to its standard input. Replaced in the tests. */
export type Run = (cmd: string, args: string[], input?: string) => { status: number; stdout: string; stderr: string };
/** Asks for a value without showing it. Replaced in the tests. */
export type Ask = (question: string) => Promise<string>;

const realRun: Run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', shell: process.platform === 'win32' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Asks on the terminal, echoing nothing (not even stars). */
const realAsk: Ask = (question) => new Promise((resolve) => {
  process.stdout.write(`${question}: `);
  const stdin = process.stdin;
  const raw = stdin.isTTY;
  if (raw) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  const done = () => { if (raw) stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); resolve(value); };
  const on = (chunk: string) => {
    for (const ch of chunk) {
      if (ch === '\r' || ch === '\n') return done();
      if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
      if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
      else value += ch;
    }
  };
  stdin.on('data', on);
});

export async function setup(env: Environment, apply: boolean, run: Run = realRun, ask: Ask = realAsk, log: (s: string) => void = console.log): Promise<number> {
  const variable = (name: string) => {
    const r = run('gh', ['variable', 'get', name]);
    return r.status === 0 ? r.stdout.trim() : '';
  };
  const ref = variable(env === 'staging' ? 'STAGING_PROJECT_REF' : 'PRODUCTION_PROJECT_REF');
  const problem = refProblem(env, ref, variable('PRODUCTION_PROJECT_REF'));
  if (problem) { log(problem); return 1; }

  const secrets = plan(env);
  let keys: Partial<Record<KeyKind, string>> = {};
  if (secrets.some((s) => 'key' in s.from)) {
    const r = run('npx', ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json']);
    if (r.status !== 0) { log(`The Supabase command line could not list the ${env} project's keys. Sign in with "npx supabase login" and try again.`); return 1; }
    keys = keysFrom(r.stdout);
  }

  log(`${apply ? 'Setting' : 'Dry run: would set'} these GitHub secrets for ${env} (project ${ref}):`);
  let failed = 0;
  for (const s of secrets) {
    const where = s.scope === 'repository' ? 'repository secret' : `environment ${s.scope}`;
    let value: string;
    if ('key' in s.from) {
      value = keys[s.from.key] ?? '';
      const p = kindProblem(s.name, s.from.key, value);
      if (p) { log(`  ${s.name} (${where}): ${p}`); failed += 1; continue; }
      if (!apply) { log(`  ${s.name} (${where}): from the project's ${s.from.key === 'anon' ? 'anon' : 'service'} key`); continue; }
    } else {
      if (!apply) { log(`  ${s.name} (${where}): asked for (${s.from.ask})`); continue; }
      value = (await ask(`${s.name}: paste ${s.from.ask}, or press Enter to leave it as it is`)).trim();
      if (!value) { log(`  ${s.name} (${where}): left as it is`); continue; }
    }
    const args = ['secret', 'set', s.name, ...(s.scope === 'repository' ? [] : ['--env', s.scope])];
    const r = run('gh', args, value);
    if (r.status === 0) log(`  ${s.name} (${where}): set`);
    else { log(`  ${s.name} (${where}): not set; the GitHub command line refused it (signed in, with access to the repository?)`); failed += 1; }
  }
  if (!apply) log('Nothing was changed. Run again with --apply to set them.');
  return failed ? 1 : 0;
}

if (process.argv[1]?.endsWith('setup-secrets.ts')) {
  const env = process.argv[2];
  if (env !== 'staging' && env !== 'production') {
    console.error('Say which environment: npx tsx scripts/setup-secrets.ts staging (or production), then --apply to set them.');
    process.exit(2);
  }
  setup(env, process.argv.includes('--apply')).then((code) => process.exit(code));
}
