-- Sprint 24 (S24-1, U-11): one response, one list, sent as a whole. Test numbers refer to
-- docs/refinement/sprint-24.md; the tests are supabase/tests/db/sprint24.test.ts.
--
-- Rory's answers (4 November 2026): Q3, one Mark as sent for the whole response, when every question
-- in every file is decided, in one transaction; Q4, no file is added to a response once it is sent.
-- The per-file functions (record_export, bulk_accept) stay, for what they already recorded and for
-- the whole-response functions to call; the app no longer calls them.

-- ── A response is sent only when every file of it is (case 5) ──────────────────────────────────
-- record_export marks the file, then the response. Here the response's mark waits until no file of
-- it is unsent, however the export was recorded.
CREATE OR REPLACE FUNCTION private.sent_when_every_file_is()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.exported_at IS NOT NULL AND OLD.exported_at IS NULL
     AND EXISTS (SELECT 1 FROM public.rfi_sessions s WHERE s.opportunity_id = NEW.id AND s.exported_at IS NULL) THEN
    NEW.exported_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sent_when_every_file_is() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER opportunities_sent_when_every_file_is BEFORE UPDATE OF exported_at ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION private.sent_when_every_file_is();

-- A response marked as sent before Sprint 24 while one of its files was unsent is not sent: its
-- mark is cleared (a correction of a derived field; no row is added). Archived responses are kept
-- as recorded.
UPDATE public.opportunities o SET exported_at = NULL
 WHERE o.exported_at IS NOT NULL AND o.archived_at IS NULL
   AND EXISTS (SELECT 1 FROM public.rfi_sessions s WHERE s.opportunity_id = o.id AND s.exported_at IS NULL);

-- ── No file is added to a sent response (case 8, Q4) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.no_file_once_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id)
     AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = NEW.opportunity_id AND o.exported_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This response has been marked as sent, so no file can be added to it; a later questionnaire is a new response'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.no_file_once_sent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rfi_sessions_no_file_once_sent BEFORE INSERT OR UPDATE OF opportunity_id ON public.rfi_sessions
  FOR EACH ROW EXECUTE FUNCTION private.no_file_once_sent();

-- ── Adding up the per-file reports ─────────────────────────────────────────────────────────────
-- Every number in b is added to a's (both are the per-file functions' reports: counts only).
CREATE OR REPLACE FUNCTION private.add_counts(a jsonb, b jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(a, '{}'::jsonb) || coalesce(
    (SELECT jsonb_object_agg(e.key, coalesce((a->>e.key)::numeric, 0) + (e.value)::text::numeric)
       FROM jsonb_each(coalesce(b, '{}'::jsonb)) e WHERE jsonb_typeof(e.value) = 'number'), '{}'::jsonb);
$$;
REVOKE ALL ON FUNCTION private.add_counts(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- ── Bulk approval across the response (case 3) ─────────────────────────────────────────────────
-- Each file by the same rules as bulk_accept (which checks the cited entries again and holds what it
-- must); the counts are the whole response's.
CREATE OR REPLACE FUNCTION public.bulk_accept_response(p_response uuid, p_min_confidence numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f record;
  n jsonb := '{}'::jsonb;
BEGIN
  PERFORM 1 FROM public.opportunities o WHERE o.id = p_response;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (access.is_admin() OR access.is_response_owner(p_response)) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can approve questions in bulk' USING ERRCODE = '42501';
  END IF;
  FOR f IN SELECT id FROM public.rfi_sessions WHERE opportunity_id = p_response ORDER BY created_at, id LOOP
    n := private.add_counts(n, public.bulk_accept(f.id, p_min_confidence));
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_accept_response(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept_response(uuid, numeric) TO authenticated;

-- ── Mark as sent, for the whole response (cases 4 and 6) ───────────────────────────────────────
-- Refused while any question in any file is to do. Records every file not yet sent, or changed since
-- it was, by record_export's rules (learning, closing assignments, the audit log), all in this one
-- transaction: if any file is refused, nothing is recorded.
CREATE OR REPLACE FUNCTION public.record_response_export(p_response uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f       record;
  pending int;
  files   int := 0;
  n       jsonb := '{}'::jsonb;
BEGIN
  PERFORM 1 FROM public.opportunities o WHERE o.id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (access.is_admin() OR access.is_response_owner(p_response)) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can record an export' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rfi_sessions WHERE opportunity_id = p_response) THEN
    RAISE EXCEPTION 'This response has no file to send' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO pending
    FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
   WHERE s.opportunity_id = p_response AND q.status = 'pending';
  IF pending > 0 THEN
    RAISE EXCEPTION '% question(s) in this response are still to do; approve or leave unanswered every question in every file before marking it as sent', pending
      USING ERRCODE = '42501';
  END IF;
  FOR f IN
    SELECT id FROM public.rfi_sessions
     WHERE opportunity_id = p_response AND (exported_at IS NULL OR changed_since_export_at IS NOT NULL)
     ORDER BY created_at, id
  LOOP
    n := private.add_counts(n, public.record_export(f.id));
    files := files + 1;
  END LOOP;
  IF files = 0 THEN
    RAISE EXCEPTION 'Nothing has changed since this response was marked as sent' USING ERRCODE = '42501';
  END IF;
  -- The totals are the whole response's, not only the files recorded now.
  RETURN n || jsonb_build_object(
    'files', files,
    'accepted', (SELECT count(*) FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
                  WHERE s.opportunity_id = p_response AND q.status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
                  WHERE s.opportunity_id = p_response AND q.status = 'skipped'));
END;
$$;
REVOKE ALL ON FUNCTION public.record_response_export(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_response_export(uuid) TO authenticated;
