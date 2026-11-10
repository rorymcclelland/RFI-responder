// Sprint 27 (S27-2, F-80): every action the workflows run is fixed to the exact commit that was
// checked, with its release in a comment, so nobody can change what runs (above all in the production
// job, which holds the deploy key and the database password) by moving a tag. None of them runs on
// Node.js 20, which GitHub has retired. The production job builds without npm's cache (Rory, Q2), and
// the Supabase CLI stays at the version the project tests with.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = '.github/workflows';
const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, text: readFileSync(join(DIR, f), 'utf8') }));

/** Every `uses:` line, with its workflow and line number. */
function usesLines() {
  return workflows.flatMap(({ file, text }) => text.split('\n').flatMap((line, i) => {
    const m = /^\s*(?:-\s+)?uses:\s*(.+)$/.exec(line);
    return m ? [{ where: `${file}:${i + 1}`, value: m[1].trim() }] : [];
  }));
}

/** The actions known to run on Node.js 20, by the release they reached Node.js 24 (read from each action's action.yml, 10 November 2026). */
const NODE24_FROM: Record<string, number> = { 'actions/setup-node': 5, 'actions/upload-artifact': 6, 'actions/checkout': 5, 'supabase/setup-cli': 2, 'denoland/setup-deno': 2 };

describe('the actions the workflows run (S27-2)', () => {
  const uses = usesLines();

  it('finds the actions', () => {
    expect(uses.length).toBeGreaterThanOrEqual(17);
  });

  it.each(uses)('S27-2 1: $where is pinned to a full commit, with its release in a comment', ({ value }) => {
    expect(value).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\/[^@\s]+)?@[0-9a-f]{40}\s+#\s+v\d+(\.\d+){0,2}$/);
  });

  it.each(uses)('S27-2 2: $where is on a release that runs on Node.js 24', ({ value }) => {
    const [name] = value.split('@');
    const release = /#\s+v(\d+)/.exec(value);
    expect(NODE24_FROM[name], `${name} is not in the list of checked actions`).toBeDefined();
    expect(Number(release?.[1])).toBeGreaterThanOrEqual(NODE24_FROM[name]);
  });

  it('S27-2 1: pins each action to the same commit everywhere', () => {
    const byName = new Map<string, Set<string>>();
    for (const { value } of uses) {
      const [name, rest] = value.split('@');
      byName.set(name, (byName.get(name) ?? new Set()).add(rest));
    }
    for (const [name, pins] of byName) expect([...pins], name).toHaveLength(1);
  });

  it('S27-2 5: installs the Supabase CLI at the version the project tests with, in every job', () => {
    const cli = uses.filter((u) => u.value.startsWith('supabase/setup-cli@')).length;
    const versions = workflows.flatMap(({ text }) => [...text.matchAll(/supabase\/setup-cli@[^\n]+\n\s+with:\n\s+version:\s*(\S+)/g)].map((m) => m[1]));
    expect(versions).toHaveLength(cli);
    expect(new Set(versions)).toEqual(new Set(['2.121.0']));
  });
});

describe('the production job builds without a cache (Rory, Q2)', () => {
  const deploy = workflows.find((w) => w.file === 'deploy.yml')!.text;
  const lines = deploy.split('\n');
  const start = lines.findIndex((l) => l === '  production:');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) { end = i; break; }
  const job = lines.slice(start, end).join('\n');

  it('finds the production job', () => {
    expect(start).toBeGreaterThan(0);
    expect(job).toMatch(/actions\/setup-node@/);
  });

  it('S27-2 4: turns setup-node\'s cache off and asks for none', () => {
    expect(job).not.toMatch(/^\s+cache:/m);
    const step = job.slice(job.indexOf('actions/setup-node@')).split(/\n\s+- /)[0];
    expect(step).toMatch(/^\s+package-manager-cache:\s*false\s*$/m);
  });
});
