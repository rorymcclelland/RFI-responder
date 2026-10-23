-- Sprint 6: fixes from the independent security review (docs/refinement/sprint-6.md).
--
-- 1. An owner exporting a question whose cited entry fell overdue after processing confirmed that
--    entry (its stored gate was empty), and the new release trigger then cleared other owners'
--    holds. record_export now decides from the entries' state at export.
-- 2. Signed-in users (admins included) could write an entry's question, answer and review date
--    directly, skipping review_entry and its log; a direct date change now also releases holds.
--    Those grants are removed: review_entry is the only way (admin only).
-- 9. cited_refs gets an index, and the release locks the questions it changes in a fixed order.
-- 10. Repeated refs are named once; a blank ref reads "an unknown entry" and still holds.

REVOKE UPDATE (question, answer, last_reviewed_at) ON public.kb_entries FROM authenticated;

CREATE INDEX IF NOT EXISTS rfi_questions_cited_refs ON public.rfi_questions USING gin (cited_refs);

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
         array_agg(refs.ref || ' (overdue for review since ' || to_char(public.entry_review_due(k), 'YYYY-MM-DD') || ')' ORDER BY refs.ord)
           FILTER (WHERE k.reviewed_at IS NOT NULL AND public.entry_review_due(k) < now())
    INTO unreviewed, overdue
    FROM refs
    LEFT JOIN public.kb_entries k ON k.ref = refs.ref AND refs.ref <> '';
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
  -- Lock the candidate questions in id order first, so two reviews at once cannot deadlock.
  PERFORM 1 FROM public.rfi_questions q
   WHERE q.status = 'pending' AND q.gate IN ('unreviewed_source', 'stale_source') AND q.cited_refs && p_refs
   ORDER BY q.id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.record_export(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sess          record;
  opp_name      text;
  pending       int;
  q             record;
  approver      uuid;
  top_ref       text;
  top_score     numeric;
  top_entry     uuid;
  limit_score   numeric;
  new_id        uuid;
  tags          text[];
  outcome       text;
  answer        text;
  replaces      uuid;
  n             jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO sess FROM public.rfi_sessions s WHERE s.id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR (sess.opportunity_id IS NOT NULL AND public.is_response_owner(sess.opportunity_id))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can record an export' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO pending FROM public.rfi_questions WHERE session_id = p_session AND status = 'pending';
  IF pending > 0 THEN
    RAISE EXCEPTION '% question(s) are still pending; accept or skip every question before exporting', pending
      USING ERRCODE = '42501';
  END IF;
  SELECT o.name INTO opp_name FROM public.opportunities o WHERE o.id = sess.opportunity_id;

  FOR q IN
    SELECT * FROM public.rfi_questions
     WHERE session_id = p_session AND status = 'accepted' AND learned_at IS NULL
     ORDER BY position
  LOOP
    new_id := NULL;
    answer := btrim(coalesce(q.final_answer, q.generated_answer, ''));
    SELECT a.decided_by INTO approver FROM public.approvals a
     WHERE a.question_id = q.id ORDER BY a.decided_at DESC LIMIT 1;
    approver := coalesce(approver, auth.uid());
    -- Allow list: only questions the server processed, in English, with no gate but legal.
    IF q.gate = 'pricing' THEN
      outcome := 'not_learned_pricing';
    ELSIF q.processed_at IS NULL THEN
      outcome := 'not_learned_unchecked';
    ELSIF q.language IS DISTINCT FROM 'en' OR q.gate = 'translation' OR q.question ~ '[ぁ-ヿ一-鿿]' THEN
      outcome := 'not_learned_japanese';
    -- Legal answers are learned (Sprint 3, Q3). The Sprint 4 source gates concern the entries a
    -- draft cited, not the question, and a person accepted the answer individually, so they are
    -- learned too; a learned entry then goes through the S4-3 review rule.
    ELSIF q.gate IS NOT NULL AND q.gate NOT IN ('legal', 'unreviewed_source', 'stale_source') THEN
      outcome := 'not_learned_unchecked';
    ELSIF length(answer) = 0 THEN
      outcome := 'not_learned_empty';
    ELSIF q.draft_kind IN ('generated', 'assembled') AND answer = btrim(q.generated_answer) THEN
      -- Security review, finding 2: a draft held because it cited an unreviewed or overdue entry
      -- confirms that entry only if an admin approved it; otherwise any member could clear an
      -- entry's review date by exporting from a response of their own.
      -- Sprint 6 review, finding 1: decided from the entries' state now, not only the stored gate,
      -- since an entry can fall overdue after processing (and a confirmation now releases holds).
      IF NOT public.user_is_admin(approver)
         AND (q.gate IN ('unreviewed_source', 'stale_source')
              OR (SELECT g.gate FROM private.source_gate(coalesce(q.cited_refs, '{}'::text[])) g) IS NOT NULL) THEN
        outcome := 'not_confirmed_source';
      ELSE
        -- F-25: only the entries the draft cited are confirmed (before Sprint 4, none were recorded).
        UPDATE public.kb_entries k SET last_reviewed_at = now()
         WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[])) AND k.superseded_by IS NULL;
        IF coalesce(cardinality(q.cited_refs), 0) > 0 THEN
          INSERT INTO public.audit_log (actor, action, target_id, details)
          VALUES (auth.uid(), 'kb.confirmed', q.id, jsonb_build_object('refs', to_jsonb(q.cited_refs), 'approver', approver));
        END IF;
        outcome := 'confirmed';
      END IF;
    ELSE
      top_ref := q.sources_json->0->>'id';
      top_score := (q.sources_json->0->>'score')::numeric;
      SELECT k.id INTO top_entry FROM public.kb_entries k WHERE k.ref = top_ref AND k.superseded_by IS NULL;
      SELECT t.threshold INTO limit_score FROM public.learning_thresholds t WHERE t.embedding_model = q.embedding_model;
      SELECT coalesce(array_agg(DISTINCT tag), '{}') INTO tags
        FROM (SELECT unnest(k.tags) AS tag FROM public.kb_entries k
               WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id')) t;

      new_id := gen_random_uuid();
      -- The entry this answer would replace: the current entry for the same question, or a
      -- near-duplicate the judge confirmed (Sprint 3). Proposals waiting for review are not targets.
      SELECT k.id INTO replaces FROM public.kb_entries k
       WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly') AND q.judge_best_ref = top_ref))
       ORDER BY (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))) DESC
       LIMIT 1;
      -- Security review, finding 1: only an admin's approval replaces an entry at once (and the
      -- new entry starts reviewed). Anyone else's answer becomes a proposed replacement that sits
      -- beside the entry, unreviewed, until an admin reviews it.
      IF replaces IS NULL THEN
        outcome := 'added';
      ELSIF public.user_is_admin(approver) THEN
        SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
        UPDATE public.kb_entries k SET superseded_by = new_id WHERE k.id = replaces;
        outcome := 'superseded';
      ELSE
        outcome := 'proposed';
      END IF;
      INSERT INTO public.kb_entries (id, question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of)
      VALUES (new_id, left(btrim(q.question), 5000), left(answer, 20000), tags[1:6],
              left('RFI response: ' || coalesce(opp_name, sess.file_name), 500), 'response',
              format('response:%s/session:%s/question:%s', sess.opportunity_id, p_session, q.id),
              approver, CASE WHEN outcome = 'proposed' THEN replaces END);
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
      replaces := NULL;
    END IF;
    UPDATE public.rfi_questions SET learned_at = now(), learn_outcome = outcome, learned_entry_id = new_id WHERE id = q.id;
    n := jsonb_set(n, ARRAY[outcome], to_jsonb(coalesce((n->>outcome)::int, 0) + 1));
  END LOOP;

  UPDATE public.rfi_sessions SET status = 'completed', exported_at = now() WHERE id = p_session;
  IF sess.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities SET exported_at = now(), updated_at = now() WHERE id = sess.opportunity_id;
  END IF;

  -- F-26: the response is sent, so open expert assignments are closed (kept for history).
  UPDATE public.question_assignments SET status = 'closed', completed_at = now(), updated_at = now()
   WHERE session_id = p_session AND status IN ('pending', 'in_review');
  GET DIAGNOSTICS pending = ROW_COUNT;
  IF pending > 0 THEN
    n := n || jsonb_build_object('assignments_closed', pending);
  END IF;

  n := n || jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'skipped'));
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.exported', p_session, n);
  RETURN n;
END;
$$;
