// Sprint 12, S12-4: the Japanese entries and the corpus variant (test numbers from docs/refinement/sprint-12.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadKb, ROOT } from './lib';
import { japaneseRef, languagesReport, loadJapaneseEntries, mixedCorpus, pairOf, PAIRS, parseJapaneseEntries, textLanguage } from './languages';

interface Item { id: string; text: string; language: 'en' | 'ja'; kind: string; gold: string; split: string }
const set = JSON.parse(readFileSync(join(ROOT, 'eval/retrieval-set.json'), 'utf8')) as { items: Item[] };
const kb = loadKb();
const ja = loadJapaneseEntries();
const corpus = mixedCorpus(kb, ja);

describe('S12-4 Japanese entries', () => {
  it('1. has 30 entries, each matching an English entry by number, each detected as Japanese', () => {
    expect(ja).toHaveLength(30);
    expect(new Set(ja.map((e) => e.number)).size).toBe(30);
    for (const e of ja) {
      expect(Number.isInteger(e.number) && e.number >= 1 && e.number <= kb.length, `number ${e.number}`).toBe(true);
      expect(textLanguage(e.question, e.answer), e.question).toBe('ja');
      expect(e.answer.length).toBeGreaterThan(50);
    }
  });

  it('1. keeps every figure of its English original (the drafts are checked against their sources)', () => {
    const figures = (s: string) => (s.match(/\d+(?:[.-]\d+)*/g) ?? []).sort();
    for (const e of ja) expect(figures(e.answer), `entry ${e.number}`).toEqual(expect.arrayContaining(figures(kb[e.number - 1].answer).filter((f) => !/^\d+$/.test(f) || Number(f) > 3)));
  });

  it('1. is spread across both halves of the evaluation set', () => {
    const calibrate = ja.filter((e) => (e.number - 1) % 2 === 0).length;
    expect(calibrate).toBeGreaterThanOrEqual(10);
    expect(30 - calibrate).toBeGreaterThanOrEqual(10);
  });

  it('the TypeScript language rule says what the database rule says', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/20261031100000_entry_language.sql'), 'utf8');
    expect(sql).toContain("question ~ '[ぁ-ヿ一-鿿]'");
    expect(sql).toMatch(/\* 5 >= greatest\(length\(answer\), 1\)/);
    expect(textLanguage('How?', 'An answer naming 東京 once, in an otherwise English sentence.')).toBe('en');
    expect(textLanguage('How?', '日本語の回答です。')).toBe('ja');
    expect(textLanguage('どう？', 'x')).toBe('ja');
  });

  it('stops on a row whose number is missing or out of range, rather than mismatching it', () => {
    for (const n of ['', '0', '101', '1.5', 'x']) expect(() => parseJapaneseEntries(`number,question,answer,tags,source\n${n},質問,回答,,\n`)).toThrow(/not an entry number/);
  });
});

describe('S12-4 corpus variant', () => {
  it('2. replaces exactly the 30 entries, keeping their gold labels and giving them the demo refs', () => {
    expect(corpus).toHaveLength(kb.length);
    expect(corpus.filter((e) => e.language === 'ja')).toHaveLength(30);
    ja.forEach((e, k) => {
      const c = corpus[e.number - 1];
      expect(c.id).toBe(kb[e.number - 1].question);
      expect(c.question).toBe(e.question);
      expect(c.ref).toBe(japaneseRef(k));
    });
    expect(new Set(corpus.map((e) => e.ref)).size).toBe(corpus.length);
  });

  it('2. has the right answer of every answerable item, and produces all four pairs', () => {
    const ids = new Set(corpus.map((e) => e.id));
    const answerable = set.items.filter((i) => i.gold);
    for (const i of answerable) expect(ids.has(i.gold), i.id).toBe(true);
    const counts = Object.fromEntries(PAIRS.map((p) => [p, answerable.filter((i) => pairOf(i, corpus) === p).length]));
    expect(counts).toEqual({ 'English to English': 140, 'Japanese to English': 70, 'English to Japanese': 60, 'Japanese to Japanese': 30 });
    for (const i of set.items.filter((x) => !x.gold)) expect(pairOf(i, corpus)).toBeNull();
  });
});

describe('S12-4 report', () => {
  const wilson = () => ({ low: 0.5, high: 0.9 });
  const ece = () => 0.05;
  const row = (over: Partial<import('./languages').LanguageRow>): import('./languages').LanguageRow =>
    ({ id: 'x', language: 'en', kind: 'paraphrase', pair: 'English to English', goldRank: 1, confidence: 0.9, topIsGold: true, ...over });
  const good = [
    ...Array.from({ length: 10 }, () => row({})),
    ...Array.from({ length: 10 }, () => row({ pair: 'English to Japanese' })),
    ...Array.from({ length: 10 }, () => row({ language: 'ja', kind: 'translation', pair: 'Japanese to Japanese' })),
    ...Array.from({ length: 5 }, () => row({ kind: 'near-miss', pair: null, goldRank: null, confidence: 0.1, topIsGold: false })),
  ];
  const report = (rows: import('./languages').LanguageRow[]) => languagesReport({ date: 'D', setVersion: 'V', method: 'M', rows, wilson, ece });

  it('3. gives recall@5 per pair with an interval, and says the Japanese items are unreviewed', () => {
    const { markdown, met } = report(good);
    expect(met).toBe(true);
    expect(markdown).toContain('| English to Japanese | 10 | 100.0% | 50.0% to 90.0% | 100.0% | 1.000 |');
    expect(markdown).toContain('| Japanese to English | 0 | n/a | n/a |');
    expect(markdown).toMatch(/machine translations written by Claude, unreviewed/);
  });

  it('4. reports a shortfall, never hides it: recall below the bar', () => {
    const rows = good.map((r) => (r.pair === 'Japanese to Japanese' ? { ...r, goldRank: 6 } : r));
    const { markdown, met } = report(rows);
    expect(met).toBe(false);
    expect(markdown).toContain('| Japanese to Japanese recall@5 at least 80.0% | 0.0% | no |');
    expect(markdown).toContain('**A bar is not met.**');
  });

  it('4. reports a shortfall: a near miss at the bulk line', () => {
    const rows = [...good, row({ kind: 'near-miss', language: 'ja', pair: null, goldRank: null, confidence: 0.85, topIsGold: false })];
    const { markdown, met } = report(rows);
    expect(met).toBe(false);
    expect(markdown).toContain('| No near miss at or above the 80.0% bulk line | 1 of 6 | no |');
    expect(markdown).toContain('| Japanese | 1 | 1 of 1 |');
  });

  it('4. a pair with no questions, or no near misses checked, never counts as met', () => {
    expect(report(good.filter((r) => r.pair !== 'English to Japanese')).met).toBe(false);
    expect(report(good.filter((r) => r.kind !== 'near-miss')).met).toBe(false);
  });

  it('counts unreadable checks and leaves them out of the calibration', () => {
    const { markdown } = report([...good, row({ confidence: null, unreadable: true })]);
    expect(markdown).toContain('Checks unreadable after one retry: 1');
    expect(markdown).toContain('| English to English | 10 | 10 | 10 of 10 | 0.050 |');
  });
});
