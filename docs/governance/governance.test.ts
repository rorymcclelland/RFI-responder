/**
 * Sprint 4, S4-5: the governance pack must not drift from the code (project rule 1).
 * 1. Every risk names test files, and they exist.
 * 2. Every evaluation figure in the model card appears in the report it cites.
 * 3. Every provider claim has a source link and the date it was checked.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Rows of the first markdown table whose header starts with `firstHeader`. */
function table(markdown: string, firstHeader: string): string[][] {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`| ${firstHeader} |`));
  if (start < 0) throw new Error(`No table starting with ${firstHeader}`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
  }
  return rows;
}
const paths = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe('risk register', () => {
  const rows = table(read('docs/governance/RISK-REGISTER.md'), 'ID');

  it('has risks', () => expect(rows.length).toBeGreaterThanOrEqual(10));

  it.each(rows.map((r) => [r[0], r]))('%s names test files that exist', (_id, r) => {
    const tests = paths(r[5]);
    expect(tests.length).toBeGreaterThan(0);
    for (const t of tests) expect(existsSync(join(ROOT, t)), `${t} is missing`).toBe(true);
  });

  it('planned controls say so, and every residual is stated', () => {
    for (const r of rows) {
      expect(r[6].length, `${r[0]} has no residual`).toBeGreaterThan(0);
      if (/planned/i.test(r[4])) expect(r[4]).toMatch(/\*\*planned\*\*/);
    }
  });
});

describe('model card', () => {
  const rows = table(read('docs/governance/MODEL-CARD.md'), 'Measure');

  it.each(rows.map((r) => [r[0], r]))('%s matches its report', (_measure, r) => {
    const [report] = paths(r[2]);
    expect(read(report)).toContain(r[1]);
  });
});

describe('providers', () => {
  const md = read('docs/governance/PROVIDERS.md');
  const rows = [...table(md, 'Provider'), ...table(md.slice(md.indexOf('## Prices')), 'Provider')];

  it.each(rows.map((r) => [`${r[0]}: ${r[1].slice(0, 40)}`, r]))('%s has a source and a date', (_c, r) => {
    expect(r[2]).toMatch(/^https:\/\//);
    expect(r[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('the prices in the database migration match this page', () => {
    const migration = read('supabase/migrations/20261024110000_usage_and_caps.sql');
    expect(migration).toContain("('anthropic', 'claude-haiku-5-5', 0.10, 0.50, '2026-10-23'");
    expect(migration).toContain("('voyage', 'voyage-4', 0.06, 0, '2026-10-23'");
    expect(md).toMatch(/Claude Haiku 5.5: \$0\.10 input.*\$0\.50 output/);
    expect(md).toMatch(/voyage-4: \$0\.06/);
  });
});
