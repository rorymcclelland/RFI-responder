/**
 * Rory, 9 November 2026: each case on the sprint review page opens to show how to check it again.
 * Worked out from the code itself, so the steps cannot drift from what is really tested:
 * - a browser test: the command that runs that one test, and its steps as the test captions them
 *   (the same captions shown in the recording);
 * - a check in CI: for each test file the case names, the command that runs it, narrowed to the tests
 *   whose names carry the case's id when there are any, and those tests' names;
 * - by hand: the steps written beside the case in e2e/cases.ts, or why it is by hand.
 */
import { existsSync, readFileSync } from 'node:fs';
import type { Case } from '../e2e/cases';

export interface Reproduce {
  /** Commands, run in the repository's folder after the set-up on the page. */
  commands: string[];
  /** What happens, or what to do, in order. */
  steps: string[];
  /** Said when nothing more specific can be given. */
  note?: string;
}

/** The set-up every command assumes, shown once at the top of the page. */
export const SETUP: { title: string; lines: string[] }[] = [
  { title: 'Once', lines: [
    'In PowerShell, in C:\\Code\\rfi-responder, on the sprint\'s branch: npm install -g npm@11, then npm ci.',
    'For browser tests, once: npx playwright install chromium.',
  ] },
  { title: 'Database and browser tests', lines: [
    'Start Docker Desktop, then npx supabase start (the local Supabase stack).',
    'For database tests, point them at its database: $env:DB_TEST_URL = \'postgres://postgres:postgres@127.0.0.1:54322/postgres\'. They make, and drop, their own database called rfi_test there.',
    'For browser tests, reset the demo data first: npm run db:reset (the tests change it). Playwright starts the app itself.',
  ] },
];

type Read = (path: string) => string | null;
const readRepo: Read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** The strings of every describe(...) and it(...) in a test file, in order. */
export function testNames(source: string): string[] {
  const out: string[] = [];
  const re = /\b(?:describe|it|test)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (let m = re.exec(source); m; m = re.exec(source)) out.push(m[2].replace(/\\(['"`\\])/g, '$1'));
  return out;
}

/** The captions of one browser test, in order: caption(page, '…') calls inside its test(...) block. */
export function captions(source: string, title: string): string[] {
  const start = source.indexOf(`test('${title.replace(/'/g, "\\'")}'`);
  if (start < 0) return [];
  const next = source.indexOf('\ntest(', start + 1);
  const block = source.slice(start, next < 0 ? undefined : next);
  const out: string[] = [];
  const re = /caption\(\s*\w+\s*,\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  for (let m = re.exec(block); m; m = re.exec(block)) out.push(m[2].replace(/\\(['"`\\])/g, '$1').replace(/\$\{([^}]*)\}/g, '…'));
  return out;
}

const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
const regexSafe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** How to check a case again. `tests` maps each browser test's title to its spec file (e2e/...). */
export function reproduce(c: Case, tests: { title: string; file?: string }[], read: Read = readRepo): Reproduce {
  if (c.how.kind === 'hand') {
    return c.steps?.length ? { commands: [], steps: c.steps } : { commands: [], steps: [], note: c.how.why };
  }
  if (c.how.kind === 'suite') {
    return { commands: ['npm run test:e2e'], steps: ['Runs every browser test; the case passes when they all pass.'] };
  }
  if (c.how.kind === 'browser') {
    const mine = tests.filter((t) => t.file);
    if (!mine.length) return { commands: [], steps: [], note: 'No browser test in these runs names this case.' };
    const seen = new Set<string>();
    const commands: string[] = [];
    const steps: string[] = [];
    for (const t of mine) {
      if (seen.has(t.title)) continue;
      seen.add(t.title);
      commands.push(`npm run test:e2e -- e2e/${t.file} -g ${quote(`^${regexSafe(t.title)}$`)}`);
      const src = read(`e2e/${t.file}`);
      steps.push(...(src ? captions(src, t.title) : []));
    }
    return { commands, steps: [...new Set(steps)] };
  }
  // A check in CI: the test files the case names, each narrowed to the tests carrying its id.
  const files = [...new Set(c.how.by.match(/(?:src|scripts|supabase\/tests|docs|e2e)\/[\w./-]+\.test\.ts/g) ?? [])];
  if (!files.length) return { commands: [], steps: [], note: c.how.by };
  const commands: string[] = [];
  const steps: string[] = [];
  for (const f of files) {
    const db = f.startsWith('supabase/tests/db/');
    const src = read(f);
    const named = src ? testNames(src).filter((n) => n.includes(c.id)) : [];
    const filter = named.length ? ` -t ${quote(c.id)}` : '';
    commands.push(`${db ? 'npm run test:db' : 'npm test'} -- ${f}${filter}`);
    if (named.length) steps.push(...named.map((n) => `${f.split('/').pop()}: ${n}`));
    else steps.push(`${f.split('/').pop()}: the whole file (no test in it names ${c.id}).`);
  }
  return { commands, steps, ...(files.length ? {} : { note: c.how.by }) };
}
