/**
 * Sprint 7, S7-6: the documentation a first-time reader sees must not drift from the code.
 * 1. Every figure in the evaluations summary appears in the report it cites.
 * 2. Every file a page links to, or names as a repository path, exists.
 * 3. British spelling and no em dashes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

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

/** The pages a first-time reader starts from. */
const PAGES = ['README.md', 'docs/ARCHITECTURE.md', 'docs/evals/README.md', 'docs/DEPLOYING.md'].filter((p) => existsSync(join(ROOT, p)));

describe('evaluations summary', () => {
  const rows = table(read('docs/evals/README.md'), 'Measure');
  it('has the figures', () => expect(rows.length).toBeGreaterThanOrEqual(10));
  it.each(rows.map((r) => [r[0], r]))('%s matches its report', (_m, r) => {
    const report = r[2].replace(/`/g, '');
    expect(read(report)).toContain(r[1]);
  });
});

describe.each(PAGES)('%s', (page) => {
  const text = read(page);
  it('links only to files that exist', () => {
    const links = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((l) => !/^(https?:|mailto:)/.test(l));
    for (const l of links) expect(existsSync(normalize(join(ROOT, dirname(page), l))), `${page} links to ${l}`).toBe(true);
  });
  it('names only repository paths that exist', () => {
    const named = [...text.matchAll(/`((?:src|supabase|eval|docs|sample-data|scripts)\/[^`*<> ]+)`/g)].map((m) => m[1]);
    for (const p of named) expect(existsSync(join(ROOT, p)), `${page} names ${p}`).toBe(true);
  });
});

/** Every Markdown page under docs/ (refinements and decisions included) and the README. */
function markdown(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(dir, f);
    return statSync(join(ROOT, p)).isDirectory() ? markdown(p) : p.endsWith('.md') ? [p] : [];
  });
}
const US = /\b(organization|organizations|color|behavior|analyze|analyzed|center|optimize|optimized|prioritize|prioritized|catalog|favor|labeled|canceled|modeling|judgment)\b/i;

describe.each(['README.md', ...markdown('docs')])('%s style', (page) => {
  const text = read(page)
    // Quoted questions from the synthetic knowledge base keep their own (American) spelling.
    .replace(/"[^"\n]*"/g, '').replace(/`[^`\n]*`/g, '');
  it('has no em dashes', () => expect(text.includes('—'), `${page} contains an em dash`).toBe(false));
  it('uses British spelling', () => expect(text.match(US)?.[0] ?? null, `${page}`).toBeNull());
});
