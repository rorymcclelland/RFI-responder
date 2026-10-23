/**
 * POST { texts: string[], kind: 'query' | 'document' } -> { model, dimension, vectors }
 * Signed-in users only. The provider key stays here, server-side (decision 0005).
 * Counted against the caller's daily embedding cap (Sprint 4, S4-1).
 */
import { EMBEDDING_DIMENSION, providerFromEnv } from '../_shared/embeddings.ts';
import { validateEmbedRequest } from '../_shared/embed-core.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredEmbedder, quotaMessage, reserveQuota, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user } = await requireUser(req);
  const { texts, kind } = validateEmbedRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Sprint 4 (S4-1): counted against the caller's daily embedding cap and the monthly budget.
  const { allowed, reason, reservation } = await reserveQuota(admin, user.id, 'embed', texts.length);
  const usage: UsageRow[] = [];
  try {
    if (allowed < texts.length) throw new HttpError(quotaMessage(reason ?? 'daily_embed'), 429);
    const { model, vectors } = await meteredEmbedder(providerFromEnv(env), usage).embed(texts, kind);
    return json(req, 200, { model, dimension: EMBEDDING_DIMENSION, vectors });
  } finally {
    await finishUsage(admin, user.id, 'embed', null, usage, [reservation]);
  }
});
