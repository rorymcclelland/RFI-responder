/**
 * Sprint 12 (S12-4, C-1): the Japanese corpus variant. Thirty of the 100 synthetic entries also exist
 * in Japanese (sample-data/security-qa-ja.csv, written by Claude, machine-translated and unreviewed).
 * In the variant, those 30 entries are replaced by their Japanese versions, so the same evaluation
 * questions measure four language pairs: English and Japanese questions against English entries (as
 * since Sprint 1) and against Japanese ones (new).
 *
 * A Japanese entry keeps its English original's gold label (the English question text), so every item
 * in the evaluation set still has its right answer in the variant, and gets the ref the demo seed gives
 * it (KB-0101 onwards, in file order), so checker caches never mix it up with its English original.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import type { KnowledgeEntry } from '../src/types';
import { ROOT } from './lib';

import type { Language } from '../supabase/functions/_shared/sources';
export type { Language };
export interface JapaneseEntry { number: number; question: string; answer: string; tags: string[]; source: string }
export type CorpusEntry = KnowledgeEntry & { ref: string; language: Language };

/** The one language rule, shared with the app and the database (a test checks the SQL says the same). */
export { textLanguage } from '../supabase/functions/_shared/sources';

/** An English entry's number (1 to 100); anything else stops the run rather than mismatching silently. */
function entryNumber(raw: string | undefined, row: number): number {
  const n = /^\d+$/.test(raw?.trim() ?? '') ? Number(raw) : Number.NaN;
  if (!(n >= 1 && n <= 100)) throw new Error(`security-qa-ja.csv row ${row + 2}: "${raw ?? ''}" is not an entry number from 1 to 100`);
  return n;
}

export function parseJapaneseEntries(csv: string): JapaneseEntry[] {
  return Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data.map((r, i) => ({
    number: entryNumber(r.number, i),
    question: r.question,
    answer: r.answer,
    tags: (r.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    source: r.source ?? '',
  }));
}

export function loadJapaneseEntries(): JapaneseEntry[] {
  return parseJapaneseEntries(readFileSync(join(ROOT, 'sample-data/security-qa-ja.csv'), 'utf8'));
}

/** The ref the demo seed gives the k-th Japanese entry (0-based): after the 100 English ones. */
export const japaneseRef = (k: number) => `KB-${String(101 + k).padStart(4, '0')}`;

/** The knowledge base with each Japanese entry in place of its English original. */
export function mixedCorpus(kb: (KnowledgeEntry & { ref: string })[], ja: JapaneseEntry[]): CorpusEntry[] {
  const byNumber = new Map(ja.map((e, k) => [e.number, { e, k }]));
  return kb.map((entry, i) => {
    const hit = byNumber.get(i + 1);
    if (!hit) return { ...entry, language: 'en' as const };
    return { ...entry, ref: japaneseRef(hit.k), question: hit.e.question, answer: hit.e.answer, tags: hit.e.tags, source: hit.e.source, language: 'ja' as const };
  });
}

const NAME: Record<Language, string> = { en: 'English', ja: 'Japanese' };
export const PAIRS = ['English to English', 'Japanese to English', 'English to Japanese', 'Japanese to Japanese'] as const;
export type Pair = (typeof PAIRS)[number];

/** The language pair an answerable item measures in the variant; null for questions with no right answer. */
export function pairOf(item: { language: string; gold: string }, corpus: CorpusEntry[]): Pair | null {
  if (!item.gold) return null;
  const entry = corpus.find((e) => e.id === item.gold);
  if (!entry) throw new Error(`No entry in the corpus variant for "${item.gold}"`);
  return `${NAME[item.language as Language]} to ${NAME[entry.language]}` as Pair;
}

// ─── The report ─────────────────────────────────────────────────────────────

/** One evaluation item in the variant: where retrieval put the right entry, and what the checker said. */
export interface LanguageRow {
  id: string;
  language: string;
  kind: string;
  pair: Pair | null;
  /** 1-based rank of the right entry by voyage-4 similarity, or null (also for items with no right answer). */
  goldRank: number | null;
  /** The app's calibrated confidence from the checker's verdict; null when there was no readable check. */
  confidence: number | null;
  /** The checker ran but its reply was unreadable after one retry. */
  unreadable?: boolean;
  topIsGold: boolean;
}

/** Bars agreed with Rory for Sprint 12 (Q4): Sprint 1's Japanese bar, and the bulk-line safety bar. */
export const LANGUAGE_BARS = { recall5: 0.8, nearAtBulk: 0, bulkLine: 0.8 } as const;
const BARRED: Pair[] = ['English to Japanese', 'Japanese to Japanese'];

type Interval = { low: number; high: number };
export interface ReportInputs {
  date: string;
  setVersion: string;
  method: string;
  rows: LanguageRow[];
  /** Wilson interval, passed in so this module stays free of the statistics code. */
  wilson: (k: number, n: number) => Interval;
  ece: (items: { p: number; correct: boolean }[]) => number;
  notes?: string[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const share = (k: number, n: number) => (n ? pct(k / n) : 'n/a');
const range = (i: Interval) => `${pct(i.low)} to ${pct(i.high)}`;

/** The language report: recall per pair, the checker with the app's calibration per pair, near misses, and the bars. */
export function languagesReport(x: ReportInputs): { markdown: string; met: boolean } {
  const retrieval = PAIRS.map((pair) => {
    const items = x.rows.filter((r) => r.pair === pair);
    const at = (k: number) => items.filter((r) => r.goldRank !== null && r.goldRank <= k).length;
    const mrr = items.length ? items.reduce((a, r) => a + (r.goldRank ? 1 / r.goldRank : 0), 0) / items.length : 0;
    return { pair, n: items.length, k5: at(5), k1: at(1), mrr };
  });
  const checked = x.rows.filter((r) => r.confidence !== null);
  const calibration = PAIRS.map((pair) => {
    const items = checked.filter((r) => r.pair === pair);
    const right = items.filter((r) => r.topIsGold);
    return {
      pair, n: items.length, right: right.length,
      rightOver: right.filter((r) => r.confidence! >= LANGUAGE_BARS.bulkLine).length,
      ece: items.length ? x.ece(items.map((r) => ({ p: r.confidence!, correct: r.topIsGold }))) : Number.NaN,
    };
  });
  const near = (lang?: string) => checked.filter((r) => r.kind === 'near-miss' && (!lang || r.language === lang));
  const nearRows = [['English', near('en')], ['Japanese', near('ja')], ['All', near()]] as const;
  const unreadable = x.rows.filter((r) => r.unreadable).length;
  const nearOver = near().filter((r) => r.confidence! >= LANGUAGE_BARS.bulkLine).length;
  const nearUnreadable = x.rows.filter((r) => r.kind === 'near-miss' && r.unreadable).length;

  const bars = [
    ...BARRED.map((pair) => {
      const r = retrieval.find((y) => y.pair === pair)!;
      return { bar: `${pair} recall@5 at least ${pct(LANGUAGE_BARS.recall5)}`, result: share(r.k5, r.n), met: r.n > 0 && r.k5 / r.n >= LANGUAGE_BARS.recall5 };
    }),
    { bar: `No near miss at or above the ${pct(LANGUAGE_BARS.bulkLine)} bulk line`, result: `${nearOver} of ${near().length}`, met: near().length > 0 && nearOver <= LANGUAGE_BARS.nearAtBulk },
  ];
  const met = bars.every((b) => b.met);

  const md = [
    `# Languages, ${x.date}`,
    '',
    `Evaluation set ${x.setVersion}, against the Japanese corpus variant: the 100 synthetic entries with 30 of them replaced by their Japanese versions (\`sample-data/security-qa-ja.csv\`). **The Japanese entries and the Japanese questions are machine translations written by Claude, unreviewed by a native reader (F-14), so every Japanese figure is indicative.** Generated by \`npm run eval:languages\`. Intervals are 95% Wilson intervals over questions; they cover sample size only.`,
    '',
    '## Retrieval (voyage-4)',
    '',
    '| Pair | Questions | Recall@5 | 95% interval | Recall@1 | MRR |',
    '|---|---|---|---|---|---|',
    ...retrieval.map((r) => `| ${r.pair} | ${r.n} | ${share(r.k5, r.n)} | ${r.n ? range(x.wilson(r.k5, r.n)) : 'n/a'} | ${share(r.k1, r.n)} | ${r.mrr.toFixed(3)} |`),
    '',
    `## The checker and the app's calibration (${x.method})`,
    '',
    "The app's calibration table, fitted on the English corpus, applied to this variant's checks: it was not fitted on these, so this is how it holds when entries are Japanese.",
    '',
    '| Pair | Questions checked | Right top entry | Right answers at or above 80% | Calibration error |',
    '|---|---|---|---|---|',
    ...calibration.map((c) => `| ${c.pair} | ${c.n} | ${c.right} | ${c.rightOver} of ${c.right} | ${Number.isNaN(c.ece) ? 'n/a' : c.ece.toFixed(3)} |`),
    '',
    '| Near misses | Questions | At or above 80% | 95% interval |',
    '|---|---|---|---|',
    ...nearRows.map(([label, items]) => {
      const k = items.filter((r) => r.confidence! >= LANGUAGE_BARS.bulkLine).length;
      return `| ${label} | ${items.length} | ${k} of ${items.length} | ${items.length ? range(x.wilson(k, items.length)) : 'n/a'} |`;
    }),
    '',
    `Checks unreadable after one retry: ${unreadable}, of which ${nearUnreadable} near misses (left out above; in the app such a question is never bulk-approved).`,
    '',
    '**Japanese-to-Japanese is likely optimistic**: the Japanese questions and the Japanese entries are both Claude\'s translations of the same English originals, so they may share wording a real customer would not use.',
    '',
    '## Bars (Sprint 12, Q4)',
    '',
    '| Bar | Result | Met |',
    '|---|---|---|',
    ...bars.map((b) => `| ${b.bar} | ${b.result} | ${b.met ? 'yes' : 'no'} |`),
    '',
    ...(met ? [] : ['**A bar is not met.** The shortfall is recorded as a residual risk; translated and Japanese drafts stay out of bulk approval whatever these figures say.', '']),
    ...(x.notes?.length ? ['**Notes:**', '', ...x.notes.map((n) => `- ${n}`), ''] : []),
  ].join('\n');
  return { markdown: md, met };
}
