-- Sprint 22 security review of 20261109100000 (already applied on staging, so changed here).
--
-- M1: both functions ran with the caller's rights, so the audit log's rule (admins only) was checked
-- row by row: a member got nothing, but only after the whole log had been read. They now check once,
-- at the start, and a caller who is not an admin gets the empty answer at once. They still run with
-- the caller's rights, so the table's rule applies as well.
-- M2: the response filter is now an array of ids, which the target index serves; the people list
-- walks the actor index one person at a time instead of reading every row.
-- Low 5: a price's source is shown as a link, so it must be an https address.

CREATE OR REPLACE FUNCTION public.audit_log_search(p_actions text[], p_actor uuid, p_response uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  n       integer := least(greatest(coalesce(p_limit, 200), 1), 200);
  targets uuid[];
  found   jsonb;
  more    boolean;
BEGIN
  IF NOT coalesce(access.is_admin(), false) THEN
    RETURN jsonb_build_object('rows', '[]'::jsonb, 'more', false);
  END IF;
  -- A response's rows are those about it, its files and its questions.
  IF p_response IS NOT NULL THEN
    targets := ARRAY(
      SELECT p_response
      UNION ALL SELECT s.id FROM public.rfi_sessions s WHERE s.opportunity_id = p_response
      UNION ALL SELECT q.id FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
                 WHERE s.opportunity_id = p_response);
  END IF;
  WITH hits AS (
    SELECT a.id, a.at, a.action, a.actor_ref, a.target_id, a.details
      FROM public.audit_log a
     WHERE (p_actions IS NULL OR a.action = ANY (p_actions))
       AND (p_actor IS NULL OR a.actor_ref = p_actor)
       AND (targets IS NULL OR a.target_id = ANY (targets))
     ORDER BY a.at DESC, a.id DESC
     LIMIT n + 1
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'at', x.at, 'action', x.action, 'actor', x.actor_ref, 'actorName', p.display_name,
           'targetId', x.target_id, 'details', x.details) ORDER BY x.at DESC, x.id DESC)
           FILTER (WHERE x.rn <= n), '[]'::jsonb),
         count(*) > n
    INTO found, more
    FROM (SELECT h.*, row_number() OVER (ORDER BY h.at DESC, h.id DESC) AS rn FROM hits h) x
    LEFT JOIN public.user_profiles p ON p.id = x.actor_ref;
  RETURN jsonb_build_object('rows', found, 'more', more);
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_log_people()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  people jsonb;
BEGIN
  IF NOT coalesce(access.is_admin(), false) THEN
    RETURN '[]'::jsonb;
  END IF;
  -- Each distinct person, found by jumping along the actor index rather than reading every row.
  WITH RECURSIVE actors(id) AS (
    (SELECT a.actor_ref FROM public.audit_log a WHERE a.actor_ref IS NOT NULL ORDER BY a.actor_ref LIMIT 1)
    UNION ALL
    SELECT (SELECT a.actor_ref FROM public.audit_log a WHERE a.actor_ref > actors.id ORDER BY a.actor_ref LIMIT 1)
      FROM actors WHERE actors.id IS NOT NULL
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', p.display_name)
                            ORDER BY p.display_name NULLS LAST, x.id), '[]'::jsonb)
    INTO people
    FROM actors x LEFT JOIN public.user_profiles p ON p.id = x.id
   WHERE x.id IS NOT NULL;
  RETURN people;
END;
$$;

ALTER TABLE public.ai_prices ADD CONSTRAINT ai_prices_source_https CHECK (source_url ~ '^https://');
