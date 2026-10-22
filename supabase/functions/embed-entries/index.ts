/**
 * POST {} -> { embedded, model }
 * Embeds knowledge-base entries that have no vector from the configured model.
 * Any signed-in user may call it: it only fills gaps. Writes use the service role,
 * because members cannot write vector columns (migration 20261022150000).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EmbeddingError, providerFromEnv } from '../_shared/embeddings.ts';
import { embedPendingEntries, type EntryStore } from '../_shared/embed-core.ts';
import { json, requireUser, serve } from '../_shared/http.ts';

serve(async (req) => {
  await requireUser(req);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const db: EntryStore = {
    async fetchPending(model, limit) {
      const { data, error } = await admin.rpc('pending_embeddings', { model, max_rows: limit });
      if (error) throw new EmbeddingError(`Could not read entries: ${error.message}`, 500);
      return data ?? [];
    },
    async save(updates) {
      for (const u of updates) {
        const { error } = await admin
          .from('kb_entries')
          .update({ embedding: JSON.stringify(u.embedding), embedding_model: u.model, embedded_at: new Date().toISOString() })
          .eq('id', u.id);
        if (error) throw new EmbeddingError(`Could not save a vector: ${error.message}`, 500);
      }
    },
  };
  const result = await embedPendingEntries({ db, provider: providerFromEnv(Deno.env.toObject()) });
  return json(req, 200, result);
});
