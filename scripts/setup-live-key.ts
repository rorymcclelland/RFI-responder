/**
 * Sprint 26 (S26-2, F-77): only the approved deploy can move `live`, the branch Vercel publishes as the
 * live demo. Rory runs this on his own PC, in the repository's folder, signed in to GitHub's command
 * line as himself (`gh auth login`), with OpenSSH's ssh-keygen on the PATH (Windows has it):
 *
 *   npx tsx scripts/setup-live-key.ts            a dry run: says what it would do, changes nothing
 *   npx tsx scripts/setup-live-key.ts --apply    does it
 *
 * What it does:
 * - two rulesets: on `live`, no update, force push or deletion except by a deploy key or the
 *   repository's admins (Rory, to roll back); on `main`, no force push or deletion, for anyone
 *   (Rory, 7 November: Q4). Made if missing, brought back to this definition if changed.
 * - a new deploy key that can write: the key pair is made in a temporary folder, the public half is
 *   added to the repository, the private half is stored as the `production` environment's secret
 *   LIVE_DEPLOY_KEY through standard input, and the folder is deleted. Earlier keys of this script
 *   are then removed, so running it again changes the key (and leaves only the new one).
 *
 * It refuses if the repository has another deploy key that can write: a ruleset lets every deploy key
 * through, so any such key could publish. No private key is printed, written outside the temporary
 * folder, or put on a command line, and none passes through Claude.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, realRun, type Run } from './setup-secrets';

export const SECRET = 'LIVE_DEPLOY_KEY';
export const KEY_TITLE = 'RFI Respond: the approved deploy moves live';
const ADMIN_ROLE = 5; // GitHub's id for the repository's admin role, in ruleset bypass lists

export interface Ruleset {
  name: string;
  target: 'branch';
  enforcement: 'active';
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: { type: string; parameters?: Record<string, unknown> }[];
  bypass_actors: { actor_type: string; actor_id?: number | null; bypass_mode: 'always' }[];
}

/** The two rulesets, as GitHub's API takes them. */
export function rulesets(): Ruleset[] {
  return [
    {
      name: 'live: only the approved deploy',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/live'], exclude: [] } },
      rules: [{ type: 'update', parameters: { update_allows_fetch_and_merge: false } }, { type: 'deletion' }, { type: 'non_fast_forward' }],
      bypass_actors: [
        { actor_type: 'DeployKey', actor_id: null, bypass_mode: 'always' },
        { actor_type: 'RepositoryRole', actor_id: ADMIN_ROLE, bypass_mode: 'always' },
      ],
    },
    {
      name: 'main: no force push or deletion',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
      bypass_actors: [],
    },
  ];
}

interface DeployKey { id: number; title: string; read_only: boolean }

/** Deploy keys that can write and are not this script's: each could bypass the `live` ruleset. */
export function otherWriteKeys(keys: DeployKey[]): DeployKey[] {
  return keys.filter((k) => !k.read_only && !k.title.startsWith(KEY_TITLE));
}

/** Makes a key pair in a temporary folder and hands it over; the folder is gone when `use` returns. Replaced in the tests. */
export type MakeKey = <T>(run: Run, use: (pair: { privateKey: string; publicKey: string }) => T) => T;

const realMakeKey: MakeKey = (run, use) => {
  const dir = mkdtempSync(join(tmpdir(), 'rfi-live-key-'));
  try {
    const file = join(dir, 'key');
    const r = run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', KEY_TITLE, '-f', file]);
    if (r.status !== 0) throw new Error('ssh-keygen failed: is OpenSSH installed? (Windows: Settings, Apps, Optional features, OpenSSH Client)');
    return use({ privateKey: readFileSync(file, 'utf8'), publicKey: readFileSync(`${file}.pub`, 'utf8').trim() });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

function json<T>(r: { status: number; stdout: string }): T | null {
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout) as T; } catch { return null; }
}

export async function setup(apply: boolean, run: Run = realRun, makeKey: MakeKey = realMakeKey, log: (s: string) => void = console.log): Promise<number> {
  log(`${apply ? 'Setting up' : 'Dry run for'} the protection of live and main in ${REPO}.`);
  const keys = json<DeployKey[]>(run('gh', ['api', `repos/${REPO}/keys`]));
  if (!keys) { log('Could not read the repository\'s deploy keys: signed in to gh, as an admin of the repository?'); return 1; }
  const others = otherWriteKeys(keys);
  if (others.length) {
    log(`Refusing: ${others.length} other deploy key(s) can write (${others.map((k) => `"${k.title}"`).join(', ')}), and a ruleset lets every deploy key through. Make them read-only or remove them first.`);
    return 1;
  }
  const existing = json<{ id: number; name: string }[]>(run('gh', ['api', `repos/${REPO}/rulesets`]));
  if (!existing) { log('Could not read the repository\'s rulesets.'); return 1; }

  let failed = 0;
  for (const rs of rulesets()) {
    const found = existing.find((e) => e.name === rs.name);
    if (!apply) { log(`  ruleset "${rs.name}": would be ${found ? 'brought back to its definition' : 'made'}`); continue; }
    const r = found
      ? run('gh', ['api', '-X', 'PUT', `repos/${REPO}/rulesets/${found.id}`, '--input', '-'], JSON.stringify(rs))
      : run('gh', ['api', '-X', 'POST', `repos/${REPO}/rulesets`, '--input', '-'], JSON.stringify(rs));
    if (r.status === 0) log(`  ruleset "${rs.name}": ${found ? 'up to date' : 'made'}`);
    else { log(`  ruleset "${rs.name}": not set; GitHub refused it`); failed += 1; }
  }

  const old = keys.filter((k) => k.title.startsWith(KEY_TITLE));
  if (!apply) {
    log(`  deploy key: a new one would be made, its private half stored as ${SECRET} in the production environment${old.length ? `, and ${old.length} earlier key(s) of this script removed` : ''}`);
    log('Nothing was changed. Run again with --apply to do it.');
    return 0;
  }
  if (failed) { log('The deploy key was not changed, because a ruleset was not set.'); return 1; }

  const title = `${KEY_TITLE} (${new Date().toISOString().slice(0, 10)})`;
  const ok = makeKey(run, ({ privateKey, publicKey }) => {
    const added = json<{ id: number }>(run('gh', ['api', '-X', 'POST', `repos/${REPO}/keys`, '--input', '-'],
      JSON.stringify({ title, key: publicKey, read_only: false })));
    if (!added) { log('  deploy key: GitHub refused the new key; nothing was changed'); return false; }
    const stored = run('gh', ['secret', 'set', SECRET, '--env', 'production', '--repo', REPO], privateKey);
    if (stored.status !== 0) {
      run('gh', ['api', '-X', 'DELETE', `repos/${REPO}/keys/${added.id}`]);
      log(`  deploy key: ${SECRET} could not be stored, so the new key was removed again; nothing was changed`);
      return false;
    }
    log(`  deploy key: made, and its private half stored as ${SECRET} in the production environment`);
    return true;
  });
  if (!ok) return 1;
  for (const k of old) {
    const r = run('gh', ['api', '-X', 'DELETE', `repos/${REPO}/keys/${k.id}`]);
    log(r.status === 0 ? `  earlier key "${k.title}": removed` : `  earlier key "${k.title}": could not be removed; remove it in Settings, Deploy keys`);
    if (r.status !== 0) failed += 1;
  }
  return failed ? 1 : 0;
}

if (process.argv[1]?.endsWith('setup-live-key.ts')) {
  setup(process.argv.includes('--apply')).then((code) => process.exit(code));
}
