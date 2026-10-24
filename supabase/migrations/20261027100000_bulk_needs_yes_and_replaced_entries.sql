-- Sprint 7, S7-1 (F-33) and S7-2 (F-32).
--
-- S7-1: bulk approval needs the checker's "yes" (Rory, refinement Q1). In the Sprint 6 run, "partly"
-- at or above 80% had the wrong top entry 4 times in 26 (15%), against 18 in 267 (7%) for "yes";
-- and a "partly" on a near miss could reach the bulk line. "Partly" and "no" are now accepted only
-- individually, and bulk_accept reports how many it held (heldPartly). A question calibrated on
-- similarity alone (no checker configured) has no verdict and keeps the earlier rule.
--
-- S7-2: a draft citing an entry that has since been replaced was written from outdated text. The
-- review check treats a replaced entry like an overdue one (gate stale_source, naming the
-- replacement), at processing (entry_review_status) and at bulk approval (private.source_gate).

CREATE OR REPLACE FUNCTION private.source_gate(p_refs text[])
RETURNS TABLE (gate text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  unreviewed text[];
  overdue    text[];
BEGIN
  -- Each ref once, in the order first cited; a blank ref matches no entry and counts as unreviewed,
  -- as a missing ref does in process-questions.
  WITH refs AS (
    SELECT coalesce(nullif(btrim(r.ref), ''), '') AS ref, min(r.ord) AS ord
      FROM unnest(coalesce(p_refs, '{}'::text[])) WITH ORDINALITY AS r(ref, ord)
     GROUP BY 1
  )
  SELECT array_agg(CASE WHEN refs.ref = '' THEN 'an unknown entry' ELSE refs.ref END ORDER BY refs.ord)
           FILTER (WHERE k.id IS NULL OR k.reviewed_at IS NULL),
         -- Sprint 7 (F-32): a replaced entry is out of date like an overdue one, whatever its dates.
         array_agg(CASE WHEN k.superseded_by IS NOT NULL
                        THEN refs.ref || ' (replaced by ' || coalesce(nk.ref, 'a newer entry') || ')'
                        ELSE refs.ref || ' (overdue for review since ' || to_char(public.entry_review_due(k), 'YYYY-MM-DD') || ')' END
                   ORDER BY refs.ord)
           FILTER (WHERE k.reviewed_at IS NOT NULL AND (k.superseded_by IS NOT NULL OR public.entry_review_due(k) < now()))
    INTO unreviewed, overdue
    FROM refs
    LEFT JOIN public.kb_entries k ON k.ref = refs.ref AND refs.ref <> ''
    LEFT JOIN public.kb_entries nk ON nk.id = k.superseded_by;
  IF cardinality(unreviewed) > 0 THEN
    RETURN QUERY SELECT 'unreviewed_source'::text,
      'Cites ' || array_to_string(unreviewed, ', ') || ', not reviewed by an admin yet, so it is reviewed individually.';
  ELSIF cardinality(overdue) > 0 THEN
    RETURN QUERY SELECT 'stale_source'::text,
      'Cites ' || array_to_string(overdue, ', ') || ', so it is reviewed individually.';
  ELSE
    RETURN QUERY SELECT NULL::text, NULL::text;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.source_gate(text[]) FROM PUBLIC, anon, authenticated;

-- entry_review_status gains the replacement, so processing gates on it too.
DROP FUNCTION public.entry_review_status(text[]);
CREATE FUNCTION public.entry_review_status(p_refs text[])
RETURNS TABLE (ref text, reviewed boolean, overdue_since date, replaced_by text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.ref, k.reviewed_at IS NOT NULL,
         CASE WHEN public.entry_review_due(k) < now() THEN public.entry_review_due(k)::date END,
         CASE WHEN k.superseded_by IS NOT NULL THEN coalesce(nk.ref, 'a newer entry') END
    FROM public.kb_entries k
    LEFT JOIN public.kb_entries nk ON nk.id = k.superseded_by
   WHERE k.ref = ANY (p_refs);
$$;
REVOKE ALL ON FUNCTION public.entry_review_status(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entry_review_status(text[]) TO service_role;

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
                            AND q.verdict IS NOT NULL AND q.verdict <> 'yes')
    INTO held_gated, held_uncalibrated, held_no_draft, below, held_partly
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
     -- Sprint 7 (F-33): only when the checker said the entries answer it. A question calibrated on
     -- similarity alone (no checker configured) has no verdict and keeps the earlier rule.
     AND (q.verdict = 'yes' OR q.verdict IS NULL);
  GET DIAGNOSTICS accepted = ROW_COUNT;
  DELETE FROM private.operations WHERE txid = txid_current() AND kind = 'bulk';

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below,
    'heldPartly', held_partly
  );
END;
$$;
REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bulk_accept(uuid, numeric) TO authenticated;
