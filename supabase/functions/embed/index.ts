/**
 * POST { texts: string[], kind: 'query' | 'document' } -> { model, dimension, vectors }
 * Signed-in users only. The provider key stays here, server-side (decision 0005).
 */
import { EMBEDDING_DIMENSION, providerFromEnv } from '../_shared/embeddings.ts';
import { validateEmbedRequest } from '../_shared/embed-core.ts';
import { json, requireUser, serve } from '../_shared/http.ts';

serve(async (req) => {
  await requireUser(req);
  const { texts, kind } = validateEmbedRequest(await req.json().catch(() => null));
  const provider = providerFromEnv(Deno.env.toObject());
  const { model, vectors } = await provider.embed(texts, kind);
  return json(req, 200, { model, dimension: EMBEDDING_DIMENSION, vectors });
});
