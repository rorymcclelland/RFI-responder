/*
  # Access control hardening (Sprint 0, after the independent security review)

  The review of 20261022120000_access_control.sql found, and tests in
  supabase/tests/db/hardening.test.ts reproduce:
  1. An owner could create an assignment on their own response and then move it
     (opportunity_id) onto someone else's; nothing tied session_id to opportunity_id.
  2. An assignee could rewrite assigned_by, session_id, question_text, created_at.
  3. Two admins removing each other at the same moment could leave no admin.
  4. Functions created later would be executable by anonymous visitors (through
     PUBLIC), and two trigger functions were.
  5. Any member could move a session onto another response.
  6. import_kb_entries had no limit on entries per call.
  7. Members held TRUNCATE (which ignores row-level security), TRIGGER and
     REFERENCES on tables, and UPDATE on sequences.

  Left as decided: sessions' questions stay team-editable until Sprint 3, and
  kb_entries.origin_ref is free text until learning at export (Sprint 3) sets it.
*/

-- ─── 1 and 2. Assignments: only the work can change, and it stays on its response ──

REVOKE UPDATE ON public.question_assignments FROM authenticated;
GRANT UPDATE (status, answer_text, notes, completed_at, updated_at)
  ON public.question_assignments TO authenticated;

DROP POLICY IF EXISTS "Assignee, owner or admin updates an assignment" ON public.question_assignments;
CREATE POLICY "Assignee, owner or admin updates an assignment"
  ON public.question_assignments FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid() OR public.is_response_owner(opportunity_id) OR public.is_admin())
  WITH CHECK (assigned_to = auth.uid() OR public.is_response_owner(opportunity_id) OR public.is_admin());

-- A question's session must belong to the response it is assigned under.
CREATE OR REPLACE FUNCTION public.check_assignment_session()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF NEW.session_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.rfi_sessions s
    WHERE s.id = NEW.session_id AND s.opportunity_id IS NOT DISTINCT FROM NEW.opportunity_id
  ) THEN
    RAISE EXCEPTION 'The session does not belong to this response' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER question_assignments_session_matches
  BEFORE INSERT OR UPDATE OF session_id, opportunity_id ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.check_assignment_session();

-- ─── 3. set_user_admin: serialise changes so one admin always remains ───────

CREATE OR REPLACE FUNCTION public.set_user_admin(target uuid, make_admin boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Lock every admin row first, so concurrent calls run one after the other
  -- and each sees the result of the one before.
  PERFORM 1 FROM public.user_profiles WHERE is_admin FOR UPDATE;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change admin rights' USING ERRCODE = '42501';
  END IF;
  IF NOT make_admin
     AND (SELECT count(*) FROM public.user_profiles WHERE is_admin) <= 1
     AND (SELECT is_admin FROM public.user_profiles WHERE id = target) THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles SET is_admin = make_admin, updated_at = now() WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such user' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (actor, action, target_id)
  VALUES (auth.uid(), CASE WHEN make_admin THEN 'user.admin_granted' ELSE 'user.admin_removed' END, target);
END;
$$;

-- ─── 4. Functions: nothing executable by default ────────────────────────────

-- Postgres grants EXECUTE on new functions to PUBLIC globally; a per-schema default
-- cannot take that away, so this must be the global form (for the migration role).
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at(), public.handle_new_user(), public.check_assignment_session()
  FROM PUBLIC, anon, authenticated;

-- ─── 5. Sessions stay with their response ───────────────────────────────────

REVOKE UPDATE ON public.rfi_sessions FROM authenticated;
GRANT UPDATE (status, accepted_count) ON public.rfi_sessions TO authenticated;

-- ─── 6. Bounded imports ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.import_kb_entries(
  entries     jsonb,
  entry_origin public.kb_origin,
  entry_origin_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  total      int;
  valid      int;
  inserted   int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to import' USING ERRCODE = '42501';
  END IF;
  IF entry_origin NOT IN ('import', 'response', 'manual') THEN
    RAISE EXCEPTION 'Origin % cannot be used for imports', entry_origin USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array' USING ERRCODE = '22023';
  END IF;

  total := jsonb_array_length(entries);
  -- Matches the 2,000-row upload limit in src/lib/spreadsheet.ts.
  IF total > 2000 THEN
    RAISE EXCEPTION 'Import at most 2,000 entries at a time' USING ERRCODE = '54000';
  END IF;

  WITH raw AS (
    SELECT ord,
           btrim(coalesce(e->>'question', '')) AS question,
           btrim(coalesce(e->>'answer', ''))   AS answer,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(e->'tags', '[]'::jsonb))), '{}') AS tags,
           left(btrim(coalesce(e->>'source', '')), 500) AS source
    FROM jsonb_array_elements(entries) WITH ORDINALITY AS t(e, ord)
  ),
  ok AS (
    SELECT *, lower(regexp_replace(question, '\s+', ' ', 'g')) AS key
    FROM raw
    WHERE length(question) BETWEEN 1 AND 5000 AND length(answer) BETWEEN 1 AND 20000
  ),
  first_of_each AS (
    SELECT DISTINCT ON (key) * FROM ok ORDER BY key, ord
  ),
  ins AS (
    INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref)
    SELECT f.question, f.answer, f.tags, f.source, entry_origin, entry_origin_ref
    FROM first_of_each f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.kb_entries k WHERE k.question_key = f.key AND k.superseded_by IS NULL
    )
    ORDER BY f.ord
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ok), (SELECT count(*) FROM ins) INTO valid, inserted;

  RETURN jsonb_build_object('inserted', inserted, 'duplicates', valid - inserted, 'invalid', total - valid);
END;
$$;

-- ─── 7. Table and sequence privileges the API never needs ───────────────────

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated;
REVOKE UPDATE ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE UPDATE ON SEQUENCES FROM authenticated;
