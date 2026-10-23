-- Sprint 6, S6-4 (F-28): reviewing an entry releases the questions held for it, and bulk approval
-- checks the cited entries live (Rory, refinement Q4).
--
-- Before: a question gated 'unreviewed_source' or 'stale_source' kept its gate after the entry was
-- reviewed or confirmed, until it was processed again; and an entry that fell overdue (or lost its
-- review) after processing did not hold questions already processed.
--
-- private.source_gate(refs) gives the gate the cited entries call for now, with the same reasons
-- process-questions writes. A trigger on kb_entries (review or confirmation) recomputes the gate of
-- pending questions citing that entry, in responses neither exported nor archived; bulk_accept
-- applies the same check before it approves anything. Only these two paths change a gate here:
-- the functions live in the private schema, which signed-in users cannot reach.

CREATE OR REPLACE FUNCTION private.source_gate(p_refs text[])
RETURNS TABLE (gate text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  unreviewed text[];
  overdue    text[];
BEGIN
  -- A cited ref with no entry counts as unreviewed, as in process-questions.
  SELECT array_agg(r.ref ORDER BY r.ord) FILTER (WHERE k.id IS NULL OR k.reviewed_at IS NULL),
         array_agg(r.ref || ' (overdue for review since ' || to_char(public.entry_review_due(k), 'YYYY-MM-DD') || ')' ORDER BY r.ord)
           FILTER (WHERE k.reviewed_at IS NOT NULL AND public.entry_review_due(k) < now())
    INTO unreviewed, overdue
    FROM unnest(p_refs) WITH ORDINALITY AS r(ref, ord)
    LEFT JOIN public.kb_entries k ON k.ref = r.ref;
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

CREATE OR REPLACE FUNCTION private.release_source_gates(p_refs text[])
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n int;
BEGIN
  WITH candidates AS (
    SELECT q.id, q.gate AS old_gate, g.gate AS new_gate, g.reason
      FROM public.rfi_questions q
      JOIN public.rfi_sessions s ON s.id = q.session_id
      LEFT JOIN public.opportunities o ON o.id = s.opportunity_id
      CROSS JOIN LATERAL private.source_gate(q.cited_refs) g
     WHERE q.status = 'pending'
       AND q.gate IN ('unreviewed_source', 'stale_source')
       AND q.cited_refs && p_refs
       AND s.status <> 'completed' AND s.exported_at IS NULL
       AND (o.id IS NULL OR o.archived_at IS NULL)
  ), changed AS (
    UPDATE public.rfi_questions q SET gate = c.new_gate, gate_reason = c.reason
      FROM candidates c
     WHERE q.id = c.id AND (c.new_gate IS DISTINCT FROM c.old_gate OR q.gate_reason IS DISTINCT FROM c.reason)
    RETURNING q.id, c.old_gate, c.new_gate
  )
  INSERT INTO public.audit_log (actor, action, target_id, details)
  SELECT auth.uid(), CASE WHEN new_gate IS NULL THEN 'question.released' ELSE 'question.held' END, id,
         jsonb_build_object('from', old_gate, 'to', new_gate, 'refs', to_jsonb(p_refs))
    FROM changed;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION private.release_source_gates(text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.on_entry_reviewed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM private.release_source_gates(ARRAY[NEW.ref]);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.on_entry_reviewed() FROM PUBLIC, anon, authenticated;

-- Review (review_entry) and confirmation at export both move these dates forward.
CREATE TRIGGER kb_entries_release_held_questions
  AFTER UPDATE OF reviewed_at, last_reviewed_at ON public.kb_entries
  FOR EACH ROW
  WHEN (NEW.reviewed_at IS NOT NULL AND (OLD.reviewed_at IS DISTINCT FROM NEW.reviewed_at OR OLD.last_reviewed_at IS DISTINCT FROM NEW.last_reviewed_at))
  EXECUTE FUNCTION private.on_entry_reviewed();

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
