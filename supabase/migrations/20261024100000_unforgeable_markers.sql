-- Sprint 4, story S4-2 (F-24): markers for bulk approval and response deletion that cannot be forged.
--
-- Sprint 3 told the triggers "this is a bulk approval" or "this is an admin deleting a response"
-- through transaction settings (set_config('app.bulk_threshold') and 'app.deleting_response').
-- Anyone with a direct SQL connection as a member can set those too (Sprint 3 security review).
-- The markers are now rows in a private table that members have no rights on, written only by
-- bulk_accept() and delete_response() (both SECURITY DEFINER) and keyed on the transaction id.
--
-- bulk_accept() becomes SECURITY DEFINER so it can write the marker. Its own checks (owner or
-- admin; only processed, drafted, ungated, calibrated questions at or above the threshold) are
-- unchanged and are now the only route to a multi-row accept.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE private.operations (
  txid   bigint NOT NULL DEFAULT txid_current(),
  kind   text   NOT NULL CHECK (kind IN ('bulk', 'deleting_response')),
  value  text   NOT NULL,
  PRIMARY KEY (txid, kind)
);
REVOKE ALL ON private.operations FROM PUBLIC, anon, authenticated;

-- Read-only view of the current transaction's marker, for the triggers (some run as the caller).
CREATE OR REPLACE FUNCTION public.current_operation(p_kind text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT o.value FROM private.operations o WHERE o.txid = txid_current() AND o.kind = p_kind;
$$;
REVOKE ALL ON FUNCTION public.current_operation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_operation(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  bulk text := public.current_operation('bulk');
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    INSERT INTO public.approvals (question_id, session_id, opportunity_id, decided_by, kind, threshold, confidence,
                                  gate, final_answer, judge_model, draft_model, prompt_version, calibration_set)
    VALUES (NEW.id, NEW.session_id, public.response_of_session(NEW.session_id), auth.uid(),
            CASE WHEN bulk IS NULL THEN 'individual' ELSE 'bulk' END, bulk::numeric, NEW.confidence,
            NEW.gate, coalesce(NEW.final_answer, NEW.generated_answer), NEW.judge_model, NEW.draft_model,
            NEW.prompt_version, NEW.calibration_set);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_bulk_acceptance()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  moved     int;
  changed   int;
  blocked   int;
  sessions  int;
  opp       uuid;
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'),
         count(*) FILTER (WHERE n.status IS DISTINCT FROM o.status OR n.final_answer IS DISTINCT FROM o.final_answer),
         count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'
                            AND (n.gate IS NOT NULL OR n.confidence IS NULL OR n.processed_at IS NULL
                                 OR n.draft_kind IS NULL OR n.draft_kind NOT IN ('generated', 'assembled'))),
         count(DISTINCT n.session_id)
    INTO moved, changed, blocked, sessions
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id;

  IF changed <= 1 THEN
    RETURN NULL;
  END IF;
  IF moved > 1 AND public.current_operation('bulk') IS NULL THEN
    RAISE EXCEPTION 'Accept several questions at once with bulk approval, so the decision is recorded'
      USING ERRCODE = '42501';
  END IF;
  IF moved > 1 AND blocked > 0 THEN
    RAISE EXCEPTION 'Bulk approval cannot include pricing, legal, translated, unchecked, unprocessed, uncalibrated or undrafted questions; accept those individually'
      USING ERRCODE = '42501';
  END IF;
  IF sessions > 1 THEN
    RAISE EXCEPTION 'Bulk changes work on one response session at a time' USING ERRCODE = '42501';
  END IF;

  SELECT s.opportunity_id INTO opp
    FROM public.rfi_sessions s
   WHERE s.id = (SELECT n.session_id FROM new_rows n LIMIT 1);
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can change several questions at once' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_accept(p_session uuid, p_min_confidence numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  opp               uuid;
  accepted          int;
  held_gated        int;
  held_uncalibrated int;
  held_no_draft     int;
  below             int;
BEGIN
  IF p_min_confidence IS NULL OR p_min_confidence < 0 OR p_min_confidence > 1 THEN
    RAISE EXCEPTION 'The confidence threshold must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  SELECT s.opportunity_id INTO opp FROM public.rfi_sessions s WHERE s.id = p_session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can approve questions in bulk' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE q.gate IS NOT NULL),
         count(*) FILTER (WHERE q.gate IS NULL AND (q.confidence IS NULL OR q.processed_at IS NULL)),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND (q.draft_kind IS NULL OR q.draft_kind NOT IN ('generated', 'assembled'))),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence < p_min_confidence)
    INTO held_gated, held_uncalibrated, held_no_draft, below
    FROM public.rfi_questions q
   WHERE q.session_id = p_session AND q.status = 'pending';

  -- Marks this transaction's acceptances as bulk, with the threshold (read by record_approval).
  -- The marker is a row only this function can write (F-24), removed before it returns.
  INSERT INTO private.operations (kind, value) VALUES ('bulk', p_min_confidence::text);
  UPDATE public.rfi_questions q
     SET status = 'accepted'
   WHERE q.session_id = p_session
     AND q.status = 'pending'
     AND q.gate IS NULL
     AND q.processed_at IS NOT NULL
     AND q.draft_kind IN ('generated', 'assembled')
     AND q.confidence IS NOT NULL
     AND q.confidence >= p_min_confidence;
  GET DIAGNOSTICS accepted = ROW_COUNT;
  DELETE FROM private.operations WHERE txid = txid_current() AND kind = 'bulk';

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept(uuid, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.refuse_if_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  row_json jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  opp      uuid;
BEGIN
  IF TG_TABLE_NAME = 'rfi_questions' THEN
    opp := public.response_of_session((row_json->>'session_id')::uuid);
  ELSE
    opp := (row_json->>'opportunity_id')::uuid; -- rfi_sessions, question_assignments
  END IF;
  -- An admin deleting a response created in error is the one change allowed.
  IF opp IS NOT NULL AND public.current_operation('deleting_response') IS DISTINCT FROM opp::text
     AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opp AND o.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This response is archived and can no longer be changed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_response(p_response uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r       record;
  details jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can delete a response' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Give a reason of at least 10 characters: deletion is only for responses created in error'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.opportunities WHERE id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  details := jsonb_build_object(
    'name', r.name, 'reason', left(btrim(p_reason), 500), 'owner', r.owner_id,
    'sessions', (SELECT count(*) FROM public.rfi_sessions WHERE opportunity_id = p_response),
    'questions', (SELECT count(*) FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
                   WHERE s.opportunity_id = p_response));
  INSERT INTO public.audit_log (actor, action, target_id, details) VALUES (auth.uid(), 'response.deleted', p_response, details);
  INSERT INTO private.operations (kind, value) VALUES ('deleting_response', p_response::text);
  DELETE FROM public.rfi_sessions WHERE opportunity_id = p_response;
  DELETE FROM public.opportunities WHERE id = p_response;
  DELETE FROM private.operations WHERE txid = txid_current() AND kind = 'deleting_response';
END;
$$;
