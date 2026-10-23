-- Sprint 4, story S4-4: review dates, the overdue-entries report, and F-25.
--
-- An entry falls due for review a set number of months (ai_settings.review_interval_months,
-- default 12) after its last review or confirmation (entry_review_due, S4-3). Drafts citing an
-- overdue entry are gated 'stale_source' by process-questions and never bulk-approved. Admins
-- see overdue entries in overdue_entries() and mark them reviewed with review_entry().
--
-- record_export changes: unedited drafts confirm only the entries they cited (F-25), and answers
-- whose drafts carried a source gate are learned like any other individually accepted answer.

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
      -- F-25: only the entries the draft cited are confirmed (before Sprint 4, none were recorded).
      UPDATE public.kb_entries k SET last_reviewed_at = now()
       WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[]));
      outcome := 'confirmed';
    ELSE
      SELECT a.decided_by INTO approver FROM public.approvals a
       WHERE a.question_id = q.id ORDER BY a.decided_at DESC LIMIT 1;
      top_ref := q.sources_json->0->>'id';
      top_score := (q.sources_json->0->>'score')::numeric;
      SELECT k.id INTO top_entry FROM public.kb_entries k WHERE k.ref = top_ref AND k.superseded_by IS NULL;
      SELECT t.threshold INTO limit_score FROM public.learning_thresholds t WHERE t.embedding_model = q.embedding_model;
      SELECT coalesce(array_agg(DISTINCT tag), '{}') INTO tags
        FROM (SELECT unnest(k.tags) AS tag FROM public.kb_entries k
               WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id')) t;

      new_id := gen_random_uuid();
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
      outcome := 'added';
      UPDATE public.kb_entries k SET superseded_by = new_id
       WHERE k.superseded_by IS NULL
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly') AND q.judge_best_ref = top_ref));
      IF FOUND THEN
        outcome := 'superseded';
      END IF;
      INSERT INTO public.kb_entries (id, question, answer, tags, source, origin, origin_ref, created_by)
      VALUES (new_id, left(btrim(q.question), 5000), left(answer, 20000), tags[1:6],
              left('RFI response: ' || coalesce(opp_name, sess.file_name), 500), 'response',
              format('response:%s/session:%s/question:%s', sess.opportunity_id, p_session, q.id),
              coalesce(approver, auth.uid()));
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
    END IF;
    UPDATE public.rfi_questions SET learned_at = now(), learn_outcome = outcome, learned_entry_id = new_id WHERE id = q.id;
    n := jsonb_set(n, ARRAY[outcome], to_jsonb(coalesce((n->>outcome)::int, 0) + 1));
  END LOOP;

  UPDATE public.rfi_sessions SET status = 'completed', exported_at = now() WHERE id = p_session;
  IF sess.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities SET exported_at = now(), updated_at = now() WHERE id = sess.opportunity_id;
  END IF;

  n := n || jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'skipped'));
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.exported', p_session, n);
  RETURN n;
END;
$$;


CREATE OR REPLACE FUNCTION public.overdue_entries()
RETURNS TABLE (id uuid, ref text, question text, answer text, tags text[], source text, origin public.kb_origin,
               origin_ref text, added_by text, created_at timestamptz, last_reviewed_at timestamptz,
               review_due timestamptz, recent_citations bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can see the overdue-entries report' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source, k.origin, k.origin_ref, p.display_name,
         k.created_at, k.last_reviewed_at, public.entry_review_due(k),
         (SELECT count(*) FROM public.rfi_questions q
           WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days')
    FROM public.kb_entries k
    LEFT JOIN public.user_profiles p ON p.id = k.created_by
   WHERE k.superseded_by IS NULL
     AND public.entry_review_due(k) < now()
   ORDER BY public.entry_review_due(k) ASC,
            (SELECT count(*) FROM public.rfi_questions q
              WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days') DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.overdue_entries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.overdue_entries() TO authenticated;
