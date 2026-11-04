-- Sprint 24 security review (S24-1). Tests: supabase/tests/db/sprint24.test.ts, "security review".

-- M1: a file added while the response is being marked as sent waited for the export and then went
-- in, leaving the response Sent with an unsent file. The check now reads the response with a lock,
-- so it waits for an export in flight and then sees it.
CREATE OR REPLACE FUNCTION private.no_file_once_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sent timestamptz;
BEGIN
  IF NEW.opportunity_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id) THEN
    SELECT o.exported_at INTO sent FROM public.opportunities o WHERE o.id = NEW.opportunity_id FOR SHARE;
    IF sent IS NOT NULL THEN
      RAISE EXCEPTION 'This response has been marked as sent, so no file can be added to it; a later questionnaire is a new response'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.no_file_once_sent() FROM PUBLIC, anon, authenticated;

-- M2 (a): no question is added to a file once it is sent (it would be a question still to do in a
-- response called Sent). The file is read with a lock, as above.
CREATE OR REPLACE FUNCTION private.no_question_once_sent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sent timestamptz;
BEGIN
  SELECT s.exported_at INTO sent FROM public.rfi_sessions s WHERE s.id = NEW.session_id FOR SHARE;
  IF sent IS NOT NULL THEN
    RAISE EXCEPTION 'This file has been marked as sent, so no question can be added to it'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.no_question_once_sent() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER rfi_questions_no_question_once_sent BEFORE INSERT ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION private.no_question_once_sent();

-- Info: bulk approval checks the threshold and returns counts even for a response with no file.
CREATE OR REPLACE FUNCTION public.bulk_accept_response(p_response uuid, p_min_confidence numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f record;
  n jsonb := jsonb_build_object('accepted', 0, 'heldGated', 0, 'heldUncalibrated', 0, 'heldNoDraft', 0,
                                'belowThreshold', 0, 'heldPartly', 0, 'heldNoVerdict', 0, 'heldNoChecker', 0);
BEGIN
  IF p_min_confidence IS NULL OR p_min_confidence < 0 OR p_min_confidence > 1 THEN
    RAISE EXCEPTION 'The confidence threshold must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
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

-- M2 (b): a file still being uploaded (fewer questions saved than it said it has) is not sent.
-- Info: a response whose files are all sent but which is not itself marked (reachable only with the
-- service role) is marked, rather than refused for good as "nothing has changed".
CREATE OR REPLACE FUNCTION public.record_response_export(p_response uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f       record;
  pending int;
  files   int := 0;
  short   text;
  n       jsonb := '{}'::jsonb;
BEGIN
  PERFORM 1 FROM public.opportunities o WHERE o.id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (access.is_admin() OR access.is_response_owner(p_response)) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can record an export' USING ERRCODE = '42501';
  END IF;
  -- The files are locked before they are counted, so none changes underneath.
  PERFORM 1 FROM public.rfi_sessions s WHERE s.opportunity_id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This response has no file to send' USING ERRCODE = '42501';
  END IF;
  SELECT s.file_name INTO short FROM public.rfi_sessions s
   WHERE s.opportunity_id = p_response
     AND (SELECT count(*) FROM public.rfi_questions q WHERE q.session_id = s.id) < s.question_count
   LIMIT 1;
  IF short IS NOT NULL THEN
    RAISE EXCEPTION 'The file % is still being added: not all its questions are saved yet. Wait for it, then mark the response as sent', short
      USING ERRCODE = '42501';
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
    IF EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = p_response AND o.exported_at IS NULL) THEN
      UPDATE public.opportunities SET exported_at = now(), updated_at = now() WHERE id = p_response;
    ELSE
      RAISE EXCEPTION 'Nothing has changed since this response was marked as sent' USING ERRCODE = '42501';
    END IF;
  END IF;
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
