/**
 * POST {} -> { embedded, model }
 * Embeds knowledge-base entries that have no vector from the configured model.
 * Any signed-in user may call it: it only fills gaps. Writes use the service role,
 * because members cannot write vector columns (migration 20261022150000).
 * Counted against the caller's daily embedding cap (Sprint 4, S4-1).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { providerForRequest } from '../_shared/embeddings.ts';
import { embedPendingEntries } from '../_shared/embed-core.ts';
import { serviceEntryStore } from '../_shared/entry-store.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredEmbedder, quotaMessage, reserveQuota, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user } = await requireUser(req);
  // Sprint 11 (S11-4, F-46): a missing key is a 503 with a plain message.
  const provider = providerForRequest(Deno.env.toObject());
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  // Sprint 11 (S11-4, F-45): database errors are logged, not returned (shared with process-questions).
  const db = serviceEntryStore(admin);
  // Sprint 4 (S4-1): each batch is reserved against the caller's daily embedding cap and the budget.
  const usage: UsageRow[] = [];
  // Sprint 11 (S11-4, F-45): the message for the limit actually reached (budget or daily cap).
  let limitMessage: string | null = null;
  const reservations: (string | null)[] = [];
  const reserve = async (n: number) => {
    try {
      const r = await reserveQuota(admin, user.id, 'embed', n);
      if (r.reason) limitMessage = quotaMessage(r.reason);
      reservations.push(r.reservation);
      return r.allowed;
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) {
        limitMessage = err.message;
        return 0;
      }
      throw err;
    }
  };
  let result: Awaited<ReturnType<typeof embedPendingEntries>>;
  try {
    result = await embedPendingEntries({ db, provider: meteredEmbedder(provider, usage), reserve });
  } finally {
    // Batches embedded before a failure are recorded too (security review, finding 6).
    await finishUsage(admin, user.id, 'embed-entries', null, usage, reservations);
  }
  const message = limitMessage ?? quotaMessage('daily_embed');
  if (result.limited && result.embedded === 0) throw new HttpError(message, 429);
  return json(req, 200, { ...result, limit: result.limited ? message : null });
});
