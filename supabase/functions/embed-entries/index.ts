/**
 * POST {} -> { embedded, model }
 * Embeds knowledge-base entries that have no vector from the configured model.
 * Any signed-in user may call it: it only fills gaps. Writes use the service role,
 * because members cannot write vector columns (migration 20261022150000).
 * Counted against the caller's daily embedding cap (Sprint 4, S4-1).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { EmbeddingError, providerFromEnv } from '../_shared/embeddings.ts';
import { embedPendingEntries, type EntryStore } from '../_shared/embed-core.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredEmbedder, quotaMessage, reserveQuota, type QuotaReason, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user } = await requireUser(req);
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
  // Sprint 4 (S4-1): each batch is reserved against the caller's daily embedding cap and the budget.
  const usage: UsageRow[] = [];
  let reason: QuotaReason | null = null;
  const reservations: (string | null)[] = [];
  const reserve = async (n: number) => {
    try {
      const r = await reserveQuota(admin, user.id, 'embed', n);
      reason = r.reason;
      reservations.push(r.reservation);
      return r.allowed;
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        reason = reason ?? 'daily_embed';
        return 0;
      }
      throw err;
    }
  };
  let result: Awaited<ReturnType<typeof embedPendingEntries>>;
  try {
    result = await embedPendingEntries({ db, provider: meteredEmbedder(providerFromEnv(Deno.env.toObject()), usage), reserve });
  } finally {
    // Batches embedded before a failure are recorded too (security review, finding 6).
    await finishUsage(admin, user.id, 'embed-entries', null, usage, reservations);
  }
  if (result.limited && result.embedded === 0) throw new HttpError(quotaMessage(reason ?? 'daily_embed'), 429);
  return json(req, 200, { ...result, limit: result.limited ? quotaMessage(reason ?? 'daily_embed') : null });
});
