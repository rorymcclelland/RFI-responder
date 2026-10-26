-- Sprint 12 (S12-2): matches carry the entry's language, so the pipeline can tell a draft that
-- crosses languages (translated) from one that does not. The return type changes, so the function
-- is dropped and created again, with the same grants.
DROP FUNCTION public.match_kb_entries(extensions.vector, text, int, text);
CREATE OR REPLACE FUNCTION public.match_kb_entries(
  query_embedding extensions.vector(1024),
  query_text      text,
  match_count     int DEFAULT 5,
  model_name      text DEFAULT NULL
)
RETURNS TABLE (
  id uuid, ref text, question text, answer text, tags text[], source text,
  similarity double precision, keyword_rank real, fused_score double precision, embedding_model text,
  language text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH q AS (
    SELECT CASE WHEN plainto_tsquery('english'::regconfig, coalesce(query_text, ''))::text = '' THEN NULL
                ELSE to_tsquery('english'::regconfig,
                       replace(plainto_tsquery('english'::regconfig, query_text)::text, '&', '|'))
           END AS tsq
  ),
  vec AS (
    SELECT k.id, 1 - (k.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
    FROM public.kb_entries k
    WHERE query_embedding IS NOT NULL
      AND k.superseded_by IS NULL
      AND k.embedding IS NOT NULL
      AND k.embedding_model = model_name
    ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT 50
  ),
  kw AS (
    SELECT k.id, ts_rank_cd(k.search_text, q.tsq) AS keyword_rank
    FROM public.kb_entries k, q
    WHERE q.tsq IS NOT NULL AND k.superseded_by IS NULL AND k.search_text @@ q.tsq
    ORDER BY keyword_rank DESC, k.seq
    LIMIT 50
  ),
  ranked AS (
    -- With a query vector: meaning decides the order. Without one: keywords do.
    SELECT v.id, v.similarity, w.keyword_rank, v.similarity AS score
    FROM vec v LEFT JOIN kw w ON w.id = v.id
    WHERE query_embedding IS NOT NULL
    UNION ALL
    SELECT w.id, NULL::double precision, w.keyword_rank, w.keyword_rank::double precision
    FROM kw w
    WHERE query_embedding IS NULL
  )
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source,
         r.similarity, r.keyword_rank, r.score, k.embedding_model, k.language
  FROM ranked r JOIN public.kb_entries k ON k.id = r.id
  ORDER BY r.score DESC, k.seq
  LIMIT least(greatest(match_count, 1), 20)
$$;
REVOKE ALL ON FUNCTION public.match_kb_entries(extensions.vector, text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_kb_entries(extensions.vector, text, int, text) TO authenticated, service_role;
