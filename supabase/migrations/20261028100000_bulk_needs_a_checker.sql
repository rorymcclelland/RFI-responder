-- Sprint 9, S9-1 (F-40; Rory, Q1). Bulk approval needs the checker's "yes" in every configuration.
-- With no checker configured, confidence comes from similarity alone, and cross-validated near misses
-- still reach the bulk line at every threshold (4 of 33 at 80%, 1 at 95%: the out-of-fold
-- predictions in docs/evals/calibration-2026-10-25.json). Such questions are now held and counted as heldNoChecker;
-- they can still be accepted one at a time. Tested in supabase/tests/db/sprint9.test.ts.

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
  held_partly       int;
  held_no_verdict   int;
  held_no_checker   int;
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

  -- Sprint 6 (F-28): check the cited entries live, so an entry that became unreviewed or fell
  -- overdue after processing holds its questions here too, with the reason shown on the card.
  WITH held AS (
    SELECT q.id, g.gate, g.reason
      FROM public.rfi_questions q
      CROSS JOIN LATERAL private.source_gate(q.cited_refs) g
     WHERE q.session_id = p_session AND q.status = 'pending' AND q.gate IS NULL
       AND cardinality(q.cited_refs) > 0 AND g.gate IS NOT NULL
  ), updated AS (
    UPDATE public.rfi_questions q SET gate = held.gate, gate_reason = held.reason
      FROM held WHERE q.id = held.id
    RETURNING q.id, q.gate
  )
  INSERT INTO public.audit_log (actor, action, target_id, details)
  SELECT auth.uid(), 'question.held', updated.id, jsonb_build_object('gate', updated.gate, 'by', 'bulk_accept')
    FROM updated;

  SELECT count(*) FILTER (WHERE q.gate IS NOT NULL),
         count(*) FILTER (WHERE q.gate IS NULL AND (q.confidence IS NULL OR q.processed_at IS NULL)),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND (q.draft_kind IS NULL OR q.draft_kind NOT IN ('generated', 'assembled'))),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence < p_min_confidence),
         -- Sprint 7 (F-33): drafted, calibrated and at the threshold, but the checker said only "partly" (or "no").
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence >= p_min_confidence
                            AND q.verdict IS NOT NULL AND q.verdict <> 'yes'),
         -- Security review, Sprint 7: a checker ran (a reranker) and gave a score but no verdict.
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence >= p_min_confidence
                            AND q.verdict IS NULL AND q.judge_model IS NOT NULL),
         -- Sprint 9 (F-40): no checker configured, so confidence comes from similarity alone.
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence >= p_min_confidence
                            AND q.verdict IS NULL AND q.judge_model IS NULL)
    INTO held_gated, held_uncalibrated, held_no_draft, below, held_partly, held_no_verdict, held_no_checker
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
     AND q.confidence >= p_min_confidence
     -- Only when the checker said the entries answer it (Sprint 7, F-33). Since Sprint 9 (F-40) that
     -- holds in every configuration: similarity alone lets near misses reach any threshold.
     AND q.verdict = 'yes';
  GET DIAGNOSTICS accepted = ROW_COUNT;
  DELETE FROM private.operations WHERE txid = txid_current() AND kind = 'bulk';

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below,
    'heldPartly', held_partly,
    'heldNoVerdict', held_no_verdict,
    'heldNoChecker', held_no_checker
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept(uuid, numeric) TO authenticated;
