/**
 * Sprint 7, S7-6: the documentation a first-time reader sees must not drift from the code.
 * 1. Every figure in the evaluations summary is the figure in its own row and column of the report it
 *    cites (security review, Sprint 7: appearing anywhere in the report was too weak a check).
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

/** Every table in a report: its header and rows. */
function tables(markdown: string): { header: string[]; rows: string[][] }[] {
  const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim());
  const lines = markdown.split('\n');
  const out: { header: string[]; rows: string[][] }[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith('|') || !/^\|\s*-/.test(lines[i + 1]) || (i > 0 && lines[i - 1].startsWith('|'))) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) rows.push(cells(lines[j]));
    out.push({ header: cells(lines[i]), rows });
  }
  return out;
}

/** Where each summary figure lives in its report: the row's leading cells, and the column's header. */
const WHERE: Record<string, { row: string[]; column: string }> = {
  'Retrieval, English recall@5 (voyage-4)': { row: ['voyage-4'], column: 'EN recall@5' },
  'Retrieval, Japanese-to-English recall@5 (voyage-4)': { row: ['voyage-4'], column: 'JA recall@5' },
  'Checker, separating near misses from answerable questions (AUROC, voyage-4 + checker)': { row: ['voyage-4 + claude-haiku-5-5'], column: 'AUROC, near misses' },
  'Checker replies unreadable after one retry': { row: ['voyage-4 + claude-haiku-5-5'], column: 'Unreadable checks after one retry' },
  'Calibration error, voyage-4 + checker (test split)': { row: ['voyage-4 + claude-haiku-5-5'], column: 'Calibration error (test)' },
  'Near misses at or above the 80% bulk line': { row: ['voyage-4 + claude-haiku-5-5'], column: 'Near misses at or above 80% (all)' },
  'Checker verdict changed across five runs (test split)': { row: ['Verdict changed between runs'], column: 'All' },
  'Questions whose confidence crossed the 80% bulk line across five runs': { row: ['Crossed the 80% bulk line'], column: 'All' },
  'Pricing and legal questions gated (rules and classifier)': { row: ['all', 'combined'], column: 'Pricing and legal gated' },
  'Lookalike questions wrongly gated': { row: ['all', 'combined'], column: 'Lookalikes wrongly gated' },
  'Faithfulness of drafts (claims supported by the cited entries)': { row: ['Faithfulness (claims supported by cited entries)'], column: 'Result' },
  'Right entry cited': { row: ['Right entry cited (answerable questions)'], column: 'Result' },
  'Near misses given no draft': { row: ['Near misses with no draft ("insufficient evidence")'], column: 'Result' },
  'Wrong supersessions at the learning threshold (voyage-4, 0.55)': { row: ['voyage-4', '0.55'], column: 'Wrong supersessions' },
  'Word extraction recall, synthetic documents': { row: ['Recall (clean documents)'], column: 'Result' },
  'Word extraction precision, synthetic documents': { row: ['Precision (clean documents)'], column: 'Result' },
  'Red-team Word documents that changed the result': { row: ['Red-team documents that changed the result'], column: 'Result' },
};

describe('evaluations summary', () => {
  const rows = table(read('docs/evals/README.md'), 'Measure');
  it('has the figures, each with its place in the report', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.map((r) => r[0]).sort()).toEqual(Object.keys(WHERE).sort());
  });
  it.each(rows.map((r) => [r[0], r]))('%s is the figure in its row and column of the report', (measure, r) => {
    const { row, column } = WHERE[measure as string];
    const found = tables(read(r[2].replace(/`/g, ''))).flatMap((t) => {
      const col = t.header.indexOf(column);
      return col < 0 ? [] : t.rows.filter((cells) => row.every((c, i) => cells[i] === c)).map((cells) => cells[col]);
    });
    expect(found.length, `no row ${row.join(' | ')} under "${column}"`).toBeGreaterThan(0);
    expect(found[0]).toBe(r[1]);
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
