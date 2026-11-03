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
 * Sprint 20 slip) or that belongs to another project, refuses an access token that cannot read this
 * project's sign-in settings or that can reach the other project, and refuses to write staging
 * secrets for the live demo's project. Values pass from one command line to the other through
 * standard input; none is printed, written to a file, or put on a command line, and none passes
 * through Claude.
 *
 * Security review (Sprint 21): no shell; the Supabase command line is run from this repository's own
 * node_modules by Node itself, GitHub's by name only if no file of that name sits in this folder; the
 * repository is named on every GitHub call; and it will not ask for a secret where the typing would
 * show (not a terminal).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The repository the deploy runs in; named on every GitHub call, so a fork's remote is never used. */
export const REPO = 'rorymcclelland/RFI-responder';

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

/** A legacy key's own claims (role, and the project it belongs to), or null. */
function claims(value: string): { role?: unknown; ref?: unknown } | null {
  const parts = value.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown; ref?: unknown };
  } catch {
    return null;
  }
}

/** What kind of key a value is, from its own claims (legacy JWT keys) or prefix (new keys), or null. */
export function keyKind(value: string): KeyKind | null {
  const v = value.trim();
  if (v.startsWith('sb_publishable_')) return 'anon';
  if (v.startsWith('sb_secret_')) return 'service_role';
  const role = claims(v)?.role;
  return role === 'anon' || role === 'service_role' ? role : null;
}

/** Why a value must not be stored under a secret that wants this kind of key for this project, or null. */
export function kindProblem(secret: string, want: KeyKind, value: string, ref?: string): string | null {
  const got = keyKind(value);
  if (got !== want) {
    return got
      ? `Refusing ${secret}: the key found is a ${got === 'anon' ? 'public anon' : 'secret service'} key, and ${secret} needs the ${want === 'anon' ? 'public anon' : 'secret service'} key.`
      : `Refusing ${secret}: the value is not a Supabase API key.`;
  }
  // A legacy key names its project: it must be this one (security review, Sprint 21).
  const keyRef = claims(value)?.ref;
  if (ref && keyRef !== undefined && keyRef !== ref) return `Refusing ${secret}: the key belongs to another project.`;
  return null;
}

const REF = /^[a-z0-9]{20}$/;

/** Why these project refs must not be used, or null. The guard fails closed (security review, Sprint 21). */
export function refProblem(env: Environment, ref: string, productionRef: string): string | null {
  if (!REF.test(ref)) return `The ${env} project ref (repository variable ${env === 'staging' ? 'STAGING' : 'PRODUCTION'}_PROJECT_REF) is missing or not a project ref.`;
  if (!REF.test(productionRef)) return 'The live demo\'s project ref (repository variable PRODUCTION_PROJECT_REF) could not be read, so the script cannot make sure it is not writing to the wrong project.';
  if (env === 'staging' && ref === productionRef) return 'STAGING_PROJECT_REF is the live demo\'s project: refusing to write staging secrets for it.';
  return null;
}

/**
 * Why an access token must not be stored for this project, or null (security review, Sprint 21): it
 * must be a Supabase access token, read this project's sign-in settings (the deploy's check needs Auth
 * Config: Read), and not reach the other project. The token goes only in a request header.
 */
export async function tokenProblem(token: string, ref: string, otherRef: string, get: typeof fetch = fetch): Promise<string | null> {
  if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(token)) return 'Refusing SUPABASE_ACCESS_TOKEN: the value is not a Supabase access token (they start sbp_).';
  const call = async (r: string) => (await get(`https://api.supabase.com/v1/projects/${r}/config/auth`, { headers: { Authorization: `Bearer ${token}` } })).status;
  const own = await call(ref);
  if (own !== 200) return `Refusing SUPABASE_ACCESS_TOKEN: it cannot read this project's sign-in settings (${own}). Make it with Auth Config: Read, limited to this project.`;
  if (REF.test(otherRef)) {
    const other = await call(otherRef);
    if (other === 200) return 'Refusing SUPABASE_ACCESS_TOKEN: it can also reach the other project. Make one limited to this project only.';
  }
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

/** The Supabase command line, from this repository's own node_modules, run by Node (no shell, no npx). */
const SUPABASE_CLI = join('node_modules', 'supabase', 'dist', 'supabase.js');

const realRun: Run = (cmd, args, input) => {
  let file = cmd;
  let argv = args;
  if (cmd === 'supabase') {
    if (!existsSync(SUPABASE_CLI)) return { status: 1, stdout: '', stderr: 'Run npm ci first: the Supabase command line is not installed.' };
    file = process.execPath;
    argv = [SUPABASE_CLI, ...args];
  } else if (['', '.exe', '.cmd', '.bat', '.com', '.ps1'].some((x) => existsSync(`${cmd}${x}`))) {
    // Windows looks in the current folder first: a planted gh.cmd here would receive every secret.
    return { status: 1, stdout: '', stderr: `Refusing to run ${cmd}: a file of that name is in this folder.` };
  }
  const r = spawnSync(file, argv, { input, encoding: 'utf8', shell: false });
  // Not installed, or not on the PATH (Rory's first run, Sprint 21): say so rather than failing silently.
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    return { status: 1, stdout: '', stderr: cmd === 'gh'
      ? 'the GitHub command line (gh) is not installed: install it with "winget install --id GitHub.cli", open a new terminal, then "gh auth login"'
      : `${cmd} is not installed` };
  }
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** Asks on the terminal, echoing nothing (not even stars); refuses where typing would show. */
const realAsk: Ask = (question) => new Promise((resolve, reject) => {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    reject(new Error('Not a terminal, so what is typed would show. Run it in PowerShell or Windows Terminal.'));
    return;
  }
  process.stdout.write(`${question}: `);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  const done = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); resolve(value); };
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

export async function setup(env: Environment, apply: boolean, run: Run = realRun, ask: Ask = realAsk, log: (s: string) => void = console.log, get: typeof fetch = fetch): Promise<number> {
  // A variable holds a project ref, never a secret, so GitHub's reason for a failure can be shown.
  const variable = (name: string) => {
    const r = run('gh', ['variable', 'get', name, '--repo', REPO]);
    if (r.status !== 0) log(`Could not read the repository variable ${name}: ${(r.stderr || r.stdout).trim().split(/\r?\n/)[0] || `the GitHub command line stopped (${r.status})`}`);
    return r.status === 0 ? r.stdout.trim() : '';
  };
  const productionRef = variable('PRODUCTION_PROJECT_REF');
  const stagingRef = variable('STAGING_PROJECT_REF');
  const ref = env === 'staging' ? stagingRef : productionRef;
  const otherRef = env === 'staging' ? productionRef : stagingRef;
  const problem = refProblem(env, ref, productionRef);
  if (problem) { log(problem); return 1; }

  const secrets = plan(env);
  let keys: Partial<Record<KeyKind, string>> = {};
  if (secrets.some((s) => 'key' in s.from)) {
    const r = run('supabase', ['projects', 'api-keys', '--project-ref', ref, '-o', 'json']);
    if (r.status !== 0) { log(`The Supabase command line could not list the ${env} project's keys. Sign in with "npx supabase login" and try again.`); return 1; }
    keys = keysFrom(r.stdout);
  }

  log(`${apply ? 'Setting' : 'Dry run: would set'} these GitHub secrets in ${REPO} for ${env} (project ${ref}):`);
  let failed = 0;
  for (const s of secrets) {
    const where = s.scope === 'repository' ? 'repository secret' : `environment ${s.scope}`;
    let value: string;
    if ('key' in s.from) {
      value = keys[s.from.key] ?? '';
      const p = kindProblem(s.name, s.from.key, value, ref);
      if (p) { log(`  ${s.name} (${where}): ${p}`); failed += 1; continue; }
      if (!apply) { log(`  ${s.name} (${where}): from the project's ${s.from.key === 'anon' ? 'anon' : 'service'} key`); continue; }
    } else {
      if (!apply) { log(`  ${s.name} (${where}): asked for (${s.from.ask})`); continue; }
      try {
        value = (await ask(`${s.name}: paste ${s.from.ask}, or press Enter to leave it as it is`)).trim();
      } catch (err) {
        log((err as Error).message);
        return 1;
      }
      if (!value) { log(`  ${s.name} (${where}): left as it is`); continue; }
      // A paste that arrived as a control key (Ctrl+V in some Windows consoles) is never stored
      // (Rory's first run, Sprint 21); the count says something arrived without saying what.
      if (/[\u0000-\u001f\u007f]/.test(value)) {
        log(`  ${s.name} (${where}): not set; what arrived contains control keys, not text. In this window paste with a right-click (or Ctrl+Shift+V), then press Enter.`);
        failed += 1;
        continue;
      }
      log(`  ${s.name}: received ${value.length} characters`);
      if (s.name === 'SUPABASE_ACCESS_TOKEN') {
        const t = await tokenProblem(value, ref, otherRef, get);
        if (t) { log(`  ${s.name} (${where}): ${t}`); failed += 1; continue; }
      }
    }
    const args = ['secret', 'set', s.name, '--repo', REPO, ...(s.scope === 'repository' ? [] : ['--env', s.scope])];
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
