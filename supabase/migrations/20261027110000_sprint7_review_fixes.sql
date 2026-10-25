-- Fixes from the security review of Sprint 7. Tests in supabase/tests/db/sprint7.test.ts.
--
-- Finding 1. Bulk approval treated every question with no checker
-- verdict as calibrated on similarity alone. A reranker checker (ANSWERABILITY_CHECKER=rerank-2.5)
-- records its model but gives a score, not a verdict, so its questions were approved in bulk without
-- a "yes". Now only a question with no checker recorded keeps the earlier rule; the rest are held and
-- counted as heldNoVerdict (S7-1 test 7).

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
                            AND q.verdict IS NULL AND q.judge_model IS NOT NULL)
    INTO held_gated, held_uncalibrated, held_no_draft, below, held_partly, held_no_verdict
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
     -- Sprint 7 (F-33): only when the checker said the entries answer it. Only a question calibrated
     -- on similarity alone (no checker recorded) keeps the earlier rule; a reranker's score is not a "yes".
     AND (q.verdict = 'yes' OR (q.verdict IS NULL AND q.judge_model IS NULL));
  GET DIAGNOSTICS accepted = ROW_COUNT;
  DELETE FROM private.operations WHERE txid = txid_current() AND kind = 'bulk';

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below,
    'heldPartly', held_partly,
    'heldNoVerdict', held_no_verdict
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept(uuid, numeric) TO authenticated;

-- Finding 3. A question with no draft carries a placeholder ("Insufficient evidence: ...", or the
-- pricing note) where a draft would be. Accepting it unedited sent the placeholder to the customer,
-- labelled the export "written by a person", and taught the knowledge base the placeholder as a new
-- entry (learning skips unedited text only for model drafts). It is now refused for everyone: a
-- person must write the answer first.
CREATE OR REPLACE FUNCTION private.refuse_unwritten_placeholder()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted'
     AND NEW.draft_kind IN ('insufficient_evidence', 'person_required')
     AND (btrim(coalesce(NEW.final_answer, '')) = ''
          OR btrim(NEW.final_answer) = btrim(coalesce(NEW.generated_answer, ''))) THEN
    RAISE EXCEPTION 'This question has no draft: it needs an answer written by a person before it can be accepted'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.refuse_unwritten_placeholder() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS refuse_unwritten_placeholder ON public.rfi_questions;
CREATE TRIGGER refuse_unwritten_placeholder
  BEFORE UPDATE OF status ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION private.refuse_unwritten_placeholder();
