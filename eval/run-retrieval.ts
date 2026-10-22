/**
 * Model comparison for Sprint 1 (story S1-4). Run on a machine that can reach the
 * providers (Rory's PC):
 *
 *   npm run eval:retrieval
 *
 * Reads VOYAGE_API_KEY from supabase/functions/.env (never committed) and expects
 * Ollama on http://localhost:11434 (override with OLLAMA_URL). A candidate whose key
 * or server is missing is skipped with a message. Vectors are cached in eval/.cache/,
 * so reruns are free. Writes docs/evals/retrieval-<date>.md and .json; the JSON keeps
 * per-question scores, which the calibration script (S1-6) reuses.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import { retrieveTopK } from '../src/retrieval';
import type { KnowledgeEntry } from '../src/types';
import {
  ollamaProvider,
  voyageProvider,
  type EmbeddingProvider,
  type EmbedKind,
} from '../supabase/functions/_shared/embeddings';
import { auroc, cosine, meanReciprocalRank, rankBy, recallAt, reciprocalRankFusion, type Ranking } from './metrics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** Small batches keep each request under low-tier token-per-minute limits. */
const BATCH = 16;

/** Kinds with no right answer in the knowledge base: off-topic questions and on-topic near misses. */
const UNANSWERABLE = new Set(['unanswerable', 'near-miss']);

interface Item { id: string; text: string; language: 'en' | 'ja'; kind: string; gold: string; split: string }

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...readEnvFile(join(ROOT, 'supabase/functions/.env')), ...process.env } as Record<string, string | undefined>;
const ollamaUrl = env.OLLAMA_URL_HOST ?? 'http://localhost:11434';

const candidates: { label: string; make: () => EmbeddingProvider | string }[] = [
  {
    label: 'voyage-4',
    // Patient retries: accounts without a payment method are limited to a few requests a minute.
    make: () => (env.VOYAGE_API_KEY
      ? voyageProvider({ apiKey: env.VOYAGE_API_KEY, model: 'voyage-4', retry: { attempts: 10, baseDelayMs: 20_000 } })
      : 'VOYAGE_API_KEY not set in supabase/functions/.env'),
  },
  { label: 'bge-m3', make: () => ollamaProvider({ baseUrl: ollamaUrl, model: 'bge-m3' }) },
  { label: 'qwen3-embedding:0.6b', make: () => ollamaProvider({ baseUrl: ollamaUrl, model: 'qwen3-embedding:0.6b' }) },
];

// ─── Data ────────────────────────────────────────────────────────────────────

const kbRows = Papa.parse<Record<string, string>>(readFileSync(join(ROOT, 'sample-data/security-qa.csv'), 'utf8'), {
  header: true,
  skipEmptyLines: true,
}).data;
const kb: KnowledgeEntry[] = kbRows.map((r) => ({
  id: r.question, // the question text is the gold label in the evaluation set
  question: r.question,
  answer: r.answer,
  tags: r.tags.split(',').map((t) => t.trim()).filter(Boolean),
  source: r.source,
}));
const set = JSON.parse(readFileSync(join(ROOT, 'eval/retrieval-set.json'), 'utf8')) as { version: string; items: Item[] };
const documentText = (e: KnowledgeEntry) => `${e.question}\n${e.answer}`;

// ─── Embedding with a disk cache ────────────────────────────────────────────

async function embedCached(p: EmbeddingProvider, texts: string[], kind: EmbedKind): Promise<number[][]> {
  const dir = join(ROOT, 'eval/.cache', p.name, p.model.replace(/[^a-z0-9.-]/gi, '_'));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${kind}.json`);
  const cache: Record<string, number[]> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const key = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 24);
  const missing = [...new Set(texts.filter((t) => !cache[key(t)]))];
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const { vectors } = await p.embed(batch, kind);
    batch.forEach((t, j) => (cache[key(t)] = vectors[j]));
    writeFileSync(file, JSON.stringify(cache));
    process.stdout.write(`  ${p.model} ${kind}: ${Math.min(i + BATCH, missing.length)}/${missing.length}\r`);
  }
  if (missing.length) process.stdout.write('\n');
  return texts.map((t) => cache[key(t)]);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

interface ItemResult {
  id: string;
  language: string;
  kind: string;
  split: string;
  gold: string;
  method: string;
  /** Top vector similarity (cosine) for vector methods; top TF-IDF score for keyword. */
  topScore: number;
  topIsGold: boolean;
  goldRank: number | null;
}

function keywordRanking(text: string): { ranked: string[]; scores: Record<string, number> } {
  const hits = retrieveTopK(text, kb, kb.length);
  const scores = Object.fromEntries(hits.map((h) => [h.entry.id, h.score]));
  return { ranked: hits.filter((h) => h.score > 0).map((h) => h.entry.id), scores };
}

function summarise(results: ItemResult[], method: string) {
  const mine = results.filter((r) => r.method === method);
  const asRankings = (f: (r: ItemResult) => boolean): Ranking[] =>
    mine.filter(f).map((r) => ({ gold: r.gold, ranked: r.goldRank ? [...Array(r.goldRank - 1).fill('_'), r.gold] : [] }));
  const en = asRankings((r) => r.kind === 'paraphrase');
  const ja = asRankings((r) => r.kind === 'translation');
  const answerableTop = mine.filter((r) => !UNANSWERABLE.has(r.kind)).map((r) => r.topScore);
  const unanswerableTop = mine.filter((r) => UNANSWERABLE.has(r.kind)).map((r) => r.topScore);
  const nearMissTop = mine.filter((r) => r.kind === 'near-miss').map((r) => r.topScore);
  return {
    method,
    en: { recall1: recallAt(en, 1), recall5: recallAt(en, 5), mrr: meanReciprocalRank(en), n: en.length },
    ja: { recall1: recallAt(ja, 1), recall5: recallAt(ja, 5), mrr: meanReciprocalRank(ja), n: ja.length },
    abstentionAuroc: auroc(answerableTop, unanswerableTop),
    /** The harder half: on-topic questions the knowledge base does not answer. */
    nearMissAuroc: nearMissTop.length ? auroc(answerableTop, nearMissTop) : null,
  };
}

function record(item: Item, method: string, ranked: string[], topScore: number): ItemResult {
  const i = item.gold ? ranked.indexOf(item.gold) : -1;
  return {
    id: item.id, language: item.language, kind: item.kind, split: item.split, gold: item.gold, method,
    topScore, topIsGold: Boolean(item.gold) && ranked[0] === item.gold, goldRank: i === -1 ? null : i + 1,
  };
}

// ─── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  const results: ItemResult[] = [];
  const skipped: string[] = [];
  const keyword = new Map(set.items.map((it) => [it.id, keywordRanking(it.text)]));

  for (const it of set.items) {
    const k = keyword.get(it.id)!;
    results.push(record(it, 'keyword (baseline)', k.ranked, k.scores[k.ranked[0]] ?? 0));
  }

  for (const c of candidates) {
    const p = c.make();
    if (typeof p === 'string') {
      skipped.push(`${c.label}: ${p}`);
      continue;
    }
    console.log(`Embedding with ${c.label}`);
    let docVecs: number[][];
    let queryVecs: number[][];
    try {
      docVecs = await embedCached(p, kb.map(documentText), 'document');
      queryVecs = await embedCached(p, set.items.map((i) => i.text), 'query');
    } catch (err) {
      skipped.push(`${c.label}: ${(err as Error).message}`);
      continue;
    }
    set.items.forEach((it, qi) => {
      const sims = Object.fromEntries(kb.map((e, di) => [e.id, cosine(queryVecs[qi], docVecs[di])]));
      const vectorRanked = rankBy(sims);
      const top = sims[vectorRanked[0]];
      results.push(record(it, `${c.label}`, vectorRanked, top));
      const hybrid = reciprocalRankFusion([vectorRanked, keyword.get(it.id)!.ranked]);
      results.push(record(it, `${c.label} + keyword`, hybrid, top));
    });
  }

  const methods = [...new Set(results.map((r) => r.method))];
  const summary = methods.map((m) => summarise(results, m));
  const date = new Date().toISOString().slice(0, 10);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const md = [
    `# Retrieval comparison, ${date}`,
    '',
    `Evaluation set ${set.version}: ${set.items.length} items (200 English paraphrases, 100 Japanese, ${set.items.filter((i) => i.kind === 'unanswerable').length} off-topic unanswerable, ${set.items.filter((i) => i.kind === 'near-miss').length} near misses: on-topic questions the knowledge base does not answer). **All items are unreviewed; Japanese are machine translations, so Japanese figures are indicative.** Knowledge base: the 100 synthetic entries. Generated by \`npm run eval:retrieval\`.`,
    '',
    'Bars agreed for Sprint 1: English recall@5 at least 90%, Japanese recall@5 at least 80%.',
    '',
    '| Method | EN recall@1 | EN recall@5 | EN MRR | JA recall@1 | JA recall@5 | JA MRR | Abstention AUROC | Near-miss AUROC |',
    '|---|---|---|---|---|---|---|---|---|',
    ...summary.map((s) =>
      `| ${s.method} | ${pct(s.en.recall1)} | ${pct(s.en.recall5)} | ${s.en.mrr.toFixed(3)} | ${pct(s.ja.recall1)} | ${pct(s.ja.recall5)} | ${s.ja.mrr.toFixed(3)} | ${s.abstentionAuroc.toFixed(3)} | ${s.nearMissAuroc === null ? 'n/a' : s.nearMissAuroc.toFixed(3)} |`),
    '',
    'Abstention AUROC: how well the top similarity separates answerable from unanswerable questions, both kinds (1.0 perfect, 0.5 no better than chance). Near-miss AUROC: the same, against near misses only; this is the harder case.',
    '',
    ...(skipped.length ? ['**Skipped:**', '', ...skipped.map((s) => `- ${s}`), ''] : []),
  ].join('\n');

  mkdirSync(join(ROOT, 'docs/evals'), { recursive: true });
  writeFileSync(join(ROOT, `docs/evals/retrieval-${date}.md`), md + '\n');
  writeFileSync(join(ROOT, `docs/evals/retrieval-${date}.json`), JSON.stringify({ date, setVersion: set.version, summary, skipped, results }, null, 1));
  console.log(md);
  console.log(`\nWritten: docs/evals/retrieval-${date}.md and .json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
