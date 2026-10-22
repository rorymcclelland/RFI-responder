// Sprint 1, story S1-1: the evaluation set is well formed (test numbers from docs/refinement/sprint-1.md).
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';

interface Item { id: string; text: string; language: 'en' | 'ja'; kind: string; gold: string; review: string; split: string }
const set = JSON.parse(readFileSync(new URL('./retrieval-set.json', import.meta.url), 'utf8')) as { version: string; items: Item[] };
const kb = Papa.parse<Record<string, string>>(
  readFileSync(new URL('../sample-data/security-qa.csv', import.meta.url), 'utf8'), { header: true, skipEmptyLines: true },
).data.map((r) => r.question);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9぀-ヿ一-鿿]+/g, ' ').trim();

describe('retrieval evaluation set (S1-1)', () => {
  it('1. has 200 English paraphrases, 100 Japanese items and at least 30 unanswerable questions', () => {
    const count = (f: (i: Item) => boolean) => set.items.filter(f).length;
    expect(count((i) => i.kind === 'paraphrase' && i.language === 'en')).toBe(200);
    expect(count((i) => i.kind === 'translation' && i.language === 'ja')).toBe(100);
    expect(count((i) => i.kind === 'unanswerable')).toBeGreaterThanOrEqual(30);
  });

  it('1. every gold answer is a question in the knowledge base, and each entry is covered three times', () => {
    const answerable = set.items.filter((i) => i.kind !== 'unanswerable');
    for (const i of answerable) expect(kb).toContain(i.gold);
    for (const q of kb) expect(answerable.filter((i) => i.gold === q)).toHaveLength(3);
    for (const i of set.items.filter((x) => x.kind === 'unanswerable')) expect(i.gold).toBe('');
  });

  it('2. no paraphrase repeats its gold question word for word', () => {
    for (const i of set.items.filter((x) => x.kind === 'paraphrase')) expect(norm(i.text)).not.toBe(norm(i.gold));
  });

  it('3. no entry appears in both splits', () => {
    const splitOf = new Map<string, Set<string>>();
    for (const i of set.items.filter((x) => x.gold)) {
      if (!splitOf.has(i.gold)) splitOf.set(i.gold, new Set());
      splitOf.get(i.gold)!.add(i.split);
    }
    for (const s of splitOf.values()) expect(s.size).toBe(1);
    expect(new Set(set.items.map((i) => i.split))).toEqual(new Set(['calibrate', 'test']));
  });

  it('marks every Japanese item unreviewed, and ids are unique', () => {
    for (const i of set.items.filter((x) => x.language === 'ja')) expect(i.review).toBe('unreviewed');
    expect(new Set(set.items.map((i) => i.id)).size).toBe(set.items.length);
  });
});
