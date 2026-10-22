-- Sprint 2, story S2-2a: scoring, gating and drafting move server-side, and the database
-- enforces what bulk approval may include (project rules 4 and 5; decision 0003).
--
-- Before this migration the browser computed confidence and wrote it, and bulk accept was a
-- browser-side update, so any signed-in user could save a question as 100% confident or
-- bulk-accept a pricing question. Now:
-- - members may insert only the question itself, and update only the review decision;
-- - the process-questions Edge Function writes scores, gates and drafts with the service role;
-- - an update that accepts more than one question at once must come from the response owner or
--   an admin, and may not include gated or uncalibrated questions;
-- - bulk_accept() is the app's way to do that, and reports what it held back.
-- Accepting a gated question individually stays possible: that is the human decision rule 4 asks for.

ALTER TABLE public.rfi_questions
  ADD COLUMN answerability    numeric,
  ADD COLUMN verdict          text CHECK (verdict IN ('yes', 'partly', 'no')),
  ADD COLUMN gate             text CHECK (gate IN ('pricing', 'legal', 'unchecked', 'translation')),
  ADD COLUMN gate_reason      text,
  ADD COLUMN language         text CHECK (language IN ('en', 'ja')),
  ADD COLUMN embedding_model  text,
  ADD COLUMN judge_model      text,
  ADD COLUMN draft_model      text,
  ADD COLUMN prompt_version   text,
  ADD COLUMN calibration_set  text,
  ADD COLUMN draft_kind       text CHECK (draft_kind IN ('generated', 'assembled', 'insufficient_evidence', 'person_required')),
  ADD COLUMN processing_note  text,
  ADD COLUMN processed_at     timestamptz;

COMMENT ON COLUMN public.rfi_questions.gate IS
  'Never bulk-approved: pricing, legal or contractual, unchecked (classifier unavailable), translation (Japanese draft). Written only by the service role.';

-- ─── Column rights ──────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE ON public.rfi_questions FROM authenticated;
GRANT INSERT (session_id, position, question) ON public.rfi_questions TO authenticated;
GRANT UPDATE (status, final_answer) ON public.rfi_questions TO authenticated;

-- ─── Bulk acceptance rules, enforced for every update ───────────────────────

CREATE OR REPLACE FUNCTION public.check_bulk_acceptance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  moved     int;
  blocked   int;
  sessions  int;
  opp       uuid;
BEGIN
  -- The service role (processing) and maintenance connections are not subject to review rules.
  IF coalesce(auth.role(), '') <> 'authenticated' THEN
    RETURN NULL;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE n.gate IS NOT NULL OR n.confidence IS NULL),
         count(DISTINCT n.session_id)
    INTO moved, blocked, sessions
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id
   WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted';

  IF moved <= 1 THEN
    RETURN NULL; -- one question accepted by a person: always allowed
  END IF;
  IF blocked > 0 THEN
    RAISE EXCEPTION 'Bulk approval cannot include pricing, legal, translated, unchecked or uncalibrated questions; accept those individually'
      USING ERRCODE = '42501';
  END IF;
  IF sessions > 1 THEN
    RAISE EXCEPTION 'Bulk approval works on one response session at a time' USING ERRCODE = '42501';
  END IF;

  SELECT s.opportunity_id INTO opp
    FROM public.rfi_sessions s
   WHERE s.id = (SELECT n.session_id FROM new_rows n WHERE n.status = 'accepted' LIMIT 1);
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can approve questions in bulk' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_bulk_acceptance() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER rfi_questions_bulk_acceptance
  AFTER UPDATE ON public.rfi_questions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.check_bulk_acceptance();

-- ─── bulk_accept: what the app calls ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_accept(p_session uuid, p_min_confidence numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  opp               uuid;
  accepted          int;
  held_gated        int;
  held_uncalibrated int;
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
         count(*) FILTER (WHERE q.gate IS NULL AND q.confidence IS NULL),
         count(*) FILTER (WHERE q.gate IS NULL AND q.confidence < p_min_confidence)
    INTO held_gated, held_uncalibrated, below
    FROM public.rfi_questions q
   WHERE q.session_id = p_session AND q.status = 'pending';

  UPDATE public.rfi_questions q
     SET status = 'accepted'
   WHERE q.session_id = p_session
     AND q.status = 'pending'
     AND q.gate IS NULL
     AND q.confidence IS NOT NULL
     AND q.confidence >= p_min_confidence;
  GET DIAGNOSTICS accepted = ROW_COUNT;

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'belowThreshold', below
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept(uuid, numeric) TO authenticated;
