// Sprint 26 (S26-2, F-77; QA review M3 and L6): the production job's own shell, run here, not only read.
// The ready check runs with a stand-in for GitHub's command line in each case where it must refuse, and
// must end in an error before anything is deployed; the push to "live" runs against a local repository
// standing in for GitHub, with a planted hook and a fake git on the PATH that must not run.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
const production = workflow.slice(workflow.indexOf('\n  production:\n'));

/** The shell of the production step named, as GitHub runs it. */
function stepScript(name: string): string {
  const start = production.indexOf(`      - name: ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const rest = production.slice(start);
  const end = rest.indexOf('\n      - ', 10);
  const block = end < 0 ? rest : rest.slice(0, end);
  const body = block.slice(block.indexOf('        run: |\n') + '        run: |\n'.length);
  return body.split('\n').map((l) => l.slice(10)).join('\n');
}

const work = mkdtempSync(join(tmpdir(), 'deploy-steps-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** GitHub's API as the ready check sees it: each path answers with JSON, or fails as gh does. */
type Api = Record<string, unknown | 'error'>;
const ALL_GOOD: Api = {
  'environments/production': { protection_rules: [{ type: 'required_reviewers' }], deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } },
  'environments/production/deployment-branch-policies': { branch_policies: [{ name: 'main', type: 'branch' }] },
  'rules/branches/live': [{ type: 'update' }, { type: 'deletion' }, { type: 'non_fast_forward' }],
  'compare/live...SHA': { status: 'ahead' },
};

function ready(api: Api, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(work, 'ready-'));
  writeFileSync(join(dir, 'api.json'), JSON.stringify(api));
  // gh api <path> --jq <expr>: the answer for the path, filtered; on an error, the error body unfiltered, as gh does.
  writeFileSync(join(dir, 'gh'), `#!/bin/bash
path="\${2#repos/o/r/}"; expr="\${4:-.}"
if ! jq -e --arg p "$path" 'has($p) and .[$p] != "error"' "${dir}/api.json" >/dev/null; then echo '{"message":"Not Found","status":"404"}'; exit 1; fi
jq -r --arg p "$path" ".[\\$p] | $expr" "${dir}/api.json"
`);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'out'), '');
  const r = spawnSync('bash', ['-c', stepScript('Is the deploy set up, and does it wait for approval?')], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'o/r', GITHUB_SHA: 'SHA', GITHUB_OUTPUT: join(dir, 'out'),
      HAS_TOKEN: 'true', HAS_DB: 'true', HAS_KEY: 'true', PRODUCTION_REF: 'ref', PRODUCTION_APP_HOST: 'host', ...env,
    },
  });
  return { status: r.status, out: r.stdout + r.stderr, ok: readFileSync(join(dir, 'out'), 'utf8').trim() };
}

describe('the ready check refuses before anything is deployed (S26-2 5 and 7)', () => {
  it('passes when everything is in place', () => {
    const r = ready(ALL_GOOD);
    expect(r.status, r.out).toBe(0);
    expect(r.ok).toBe('ok=true');
  });

  const refusals: [string, Api, Record<string, string>, RegExp][] = [
    ['no deploy key', ALL_GOOD, { HAS_KEY: 'false' }, /no LIVE_DEPLOY_KEY/],
    ['no rules on live', { ...ALL_GOOD, 'rules/branches/live': [] }, {}, /live is not protected/],
    ['only some rules on live', { ...ALL_GOOD, 'rules/branches/live': [{ type: 'deletion' }, { type: 'non_fast_forward' }] }, {}, /live is not protected/],
    ['the rules cannot be read', { ...ALL_GOOD, 'rules/branches/live': 'error' }, {}, /live is not protected/],
    ['the environment deploys from every branch', { ...ALL_GOOD, 'environments/production': { ...(ALL_GOOD['environments/production'] as object), deployment_branch_policy: null } }, {}, /from the branch main only/],
    ['the environment deploys from protected branches', { ...ALL_GOOD, 'environments/production': { ...(ALL_GOOD['environments/production'] as object), deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } } }, {}, /from the branch main only/],
    ['the environment also deploys from another branch', { ...ALL_GOOD, 'environments/production/deployment-branch-policies': { branch_policies: [{ name: 'main', type: 'branch' }, { name: 'sprint-*', type: 'branch' }] } }, {}, /from the branch main only/],
    ['the branch policies cannot be read', { ...ALL_GOOD, 'environments/production/deployment-branch-policies': 'error' }, {}, /from the branch main only/],
    ['no required reviewer', { ...ALL_GOOD, 'environments/production': { ...(ALL_GOOD['environments/production'] as object), protection_rules: [] } }, {}, /does not require a reviewer/],
    ['the environment cannot be read (security review, L1: failed open before)', { ...ALL_GOOD, 'environments/production': 'error' }, {}, /does not require a reviewer/],
    ['an older commit than live', { ...ALL_GOOD, 'compare/live...SHA': { status: 'behind' } }, {}, /not the live demo's commit or a later one/],
  ];
  for (const [what, api, env, message] of refusals) {
    it(`refuses: ${what}`, () => {
      const r = ready(api, env);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toMatch(message);
      expect(r.ok).toBe('');
    });
  }

  it('without the deploy\'s settings, says so and deploys nothing (as before Sprint 20)', () => {
    const r = ready(ALL_GOOD, { HAS_TOKEN: 'false' });
    expect(r.status).toBe(0);
    expect(r.ok).toBe('ok=false');
  });
});

describe('the push to live, run against a local stand-in for GitHub (S26-2 4; QA review L6)', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  const remote = join(work, 'github.git');
  const workspace = join(work, 'workspace');
  execFileSync('git', ['init', '-q', '--bare', remote]);
  execFileSync('git', ['init', '-q', workspace]);
  git(workspace, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'one');
  const older = git(workspace, 'rev-parse', 'HEAD');
  git(workspace, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'two');
  const newer = git(workspace, 'rev-parse', 'HEAD');
  git(workspace, 'push', '-q', remote, `${older}:refs/heads/live`);
  // What an earlier step could have planted: a hook in the checkout, and a fake git first on the PATH.
  const marker = join(work, 'planted-ran');
  writeFileSync(join(workspace, '.git', 'hooks', 'pre-push'), `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(join(workspace, '.git', 'hooks', 'pre-push'), 0o755);
  const fakeBin = mkdtempSync(join(work, 'bin-'));
  writeFileSync(join(fakeBin, 'git'), `#!/bin/sh\ntouch ${marker}\nexit 1\n`);
  chmodSync(join(fakeBin, 'git'), 0o755);

  // The step as written, pointed at the local stand-in instead of git@github.com (no SSH involved).
  const script = stepScript('Move the live branch to this commit').replace('"git@github.com:${GITHUB_REPOSITORY}.git"', `"${remote}"`);
  const run = (sha: string) => {
    const tmp = mkdtempSync(join(work, 'tmp-'));
    const r = spawnSync('bash', ['-c', script], {
      encoding: 'utf8',
      env: {
        PATH: `${fakeBin}:${process.env.PATH}`, TMPDIR: tmp, HOME: tmp, LIVE_DEPLOY_KEY: 'not-a-real-key', GITHUB_WORKSPACE: workspace, GITHUB_SHA: sha, GITHUB_REPOSITORY: 'o/r',
        // As an earlier step could set through $GITHUB_ENV: a hook path that would run the planted hook.
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: join(workspace, '.git', 'hooks'),
      },
    });
    return { status: r.status, out: r.stdout + r.stderr, left: readdirSync(tmp) };
  };

  it('moves live forward, leaves no key behind, and runs nothing planted', () => {
    expect(script).toContain('/usr/bin/git');
    const r = run(newer);
    expect(r.status, r.out).toBe(0);
    expect(git(remote, 'rev-parse', 'refs/heads/live')).toBe(newer);
    expect(r.left).toEqual([]);
    expect(existsSync(marker)).toBe(false);
  });

  it('refuses to move live back to an older commit', () => {
    const r = run(older);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/rejected|non-fast-forward/);
    expect(git(remote, 'rev-parse', 'refs/heads/live')).toBe(newer);
    expect(existsSync(marker)).toBe(false);
  });
});
