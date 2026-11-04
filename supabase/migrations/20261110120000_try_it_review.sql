-- Sprint 23 reviews of 20261110110000 (Try it).
--
-- Security M1, QA 9: a try could be handed to someone else (its owner changed), filling their one try
-- slot and drafting another person's questions on their quota; and the service role kept an update
-- grant on `trial`. Now, for every role, a try's `trial` and `owner_id` never change, and nor does an
-- ordinary response's `trial`.
-- Security L1: Start a new try had no limit of its own: at most five tries per person a day.
-- QA 4: a try's question could be assigned to a colleague, who would then see it on Home: a try is
-- worked by its visitor alone, so the database refuses assignments on a try.
-- Security L2: tries counted as uses of the entries they cited, and an entry's page named them to
-- everyone: knowledge_overview, entry_detail and overdue_entries now leave tries out (each as in
-- 20261106120000 otherwise).
-- Security L3: members still held insert, update and delete on the rebuilt overview view (Supabase's
-- default grants); it cannot be written, and now holds no such grant.

-- Whether a file belongs to a try (for the usage counts below).
CREATE FUNCTION private.in_try(p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT o.trial FROM public.rfi_sessions s JOIN public.opportunities o ON o.id = s.opportunity_id
                    WHERE s.id = p_session), false);
$$;
REVOKE ALL ON FUNCTION private.in_try(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.try_stays_a_try()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.trial IS DISTINCT FROM OLD.trial THEN
    RAISE EXCEPTION 'A try stays a try, and a response stays a response' USING ERRCODE = '42501';
  END IF;
  IF OLD.trial AND NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'A try cannot be given to someone else' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER opportunities_try_stays_a_try BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION private.try_stays_a_try();

CREATE FUNCTION private.tries_per_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.trial AND (SELECT count(*) FROM public.opportunities o
                     WHERE o.trial AND o.owner_id = NEW.owner_id AND o.created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'You have made five tries today; open your try, or come back tomorrow' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.tries_per_day() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER opportunities_tries_per_day BEFORE INSERT ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION private.tries_per_day();

CREATE FUNCTION private.no_assignment_on_a_try()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Found through the question's file, whatever opportunity_id the caller sent (another trigger sets it).
  IF private.in_try(NEW.session_id) OR coalesce((SELECT o.trial FROM public.opportunities o WHERE o.id = NEW.opportunity_id), false) THEN
    RAISE EXCEPTION 'A try is yours alone: its questions cannot be assigned to colleagues' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.no_assignment_on_a_try() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER question_assignments_not_on_a_try BEFORE INSERT ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION private.no_assignment_on_a_try();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.response_overview FROM authenticated;

CREATE OR REPLACE FUNCTION public.knowledge_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH iv AS (
    SELECT make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s)) AS months
  ),
  cites AS (
    SELECT c.ref, count(*) AS n
      FROM (SELECT DISTINCT q.id, r AS ref
              FROM public.rfi_questions q
              JOIN public.rfi_sessions s ON s.id = q.session_id
              LEFT JOIN public.opportunities o ON o.id = s.opportunity_id
              CROSS JOIN LATERAL unnest(coalesce(q.cited_refs, '{}'::text[])) AS r
             WHERE o.trial IS NOT TRUE) c
     GROUP BY c.ref
  ),
  e AS (
    SELECT k.ref, k.seq, k.question, k.tags, k.language, k.translated_from, k.reviewed_at,
           k.created_by, k.created_at, k.origin, k.source,
           coalesce(k.last_reviewed_at, k.reviewed_at, k.created_at) + iv.months AS due,
           coalesce(c.n, 0) AS citations
      FROM public.kb_entries k CROSS JOIN iv LEFT JOIN cites c ON c.ref = k.ref
     WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL AND k.retired_at IS NULL
  ),
  retired AS (
    SELECT k.ref, coalesce(c.n, 0) AS citations
      FROM public.kb_entries k LEFT JOIN cites c ON c.ref = k.ref
     WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL AND k.retired_at IS NOT NULL
  ),
  proposals AS (
    SELECT k.ref, k.seq, k.question, k.created_at, k.origin, k.source, k.reviewed_at, o.ref AS replaces
      FROM public.kb_entries k JOIN public.kb_entries o ON o.id = k.proposed_replacement_of
     WHERE k.superseded_by IS NULL AND k.retired_at IS NULL
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
      'proposals', (SELECT count(*) FROM proposals),
      'retired', (SELECT count(*) FROM retired)),
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
      || coalesce((SELECT jsonb_object_agg(r.ref, jsonb_build_object('state', 'retired', 'citations', r.citations, 'due', NULL))
                     FROM retired r), '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.entry_detail(p_ref text)
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
      JOIN public.opportunities o ON o.id = s.opportunity_id AND NOT o.trial
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM k) THEN NULL ELSE jsonb_build_object(
    'entry', (SELECT jsonb_build_object(
        'id', k.id, 'ref', k.ref, 'question', k.question, 'answer', k.answer, 'tags', to_jsonb(k.tags),
        'source', k.source, 'origin', k.origin, 'createdBy', k.created_by, 'createdAt', k.created_at,
        'language', k.language, 'translatedFrom', to_jsonb(k.translated_from),
        'reviewedAt', k.reviewed_at, 'reviewedBy', k.reviewed_by, 'lastReviewedAt', k.last_reviewed_at,
        'due', k.due,
        'state', CASE WHEN k.superseded_by IS NOT NULL THEN 'replaced'
                      WHEN k.retired_at IS NOT NULL THEN 'retired'
                      WHEN k.proposed_replacement_of IS NOT NULL THEN 'proposal'
                      WHEN k.reviewed_at IS NULL AND k.translated_from IS NOT NULL THEN 'translation'
                      WHEN k.reviewed_at IS NULL THEN 'waiting'
                      WHEN k.due < now() THEN 'overdue' ELSE 'reviewed' END,
        'replacedBy', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.superseded_by),
        'proposalFor', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.proposed_replacement_of),
        'retiredAt', k.retired_at, 'retiredBy', k.retired_by, 'retiredReason', k.retired_reason)
      FROM k),
    'proposal', (SELECT jsonb_build_object('id', p.id, 'ref', p.ref, 'question', p.question, 'answer', p.answer,
                                           'source', p.source, 'createdBy', p.created_by, 'createdAt', p.created_at)
                   FROM k JOIN public.kb_entries p ON p.proposed_replacement_of = k.id AND p.superseded_by IS NULL AND p.retired_at IS NULL
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

CREATE OR REPLACE FUNCTION public.overdue_entries()
 RETURNS TABLE(id uuid, ref text, question text, answer text, tags text[], source text, origin public.kb_origin, origin_ref text, added_by text, created_at timestamp with time zone, last_reviewed_at timestamp with time zone, review_due timestamp with time zone, recent_citations bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can see the overdue-entries report' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source, k.origin, k.origin_ref, p.display_name,
         k.created_at, k.last_reviewed_at, access.entry_review_due(k),
         (SELECT count(*) FROM public.rfi_questions q
           WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days' AND NOT private.in_try(q.session_id))
    FROM public.kb_entries k
    LEFT JOIN public.user_profiles p ON p.id = k.created_by
   WHERE k.superseded_by IS NULL AND k.retired_at IS NULL
     AND access.entry_review_due(k) < now()
   ORDER BY access.entry_review_due(k) ASC,
            (SELECT count(*) FROM public.rfi_questions q
              WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days' AND NOT private.in_try(q.session_id)) DESC;
END;
$function$;
