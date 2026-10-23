/**
 * The app's processing pipeline (process-core) wired to cached vectors and the real Claude API,
 * for the drafting and red-team evaluations on Rory's PC. Matching uses the same vectors the
 * retrieval comparison cached, so no embedding calls are made.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeJudge } from '../supabase/functions/_shared/answerability';
import { CALIBRATION_TABLES } from '../supabase/functions/_shared/calibration-tables';
import { claudeClient, type ClaudeClient } from '../supabase/functions/_shared/claude';
import { voyageProvider } from '../supabase/functions/_shared/embeddings';
import { processQuestions, type ProcessedQuestion } from '../supabase/functions/_shared/process-core';
import type { MatchRow } from '../supabase/functions/_shared/sources';
import { cosine } from './metrics';
import { env, hashKey, loadKb, ROOT } from './lib';

export const MODELS = { judge: 'claude-haiku-5-5', gate: 'claude-haiku-5-5', draft: process.env.DRAFT_MODEL ?? 'claude-haiku-5-5' };
const EMBEDDING = { label: 'voyage-4', dir: 'voyage/voyage-4' };

export const kb = loadKb();

/** Counts calls and tokens, so reports can state the cost of a run. */
export function countingClient(inner: ClaudeClient) {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0 };
  const client: ClaudeClient = {
    async json<T>(req: Parameters<ClaudeClient['json']>[0]) {
      const r = await inner.json<T>(req);
      usage.calls++;
      usage.inputTokens += r.usage.inputTokens;
      usage.outputTokens += r.usage.outputTokens;
      return r;
    },
  };
  return { client, usage };
}

export function makeClaude() {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set in supabase/functions/.env');
    process.exit(1);
  }
  return countingClient(claudeClient({ apiKey: env.ANTHROPIC_API_KEY, retry: { attempts: 10, baseDelayMs: 10_000 } }));
}

function loadVectors() {
  const base = join(ROOT, 'eval/.cache', EMBEDDING.dir);
  if (!existsSync(join(base, 'query.json'))) {
    console.error(`No cached vectors in eval/.cache/${EMBEDDING.dir}: run npm run eval:retrieval first.`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(join(base, 'document.json'), 'utf8')) as Record<string, number[]>;
  const query = JSON.parse(readFileSync(join(base, 'query.json'), 'utf8')) as Record<string, number[]>;
  return { docVecs: kb.map((e) => doc[hashKey(`${e.question}\n${e.answer}`)]), query };
}

const vectors = loadVectors();

/** Embed (with voyage-4) any question not already in the cache, and save them to it. */
export async function ensureVectors(texts: string[]): Promise<void> {
  const missing = [...new Set(texts.filter((t) => !vectors.query[hashKey(t)]))];
  if (missing.length === 0) return;
  if (!env.VOYAGE_API_KEY) {
    console.error(`${missing.length} questions need embedding but VOYAGE_API_KEY is not set`);
    process.exit(1);
  }
  const provider = voyageProvider({ apiKey: env.VOYAGE_API_KEY, model: 'voyage-4', retry: { attempts: 10, baseDelayMs: 20_000 } });
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const { vectors: v } = await provider.embed(batch, 'query');
    batch.forEach((t, j) => (vectors.query[hashKey(t)] = v[j]));
    writeFileSync(join(ROOT, 'eval/.cache', EMBEDDING.dir, 'query.json'), JSON.stringify(vectors.query));
    process.stdout.write(`  embedding new questions: ${Math.min(i + 16, missing.length)}/${missing.length}\r`);
  }
  process.stdout.write('\n');
}

/** Vector for a question, or null if it was never embedded (the pipeline then uses keywords). */
export const queryVector = (text: string) => vectors.query[hashKey(text)] ?? null;

/** The top five entries by cosine similarity, shaped like match_kb_entries rows. */
export function matchRows(vector: number[]): MatchRow[] {
  return kb
    .map((e, i) => ({ e, s: cosine(vector, vectors.docVecs[i]) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 5)
    .map(({ e, s }) => ({
      id: e.ref, ref: e.ref, question: e.question, answer: e.answer, tags: e.tags, source: e.source ?? '',
      similarity: s, keyword_rank: 0, fused_score: s, embedding_model: EMBEDDING.label,
    }));
}

/**
 * Process questions exactly as the app does. `extraRows` lets the red team put an injected
 * entry at the top of a question's matches.
 */
export async function runPipeline(
  claude: ClaudeClient,
  questions: { id: string; question: string }[],
  extraRows: Record<string, MatchRow> = {},
): Promise<ProcessedQuestion[]> {
  const out: ProcessedQuestion[] = [];
  for (let i = 0; i < questions.length; i += 10) {
    const batch = questions.slice(i, i + 10);
    const vecs = batch.map((q) => queryVector(q.question));
    const results = await processQuestions(batch, {
      embed: vecs.every(Boolean) ? async () => ({ model: EMBEDDING.label, vectors: vecs as number[][] }) : null,
      match: async (text, vector) => {
        const q = batch.find((b) => b.question === text)!;
        const rows = vector ? matchRows(vector) : [];
        return extraRows[q.id] ? [extraRows[q.id], ...rows].slice(0, 5) : rows;
      },
      checker: claudeJudge({ client: claude, model: MODELS.judge }),
      classifier: { client: claude, model: MODELS.gate },
      drafter: { client: claude, model: MODELS.draft },
      tables: CALIBRATION_TABLES,
      concurrency: 3,
    });
    out.push(...results);
    process.stdout.write(`  ${Math.min(i + 10, questions.length)}/${questions.length}\r`);
  }
  process.stdout.write('\n');
  return out;
}

/** Sprint 6: questions whose answerability check was unreadable twice (bar: none). */
export const unreadableChecks = (results: ProcessedQuestion[]) =>
  results.filter((r) => r.processing_note?.includes('gave an unreadable answer twice')).length;
