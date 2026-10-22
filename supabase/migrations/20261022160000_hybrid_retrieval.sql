/*
  # Hybrid retrieval (Sprint 1, story S1-5)

  match_kb_entries ranks current knowledge-base entries two ways and merges them:
  - by meaning: cosine similarity between the question's vector and each entry's
    vector, only among entries embedded with the same model;
  - by keywords: Postgres full-text search over question and answer, matching any
    of the question's words (so a paraphrase with one shared term still counts).
  The two rankings are fused with reciprocal rank fusion (k = 60): each entry
  scores 1/(60 + rank) in each list it appears in. With no query vector (the
  embedding service is down) it returns keyword results only.

  SECURITY INVOKER: row-level security on kb_entries applies to the caller.
*/

ALTER TABLE public.kb_entries
  ADD COLUMN search_text tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, question || ' ' || answer)) STORED;
CREATE INDEX kb_entries_search_text ON public.kb_entries USING gin (search_text);

CREATE OR REPLACE FUNCTION public.match_kb_entries(
  query_embedding extensions.vector(1024),
  query_text      text,
  match_count     int DEFAULT 5,
  model_name      text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, ref text, question text, answer text, tags text[], source text,
  similarity double precision, keyword_rank real, fused_score double precision, embedding_model text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH q AS (
    -- Any-word match: turn plainto_tsquery's AND (&) into OR (|).
    SELECT CASE WHEN plainto_tsquery('english'::regconfig, coalesce(query_text, ''))::text = '' THEN NULL
                ELSE to_tsquery('english'::regconfig,
                       replace(plainto_tsquery('english'::regconfig, query_text)::text, '&', '|'))
           END AS tsq
  ),
  vec AS (
    SELECT k.id,
           1 - (k.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity,
           row_number() OVER (ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding) AS r
    FROM public.kb_entries k
    WHERE query_embedding IS NOT NULL
      AND k.superseded_by IS NULL
      AND k.embedding IS NOT NULL
      AND k.embedding_model = model_name
    ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT 50
  ),
  kw AS (
    SELECT k.id,
           ts_rank_cd(k.search_text, q.tsq) AS keyword_rank,
           row_number() OVER (ORDER BY ts_rank_cd(k.search_text, q.tsq) DESC, k.seq) AS r
    FROM public.kb_entries k, q
    WHERE q.tsq IS NOT NULL AND k.superseded_by IS NULL AND k.search_text @@ q.tsq
    ORDER BY keyword_rank DESC, k.seq
    LIMIT 50
  ),
  fused AS (
    SELECT coalesce(v.id, w.id) AS id, v.similarity, w.keyword_rank,
           coalesce(1.0 / (60 + v.r), 0) + coalesce(1.0 / (60 + w.r), 0) AS fused_score
    FROM vec v FULL OUTER JOIN kw w ON v.id = w.id
  )
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source,
         f.similarity, f.keyword_rank, f.fused_score, k.embedding_model
  FROM fused f JOIN public.kb_entries k ON k.id = f.id
  ORDER BY f.fused_score DESC, k.seq
  LIMIT least(greatest(match_count, 1), 20)
$$;

REVOKE ALL ON FUNCTION public.match_kb_entries(extensions.vector, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_kb_entries(extensions.vector, text, int, text) TO authenticated, service_role;
