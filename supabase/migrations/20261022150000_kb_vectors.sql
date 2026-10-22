/*
  # Vectors in the knowledge base (Sprint 1, story S1-3)

  Each entry gets a 1,024-dimension vector from the configured embedding model
  (decision 0005), plus the model's name, so vectors from different models are
  never compared with each other. Only the service role (the Edge Functions)
  writes them: members' column grants do not include these columns.
*/

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- The hardening migration stopped new functions being executable by default
-- (PUBLIC). Extension functions, including vector's own type and operator
-- functions, therefore need an explicit grant: signed-in users and the server
-- only, never anonymous visitors.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA extensions GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

ALTER TABLE public.kb_entries
  ADD COLUMN embedding       extensions.vector(1024),
  ADD COLUMN embedding_model text,
  ADD COLUMN embedded_at     timestamptz;

-- Approximate nearest-neighbour search by cosine distance.
CREATE INDEX kb_entries_embedding_hnsw ON public.kb_entries
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Current entries the embed-entries function still has to (re-)embed for a model.
CREATE OR REPLACE FUNCTION public.pending_embeddings(model text, max_rows int)
RETURNS TABLE (id uuid, question text, answer text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT k.id, k.question, k.answer
  FROM public.kb_entries k
  WHERE k.superseded_by IS NULL
    AND (k.embedding IS NULL OR k.embedding_model IS DISTINCT FROM model)
  ORDER BY k.seq
  LIMIT least(max_rows, 500)
$$;
REVOKE ALL ON FUNCTION public.pending_embeddings(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_embeddings(text, int) TO service_role;
