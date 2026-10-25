/**
 * POST { texts: string[], kind: 'query' | 'document' } -> { model, dimension, vectors }
 * Signed-in users only. The provider key stays here, server-side (decision 0005).
 * Counted against the caller's daily embedding cap (Sprint 4, S4-1).
 * The app does not call it (matching and indexing embed inside process-questions and
 * embed-entries); CI uses it to test the function boundary: sign-in, limits, provider failures.
 */
import { EMBEDDING_DIMENSION, providerForRequest } from '../_shared/embeddings.ts';
import { validateEmbedRequest } from '../_shared/embed-core.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredEmbedder, reserveQuota, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user } = await requireUser(req);
  const { texts, kind } = validateEmbedRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();
  // Sprint 11 (S11-4, F-46): a missing key is a 503 with a plain message, before anything is reserved.
  const provider = providerForRequest(env);
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Sprint 4 (S4-1): counted against the caller's daily embedding cap and the monthly budget.
  // Sprint 11 (S11-4, F-44): all or nothing; a refusal (429) uses none of the day's allowance.
  const { reservation } = await reserveQuota(admin, user.id, 'embed', texts.length, undefined, { all: true });
  const usage: UsageRow[] = [];
  try {
    const { model, vectors } = await meteredEmbedder(provider, usage).embed(texts, kind);
    return json(req, 200, { model, dimension: EMBEDDING_DIMENSION, vectors });
  } finally {
    await finishUsage(admin, user.id, 'embed', null, usage, [reservation]);
  }
});
