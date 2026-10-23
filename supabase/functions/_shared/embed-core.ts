/**
 * The logic behind the `embed` and `embed-entries` Edge Functions, kept free of
 * Deno and Supabase imports so it can be unit-tested. The functions' index.ts
 * files only handle HTTP, authentication and the database client.
 */
import { EmbeddingError, type EmbedKind, type EmbeddingProvider } from './embeddings.ts';

/** Most texts per call to `embed`: a 2,000-row upload is embedded in 16 calls. */
export const MAX_TEXTS = 128;
/** Longest single text accepted; questionnaire questions are far shorter. */
export const MAX_CHARS = 8000;

export function validateEmbedRequest(body: unknown): { texts: string[]; kind: EmbedKind } {
  const b = body as { texts?: unknown; kind?: unknown } | null;
  if (!b || !Array.isArray(b.texts) || b.texts.length === 0) {
    throw new EmbeddingError('Send { texts: string[], kind: "query" | "document" }', 400);
  }
  if (b.texts.length > MAX_TEXTS) throw new EmbeddingError(`At most ${MAX_TEXTS} texts per request`, 400);
  if (!b.texts.every((t) => typeof t === 'string')) throw new EmbeddingError('Every text must be a string', 400);
  if ((b.texts as string[]).some((t) => t.length > MAX_CHARS)) {
    throw new EmbeddingError(`Each text must be at most ${MAX_CHARS} characters`, 400);
  }
  if (b.kind !== 'query' && b.kind !== 'document') throw new EmbeddingError('kind must be "query" or "document"', 400);
  return { texts: b.texts as string[], kind: b.kind };
}

export interface PendingEntry {
  id: string;
  question: string;
  answer: string;
}

export interface EntryStore {
  /** Current entries whose stored vector is missing or came from a different model. */
  fetchPending(model: string, limit: number): Promise<PendingEntry[]>;
  save(updates: { id: string; embedding: number[]; model: string }[]): Promise<void>;
}

/** What an entry's vector represents: its question and answer together. */
export const documentText = (e: { question: string; answer: string }) => `${e.question}\n${e.answer}`;

/**
 * Embed knowledge-base entries that lack a vector from the configured model, a batch
 * at a time, until none are left or `maxBatches` is reached (call again to continue).
 */
export async function embedPendingEntries(opts: {
  db: EntryStore;
  provider: EmbeddingProvider;
  batchSize?: number;
  maxBatches?: number;
  /** Sprint 4 (S4-1): how many of `n` texts may be embedded now; fewer stops the run after them. */
  reserve?: (n: number) => Promise<number>;
}): Promise<{ embedded: number; model: string; limited: boolean }> {
  const { db, provider, batchSize = 64, maxBatches = 40, reserve } = opts;
  let embedded = 0;
  let limited = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    let pending = await db.fetchPending(provider.model, batchSize);
    if (pending.length === 0) break;
    if (reserve) {
      const allowed = await reserve(pending.length);
      if (allowed < pending.length) {
        limited = true;
        pending = pending.slice(0, allowed);
        if (pending.length === 0) break;
      }
    }
    try {
      const { vectors, model } = await provider.embed(pending.map(documentText), 'document');
      await db.save(pending.map((e, i) => ({ id: e.id, embedding: vectors[i], model })));
    } catch (err) {
      const status = err instanceof EmbeddingError ? err.status : 500;
      const reason = err instanceof Error ? err.message : 'unknown error';
      throw new EmbeddingError(`${reason}. ${embedded} entries were embedded before the failure; run again to continue.`, status);
    }
    embedded += pending.length;
    if (limited || pending.length < batchSize) break;
  }
  return { embedded, model: provider.model, limited };
}
