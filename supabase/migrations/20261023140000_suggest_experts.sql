-- Sprint 3, S3-6: suggest who should review a question, from what people have written and
-- approved before as well as their stated expertise. Each suggestion carries its reasons.
--   +3 for each entry the question cites that the person wrote
--   +1 for each other question citing the same entries that they approved individually (at most 5)
--   +1 for each of their expertise tags that matches a cited entry's tags (at most 3)

CREATE OR REPLACE FUNCTION public.suggest_experts(p_question uuid)
RETURNS TABLE (user_id uuid, display_name text, score int, reasons text[])
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  WITH q AS (
    SELECT x.id, coalesce(ARRAY(SELECT jsonb_array_elements(coalesce(x.sources_json, '[]'::jsonb))->>'id'), '{}') AS refs
      FROM public.rfi_questions x WHERE x.id = p_question
  ), cited AS (
    SELECT k.ref, k.created_by, k.tags FROM public.kb_entries k, q WHERE k.ref = ANY (q.refs)
  ), cited_tags AS (
    SELECT DISTINCT lower(t) AS tag FROM cited, unnest(cited.tags) AS t
  ), wrote AS (
    SELECT c.created_by AS uid, array_agg(c.ref ORDER BY c.ref) AS refs FROM cited c WHERE c.created_by IS NOT NULL GROUP BY c.created_by
  ), approved AS (
    SELECT a.decided_by AS uid, count(DISTINCT a.question_id)::int AS n
      FROM public.approvals a
      JOIN public.rfi_questions o ON o.id = a.question_id
      , q
     WHERE a.kind = 'individual' AND a.decided_by IS NOT NULL AND o.id <> q.id
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(o.sources_json, '[]'::jsonb)) e WHERE e->>'id' = ANY (q.refs))
     GROUP BY a.decided_by
  ), tagged AS (
    SELECT p.id AS uid, array_agg(DISTINCT lower(t) ORDER BY lower(t)) AS tags
      FROM public.user_profiles p, unnest(p.expertise_tags) AS t
     WHERE lower(t) IN (SELECT tag FROM cited_tags)
     GROUP BY p.id
  ), scored AS (
    SELECT p.id, p.display_name,
           3 * coalesce(cardinality(w.refs), 0) + least(coalesce(ap.n, 0), 5) + least(coalesce(cardinality(tg.tags), 0), 3) AS score,
           array_remove(ARRAY[
             CASE WHEN w.refs IS NOT NULL THEN 'wrote ' || array_to_string(w.refs, ', ') END,
             CASE WHEN ap.n IS NOT NULL THEN 'approved ' || ap.n || ' answer' || CASE WHEN ap.n = 1 THEN '' ELSE 's' END || ' drawn from the same entries' END,
             CASE WHEN tg.tags IS NOT NULL THEN 'expertise: ' || array_to_string(tg.tags[1:3], ', ') END
           ], NULL) AS reasons
      FROM public.user_profiles p
      LEFT JOIN wrote w ON w.uid = p.id
      LEFT JOIN approved ap ON ap.uid = p.id
      LEFT JOIN tagged tg ON tg.uid = p.id
  )
  SELECT s.id, s.display_name, s.score::int, s.reasons
    FROM scored s
   WHERE s.score > 0
   ORDER BY s.score DESC, s.display_name, s.id
   LIMIT 5
$$;

REVOKE ALL ON FUNCTION public.suggest_experts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.suggest_experts(uuid) TO authenticated;
