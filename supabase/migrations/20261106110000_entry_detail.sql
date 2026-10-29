-- Sprint 18 (S18-2, K-2): one answer and its history, in one call.
--
-- public.entry_detail(p_ref) is SECURITY INVOKER: the answer, the responses that cited it, what it
-- replaced or was replaced by, its translations and its proposed change are read under the caller's
-- own rights (every signed-in person can read every entry, question and response).
--
-- Its history comes from the audit log, which members cannot read. access.entry_events (SECURITY
-- DEFINER, in the schema the API does not expose) returns only that entry's own knowledge-base
-- events (Rory, Q1): kb.* rows whose target is the entry, and kb.confirmed rows (whose target is the
-- question) that list its number and were written after the entry was created, since numbers start
-- again at KB-0001 when the demo is reset. Nothing else in the audit log is reachable through it.
CREATE FUNCTION access.entry_events(p_entry uuid)
RETURNS TABLE (at timestamptz, action text, actor uuid, details jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH e AS (SELECT k.id, k.ref, k.created_at FROM public.kb_entries k WHERE k.id = p_entry)
  SELECT a.at, a.action, a.actor,
         CASE WHEN a.action = 'kb.confirmed' THEN
                jsonb_build_object('response', o.name, 'question', q.question)
              ELSE a.details END
    FROM e
    JOIN public.audit_log a
      ON (a.action LIKE 'kb.%' AND a.action <> 'kb.confirmed' AND a.target_id = e.id)
      OR (a.action = 'kb.confirmed' AND a.details->'refs' ? e.ref AND a.at >= e.created_at)
    LEFT JOIN public.rfi_questions q ON a.action = 'kb.confirmed' AND q.id = a.target_id
    LEFT JOIN public.rfi_sessions s ON s.id = q.session_id
    LEFT JOIN public.opportunities o ON o.id = s.opportunity_id
   WHERE auth.uid() IS NOT NULL
   ORDER BY a.at, a.id
   LIMIT 500;
$$;
REVOKE ALL ON FUNCTION access.entry_events(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION access.entry_events(uuid) TO authenticated;

CREATE FUNCTION public.entry_detail(p_ref text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH k AS (
    SELECT x.*, coalesce(x.last_reviewed_at, x.reviewed_at, x.created_at)
                + make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s)) AS due
      FROM public.kb_entries x
     WHERE x.ref = upper(btrim(p_ref))
  ),
  used AS (
    SELECT q.id, q.question, q.status, coalesce(q.learned_at, q.processed_at, q.created_at) AS at,
           -- Edited: approved with an answer other than the draft (an unedited approval leaves final_answer
           -- empty or equal to the draft).
           coalesce(q.status = 'accepted' AND q.final_answer IS NOT NULL
                    AND btrim(q.final_answer) <> btrim(coalesce(q.generated_answer, '')), false) AS edited,
           o.id AS response_id, o.name AS response, o.outcome, o.exported_at, o.archived_at
      FROM k
      JOIN public.rfi_questions q ON q.cited_refs @> ARRAY[k.ref]
      JOIN public.rfi_sessions s ON s.id = q.session_id
      JOIN public.opportunities o ON o.id = s.opportunity_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM k) THEN NULL ELSE jsonb_build_object(
    'entry', (SELECT jsonb_build_object(
        'id', k.id, 'ref', k.ref, 'question', k.question, 'answer', k.answer, 'tags', to_jsonb(k.tags),
        'source', k.source, 'origin', k.origin, 'createdBy', k.created_by, 'createdAt', k.created_at,
        'language', k.language, 'translatedFrom', to_jsonb(k.translated_from),
        'reviewedAt', k.reviewed_at, 'reviewedBy', k.reviewed_by, 'lastReviewedAt', k.last_reviewed_at,
        'due', k.due,
        'state', CASE WHEN k.superseded_by IS NOT NULL THEN 'replaced'
                      WHEN k.proposed_replacement_of IS NOT NULL THEN 'proposal'
                      WHEN k.reviewed_at IS NULL AND k.translated_from IS NOT NULL THEN 'translation'
                      WHEN k.reviewed_at IS NULL THEN 'waiting'
                      WHEN k.due < now() THEN 'overdue' ELSE 'reviewed' END,
        'replacedBy', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.superseded_by),
        'proposalFor', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.proposed_replacement_of))
      FROM k),
    'proposal', (SELECT jsonb_build_object('id', p.id, 'ref', p.ref, 'question', p.question, 'answer', p.answer,
                                           'source', p.source, 'createdBy', p.created_by, 'createdAt', p.created_at)
                   FROM k JOIN public.kb_entries p ON p.proposed_replacement_of = k.id AND p.superseded_by IS NULL
                  ORDER BY p.created_at DESC LIMIT 1),
    'replaced', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', o.ref, 'question', o.question) ORDER BY o.seq)
                            FROM k JOIN public.kb_entries o ON o.superseded_by = k.id), '[]'::jsonb),
    'translations', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', t.ref, 'language', t.language,
                                                                  'reviewed', t.reviewed_at IS NOT NULL) ORDER BY t.seq)
                                FROM k JOIN public.kb_entries t ON t.translated_from @> ARRAY[k.ref] AND t.superseded_by IS NULL), '[]'::jsonb),
    'usedCount', (SELECT count(*) FROM used),
    'used', coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'questionId', u.id, 'question', u.question, 'status', u.status, 'edited', u.edited,
                         'responseId', u.response_id, 'response', u.response, 'outcome', u.outcome,
                         'exportedAt', u.exported_at, 'archivedAt', u.archived_at, 'at', u.at) ORDER BY u.at DESC)
                        FROM (SELECT * FROM used ORDER BY used.at DESC LIMIT 100) u), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('at', h.at, 'action', h.action, 'actor', h.actor, 'details', h.details)
                                          ORDER BY h.at)
                           FROM k, access.entry_events(k.id) h), '[]'::jsonb)
  ) END;
$$;
REVOKE ALL ON FUNCTION public.entry_detail(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.entry_detail(text) TO authenticated;
