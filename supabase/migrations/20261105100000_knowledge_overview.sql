-- Sprint 17 (S17-3, K-1): the knowledge page's overview in one call.
--
-- Security invoker: it reads under the caller's own rights, so it shows only what the caller could
-- read anyway (every signed-in person reads every current entry and every question). Read-only.
-- Counts current entries only: not replaced ones, and not proposed changes waiting to replace an
-- entry (the rest of the schema's meaning of current: the unique index, learning):
--   reviewed      reviewed and not past its review date
--   overdue       reviewed, but past its review date
--   waiting       not yet reviewed (added by a member, or learned from a member's answer)
--   translations  a machine translation not yet checked
--   proposals     proposed changes to an existing entry, waiting for review (counted apart)
-- Topics are entries' tags (each tag once per entry), with how many questions cited their entries
-- (each question once per entry); entries without tags are counted under a null tag. Learned: the
-- five newest entries learned from responses, proposals included (with the entry they would
-- replace), named by the response they came from. Entries: each current entry's state, citations
-- and review date, for the browse filters.
-- Cost: linear in entries and cited references (security review, Sprint 17, M1). The review date is
-- worked out inline, by the same rule as access.entry_review_due (a test keeps the two equal),
-- because a definer function cannot be inlined and read the settings once per row.
CREATE FUNCTION public.knowledge_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH iv AS (
    SELECT make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s)) AS months
  ),
  cites AS (
    SELECT c.ref, count(*) AS n
      FROM (SELECT DISTINCT q.id, r AS ref
              FROM public.rfi_questions q, unnest(coalesce(q.cited_refs, '{}'::text[])) AS r) c
     GROUP BY c.ref
  ),
  e AS (
    SELECT k.ref, k.seq, k.question, k.tags, k.language, k.translated_from, k.reviewed_at,
           k.created_by, k.created_at, k.origin, k.source,
           coalesce(k.last_reviewed_at, k.reviewed_at, k.created_at) + iv.months AS due,
           coalesce(c.n, 0) AS citations
      FROM public.kb_entries k CROSS JOIN iv LEFT JOIN cites c ON c.ref = k.ref
     WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL
  ),
  proposals AS (
    SELECT k.ref, k.seq, k.question, k.created_at, k.origin, k.source, k.reviewed_at, o.ref AS replaces
      FROM public.kb_entries k JOIN public.kb_entries o ON o.id = k.proposed_replacement_of
     WHERE k.superseded_by IS NULL
  ),
  tagged AS (
    SELECT DISTINCT t.tag, e.ref, e.citations
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
      'translations', (SELECT count(*) FROM e WHERE e.reviewed_at IS NULL AND e.translated_from IS NOT NULL),
      'proposals', (SELECT count(*) FROM proposals)),
    'topics', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tag', x.tag, 'entries', x.entries, 'citations', x.citations) ORDER BY x.entries DESC, x.tag)
        FROM (SELECT t.tag, count(*) AS entries, sum(t.citations) AS citations FROM tagged t GROUP BY t.tag) x), '[]'::jsonb),
    'learned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('ref', l.ref, 'question', l.question, 'at', l.created_at,
                                          'from', nullif(regexp_replace(l.source, '^RFI response: ', ''), ''),
                                          'reviewed', l.reviewed_at IS NOT NULL, 'replaces', l.replaces)
                       ORDER BY l.created_at DESC, l.seq DESC)
        FROM (SELECT u.* FROM (SELECT e.ref, e.seq, e.question, e.created_at, e.source, e.reviewed_at, NULL::text AS replaces
                                 FROM e WHERE e.origin = 'response'
                               UNION ALL
                               SELECT p.ref, p.seq, p.question, p.created_at, p.source, p.reviewed_at, p.replaces
                                 FROM proposals p WHERE p.origin = 'response') u
               ORDER BY u.created_at DESC, u.seq DESC LIMIT 5) l), '[]'::jsonb),
    'entries', coalesce((
      SELECT jsonb_object_agg(e.ref, jsonb_build_object(
               'state', CASE WHEN e.reviewed_at IS NULL AND e.translated_from IS NOT NULL THEN 'translation'
                             WHEN e.reviewed_at IS NULL THEN 'waiting'
                             WHEN e.due < now() THEN 'overdue' ELSE 'reviewed' END,
               'citations', e.citations,
               'due', e.due))
        FROM e), '{}'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.knowledge_overview() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_overview() TO authenticated;
