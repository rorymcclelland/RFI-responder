/**
 * The knowledge-base entries that still need a vector, read and written with the service role
 * (members cannot write vector columns, migration 20261022150000). Shared by embed-entries and,
 * since Sprint 11 (S11-2), process-questions. Database errors are logged, never returned to the
 * browser (Sprint 11, S11-4, F-45). Since Sprint 16 (S16-2, BUG-40) a batch's vectors are saved in one
 * call, save_entry_vectors, all or nothing.
 */
import { EmbeddingError } from './embeddings.ts';
import type { EntryStore } from './embed-core.ts';

interface ServiceClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export function serviceEntryStore(admin: ServiceClient): EntryStore {
  return {
    async fetchPending(model, limit) {
      const { data, error } = await admin.rpc('pending_embeddings', { model, max_rows: limit });
      if (error) {
        console.error('pending_embeddings failed', error);
        throw new EmbeddingError('The knowledge base could not be read for indexing.', 500);
      }
      return (data ?? []) as Awaited<ReturnType<EntryStore['fetchPending']>>;
    },
    async save(updates) {
      if (updates.length === 0) return;
      const { error } = await admin.rpc('save_entry_vectors', {
        p_rows: updates.map((u) => ({ id: u.id, embedding: u.embedding, model: u.model })),
      });
      if (error) {
        console.error('saving vectors failed', error);
        throw new EmbeddingError('An index entry could not be saved.', 500);
      }
    },
  };
}
