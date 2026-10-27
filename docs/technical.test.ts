/**
 * Sprint 10, S10-3: the technical reference must cover the code, and the code must not outgrow it.
 * 1. Every environment variable the code reads is in the configuration reference, and every one
 *    listed there is read somewhere.
 * 2. Every table, view and function the migrations create (and do not drop) is in the data model page.
 * 3. Every Edge Function is documented, and every npm script is in the developer guide.
 * (Links, paths, spelling and em dashes are checked for these pages by docs.test.ts.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : files(p, test);
    return test(e.name) ? [p] : [];
  });
}

/** Every environment variable the code reads, however it reads it. */
function variablesInCode(): Set<string> {
  const code = ['src', 'supabase/functions', 'supabase/tests', 'eval', 'scripts']
    .flatMap((d) => files(d, (n) => /\.(ts|tsx|mjs)$/.test(n) && !/\.test\./.test(n)))
    .map(read)
    .join('\n');
  const found = new Set<string>();
  const patterns = [
    /\benv\??\.([A-Z][A-Z0-9_]+)/g, // env.X, process.env.X, import.meta.env.X
    /\benv\[['"]([A-Z][A-Z0-9_]+)['"]\]/g,
    /Deno\.env\.get\(['"]([A-Z][A-Z0-9_]+)['"]\)/g,
    /REQUIRED_SETTINGS = \[([^\]]+)\]/g, // the app's settings, read through readConfig
  ];
  for (const p of patterns) {
    for (const m of code.matchAll(p)) for (const name of m[1].match(/[A-Z][A-Z0-9_]+/g) ?? []) found.add(name);
  }
  return found;
}

describe('docs/technical/CONFIGURATION.md', () => {
  const page = read('docs/technical/CONFIGURATION.md');
  const documented = new Set([...page.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]));
  const inCode = variablesInCode();

  it('finds the variables (the extraction works)', () => {
    for (const v of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'APP_ORIGIN', 'DB_TEST_URL', 'EXTRACT_MODEL']) expect(inCode, v).toContain(v);
  });
  it('lists every environment variable the code reads', () => {
    for (const v of inCode) expect(documented, `${v} is read but not documented`).toContain(v);
  });
  it('lists only variables the code reads', () => {
    for (const v of documented) expect(inCode, `${v} is documented but never read`).toContain(v);
  });
  it('lists every database setting', () => {
    const migrations = files('supabase/migrations', (n) => n.endsWith('.sql')).sort().map(read).join('\n');
    const added = [...migrations.matchAll(/\b(daily_\w+_cap|monthly_budget_gbp|alert_share|gbp_per_usd|est_usd_per_\w+|review_interval_months)\b\s+(int|numeric)/g)].map((m) => m[1]);
    const dropped = [...migrations.matchAll(/DROP COLUMN (\w+)/g)].map((m) => m[1]);
    const settings = new Set(added.filter((c) => !dropped.includes(c)));
    expect(settings.size).toBeGreaterThanOrEqual(10);
    for (const s of settings) expect(page, s).toContain(`| \`${s}\` |`);
  });
});

describe('docs/technical/DATA-MODEL.md', () => {
  const page = read('docs/technical/DATA-MODEL.md');
  const sql = files('supabase/migrations', (n) => n.endsWith('.sql')).sort().map(read).join('\n')
    .replace(/--[^\n]*/g, '');

  /** Names created and not dropped afterwards: the last statement about each name decides. */
  function live(kind: string): string[] {
    const last = new Map<string, 'create' | 'drop'>();
    const re = new RegExp(`(CREATE (?:OR REPLACE )?${kind} (?:IF NOT EXISTS )?|DROP ${kind} (?:IF EXISTS )?)(?:(?:public|private|access)\\.)?(\\w+)`, 'gi');
    for (const m of sql.matchAll(re)) last.set(m[2], m[1].toUpperCase().startsWith('DROP') ? 'drop' : 'create');
    return [...last].filter(([, v]) => v === 'create').map(([k]) => k);
  }

  for (const kind of ['TABLE', 'VIEW', 'FUNCTION']) {
    it(`documents every ${kind.toLowerCase()} the migrations leave in place`, () => {
      const names = live(kind);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(page, `${kind} ${n}`).toMatch(new RegExp(`\`(?:public\\.|private\\.|access\\.)?${n}\\b`));
    });
  }
});

describe('docs/technical/EDGE-FUNCTIONS.md', () => {
  it('documents every Edge Function', () => {
    const page = read('docs/technical/EDGE-FUNCTIONS.md');
    const fns = readdirSync(join(ROOT, 'supabase/functions'), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name);
    expect(fns.length).toBeGreaterThanOrEqual(4);
    for (const f of fns) expect(page, f).toMatch(new RegExp(`^## ${f}$`, 'm'));
  });
});

describe('docs/technical/DEVELOPMENT.md', () => {
  it('lists every npm script', () => {
    const page = read('docs/technical/DEVELOPMENT.md');
    const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);
    for (const s of scripts) expect(page, s).toContain(s === 'test' ? '`npm test`' : `\`npm run ${s}\``);
  });
});
