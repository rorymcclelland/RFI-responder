/**
 * The knowledge-base entries that still need a vector, read and written with the service role
 * (members cannot write vector columns, migration 20261022150000). Shared by embed-entries and,
 * since Sprint 11 (S11-2), process-questions. Database errors are logged, never returned to the
 * browser (Sprint 11, S11-4, F-45).
 */
import { EmbeddingError } from './embeddings.ts';
import type { EntryStore } from './embed-core.ts';

interface ServiceClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): { update(values: Record<string, unknown>): { eq(column: string, value: unknown): PromiseLike<{ error: unknown }> } };
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
      for (const u of updates) {
        const { error } = await admin
          .from('kb_entries')
          .update({ embedding: JSON.stringify(u.embedding), embedding_model: u.model, embedded_at: new Date().toISOString() })
          .eq('id', u.id);
        if (error) {
          console.error('saving a vector failed', error);
          throw new EmbeddingError('An index entry could not be saved.', 500);
        }
      }
    },
  };
}
