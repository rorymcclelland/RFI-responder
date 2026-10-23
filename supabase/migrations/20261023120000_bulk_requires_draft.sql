-- Sprint 2, found in the end-to-end run of 23 October 2026: a question can have high confidence
-- but no draft (the drafting call failed, or the drafter judged the evidence insufficient). Bulk
-- approval at a threshold would then have accepted the "Insufficient evidence" text as the answer.
-- Bulk approval now also requires a draft: draft_kind 'generated' or 'assembled'.

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
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
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

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below
  );
END;
$$;
