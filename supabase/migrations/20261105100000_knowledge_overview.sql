-- Sprint 17 (S17-3, K-1): the knowledge page's overview in one call.
--
-- Security invoker: it reads under the caller's own rights, so it shows only what the caller could
-- read anyway (every signed-in person reads every current entry and every question). Read-only.
-- Counts current entries only (not replaced ones):
--   reviewed      reviewed and not past its review date
--   overdue       reviewed, but past its review date
--   waiting       not yet reviewed (added by a member, or learned from a member's answer)
--   translations  a machine translation not yet checked
-- Topics are entries' tags, with how many times questions cited their entries; entries without tags
-- are counted under a null tag. Learned: the five newest entries learned from responses. Entries:
-- each current entry's state and citations, for the browse filters.
CREATE FUNCTION public.knowledge_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH e AS (
    SELECT k.*, access.entry_review_due(k) AS due
      FROM public.kb_entries k
     WHERE k.superseded_by IS NULL
  ),
  cites AS (
    SELECT r AS ref, count(*) AS n
      FROM public.rfi_questions q, unnest(coalesce(q.cited_refs, '{}'::text[])) AS r
     GROUP BY r
  ),
  tagged AS (
    SELECT t.tag, e.ref
      FROM e LEFT JOIN LATERAL unnest(CASE WHEN cardinality(e.tags) > 0 THEN e.tags ELSE ARRAY[NULL::text] END) AS t(tag) ON true
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM e),
    'languages', jsonb_build_object(
      'en', (SELECT count(*) FROM e WHERE e.language = 'en'),
      'ja', (SELECT count(*) FROM e WHERE e.language = 'ja')),
    'contributors', (SELECT count(DISTINCT e.created_by) FROM e),
    'states', jsonb_build_object(
      'reviewed', (SELECT count(*) FROM e WHERE e.reviewed_at IS NOT NULL AND e.due >= now()),
      'overdue', (SELECT count(*) FROM e WHERE e.reviewed_at IS NOT NULL AND e.due < now()),
      'waiting', (SELECT count(*) FROM e WHERE e.reviewed_at IS NULL AND e.translated_from IS NULL),
      'translations', (SELECT count(*) FROM e WHERE e.reviewed_at IS NULL AND e.translated_from IS NOT NULL)),
    'topics', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tag', x.tag, 'entries', x.entries, 'citations', x.citations) ORDER BY x.entries DESC, x.tag)
        FROM (SELECT t.tag, count(*) AS entries, coalesce(sum(c.n), 0) AS citations
                FROM tagged t LEFT JOIN cites c ON c.ref = t.ref
               GROUP BY t.tag) x), '[]'::jsonb),
    'learned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('ref', l.ref, 'question', l.question, 'at', l.created_at,
                                          'from', l.origin_ref, 'reviewed', l.reviewed_at IS NOT NULL) ORDER BY l.created_at DESC, l.seq DESC)
        FROM (SELECT * FROM e WHERE e.origin = 'response' ORDER BY e.created_at DESC, e.seq DESC LIMIT 5) l), '[]'::jsonb),
    'entries', coalesce((
      SELECT jsonb_object_agg(e.ref, jsonb_build_object(
               'state', CASE WHEN e.reviewed_at IS NULL AND e.translated_from IS NOT NULL THEN 'translation'
                             WHEN e.reviewed_at IS NULL THEN 'waiting'
                             WHEN e.due < now() THEN 'overdue' ELSE 'reviewed' END,
               'citations', coalesce((SELECT c.n FROM cites c WHERE c.ref = e.ref), 0),
               'due', e.due))
        FROM e), '{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.knowledge_overview() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_overview() TO authenticated;
