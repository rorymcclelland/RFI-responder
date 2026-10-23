/**
 * Shared helpers for the evaluation scripts that run on Rory's PC: reading keys from the
 * gitignored secrets file, the synthetic knowledge base, and a disk cache for paid API calls.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Papa from 'papaparse';
import type { KnowledgeEntry } from '../src/types';
import { JUDGE_MAX_TOKENS, JUDGE_PROMPT_VERSION, UnreadableReplyError } from '../supabase/functions/_shared/answerability';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal .env reader: KEY=value lines, # comments, optional quotes. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Keys from supabase/functions/.env (never committed), overridden by the environment. */
export const env = { ...readEnvFile(join(ROOT, 'supabase/functions/.env')), ...process.env } as Record<string, string | undefined>;

/** The 100 synthetic entries, with refs KB-0001.. in file order (as the seed import assigns them). */
export function loadKb(): (KnowledgeEntry & { ref: string })[] {
  const rows = Papa.parse<Record<string, string>>(readFileSync(join(ROOT, 'sample-data/security-qa.csv'), 'utf8'), {
    header: true,
    skipEmptyLines: true,
  }).data;
  return rows.map((r, i) => ({
    id: r.question,
    ref: `KB-${String(i + 1).padStart(4, '0')}`,
    question: r.question,
    answer: r.answer,
    tags: r.tags.split(',').map((t) => t.trim()).filter(Boolean),
    source: r.source,
  }));
}

export const hashKey = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 24);

/** A JSON object cache on disk under eval/.cache (gitignored), so reruns cost nothing. */
export function diskCache<T>(...parts: string[]) {
  const file = join(ROOT, 'eval/.cache', ...parts.map((p) => p.replace(/[^a-z0-9.-]/gi, '_'))) + '.json';
  mkdirSync(dirname(file), { recursive: true });
  const data: Record<string, T> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  return {
    get: (key: string) => data[hashKey(key)],
    set: (key: string, value: T) => {
      data[hashKey(key)] = value;
      writeFileSync(file, JSON.stringify(data));
    },
  };
}

/** Retry a failed call a few times with a growing wait (a dropped connection should not lose a run). */
export async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.log(`\n  ${label}: ${(err as Error).message}; retrying in ${5 * attempt}s`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/**
 * Sprint 6: judge caches are kept per prompt version and reply limit, so a changed prompt never
 * silently reuses old answers (refinement finding).
 */
export function judgeCacheParts(model: string): string[] {
  return [model, `${JUDGE_PROMPT_VERSION}-max${JUDGE_MAX_TOKENS}`];
}

export type Checked<T> = { ok: true; result: T; fresh: boolean } | { ok: false; stopReasons: string[] };

/**
 * One check, from the cache or fresh. Transport errors are retried (a dropped connection should not
 * lose a run); an unreadable reply (already retried once by the judge, as in the app) is returned
 * for counting and never cached.
 */
export async function cachedCheck<T>(
  cache: { get: (k: string) => T | undefined; set: (k: string, v: T) => void },
  key: string,
  fn: () => Promise<T>,
  retry: { attempts: number; waitMs: number } = { attempts: 4, waitMs: 5000 },
): Promise<Checked<T>> {
  const hit = cache.get(key);
  if (hit !== undefined) return { ok: true, result: hit, fresh: false };
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await fn();
      cache.set(key, result);
      return { ok: true, result, fresh: true };
    } catch (err) {
      if (err instanceof UnreadableReplyError) return { ok: false, stopReasons: err.stopReasons };
      if (attempt >= retry.attempts) throw err;
      console.log(`\n  ${(err as Error).message}; retrying in ${(retry.waitMs * attempt) / 1000}s`);
      await new Promise((r) => setTimeout(r, retry.waitMs * attempt));
    }
  }
}

/** "max_tokens 2, refusal 1" for the reports, or "none". */
export function stopReasonCounts(lists: string[][]): string {
  const counts = new Map<string, number>();
  for (const r of lists.flat()) counts.set(r, (counts.get(r) ?? 0) + 1);
  return counts.size ? [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r, n]) => `${r} ${n}`).join(', ') : 'none';
}
