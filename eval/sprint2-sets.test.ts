/**
 * Validates the Sprint 2 evaluation sets (story S2-0): counts, fields, and that labels
 * point at real knowledge-base entries. Runs on every change, like retrieval-set.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

const here = (p: string) => join(__dirname, p);
const load = (p: string) => JSON.parse(readFileSync(here(p), 'utf8'));
const kb = Papa.parse<Record<string, string>>(readFileSync(here('../sample-data/security-qa.csv'), 'utf8'), {
  header: true,
  skipEmptyLines: true,
}).data;
const kbQuestions = new Set(kb.map((r) => r.question));
const answerOf = (q: string) => kb.find((r) => r.question === q)?.answer ?? '';

describe('gate set', () => {
  const set = load('gate-set.json');
  const count = (c: string, lang?: string) =>
    set.items.filter((i: { category: string; language: string }) => i.category === c && (!lang || i.language === lang)).length;

  it('1. has enough pricing, legal and lookalike questions, in both languages', () => {
    expect(count('pricing')).toBeGreaterThanOrEqual(40);
    expect(count('legal')).toBeGreaterThanOrEqual(40);
    expect(count('none')).toBeGreaterThanOrEqual(60);
    for (const c of ['pricing', 'legal', 'none']) expect(count(c, 'ja')).toBeGreaterThanOrEqual(5);
  });

  it('2. every item has a category and a one-line reason; ids are unique', () => {
    const ids = new Set();
    for (const i of set.items) {
      expect(['pricing', 'legal', 'none']).toContain(i.category);
      expect(i.reason.length).toBeGreaterThan(3);
      expect(i.reason).not.toContain('\n');
      expect(ids.has(i.id)).toBe(false);
      ids.add(i.id);
    }
  });
});

describe('drafting labels', () => {
  const set = load('drafting-labels.json');
  const kinds = (k: string) => set.items.filter((i: { kind: string }) => i.kind === k).length;

  it('covers the 40 sample questions, 20 near misses and 10 Japanese questions', () => {
    expect(kinds('sample') + kinds('near-miss')).toBe(60);
    expect(kinds('near-miss')).toBeGreaterThanOrEqual(20);
    expect(kinds('translation')).toBe(10);
  });

  it('every gold label is a real entry, and every must-include fact appears in a gold entry', () => {
    for (const i of set.items) {
      for (const g of i.gold) expect(kbQuestions.has(g)).toBe(true);
      for (const f of i.mustInclude) {
        expect(i.gold.some((g: string) => answerOf(g).toLowerCase().includes(f.toLowerCase()))).toBe(true);
      }
      expect(i.kind === 'near-miss' ? i.gold.length === 0 : i.gold.length > 0).toBe(true);
    }
  });
});

describe('red-team set', () => {
  const set = load('redteam-set.json');

  it('3. has at least 30 injected questions, each with a clean twin, and six injected entries (five until Sprint 12)', () => {
    expect(set.questions.length).toBeGreaterThanOrEqual(30);
    for (const q of set.questions) {
      expect(q.clean.length).toBeGreaterThan(5);
      expect(q.injected).not.toBe(q.clean);
      expect(q.injected.length).toBeGreaterThan(q.clean.length);
    }
    expect(set.kbEntries.length).toBe(6); // Sprint 12: k006, a Japanese entry
    expect(set.questions.filter((q: { language: string }) => q.language === 'ja').length).toBeGreaterThanOrEqual(5);
  });

  it('4. links and addresses use the reserved .invalid domain, so nothing real is referenced', () => {
    const text = JSON.stringify(set);
    for (const url of text.match(/https?:\/\/[^\s"\\]+/g) ?? []) expect(url).toMatch(/\.invalid/);
    for (const mail of text.match(/[\w.-]+@[\w.-]+/g) ?? []) expect(mail).toMatch(/\.invalid$/);
  });
});
