-- Sprint 5: F-29 (a realistic reserve per question) and F-26 (close assignments at export).

-- ─── F-29 ───────────────────────────────────────────────────────────────────
-- Measured in the Sprint 4 end-to-end run: about $0.0005 per question with Claude Haiku 5.5.
-- $0.002 keeps a fourfold margin. A value an admin has already changed is left alone.
ALTER TABLE public.ai_settings ALTER COLUMN est_usd_per_question SET DEFAULT 0.002;
UPDATE public.ai_settings SET est_usd_per_question = 0.002 WHERE est_usd_per_question = 0.01;

-- The usage report gains the measured average cost per processed question this month, so an
-- admin can see whether the reserve is still sensible.
CREATE OR REPLACE FUNCTION public.usage_report()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rate      numeric := (SELECT gbp_per_usd FROM public.ai_settings);
  processed bigint;
  proc_cost numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can see the usage report' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO processed FROM public.rfi_questions WHERE processed_at >= date_trunc('month', now());
  SELECT coalesce(sum(cost_usd), 0) INTO proc_cost FROM public.ai_usage
   WHERE function = 'process-questions' AND at >= date_trunc('month', now());
  RETURN jsonb_build_object(
    'byUser', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'spentGbp' DESC) FROM (
        SELECT jsonb_build_object('userId', u.user_id, 'name', p.display_name, 'calls', count(*),
                                  'spentGbp', round(coalesce(sum(u.cost_usd), 0) * rate, 4)) AS x
          FROM public.ai_usage u LEFT JOIN public.user_profiles p ON p.id = u.user_id
         WHERE u.at >= date_trunc('month', now())
         GROUP BY u.user_id, p.display_name) t), '[]'::jsonb),
    'byModel', coalesce((
      SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('provider', u.provider, 'model', u.model, 'kind', u.kind, 'calls', count(*),
                                  'inputTokens', sum(u.input_tokens), 'outputTokens', sum(u.output_tokens),
                                  'spentGbp', round(coalesce(sum(u.cost_usd), 0) * rate, 4)) AS x
          FROM public.ai_usage u
         WHERE u.at >= date_trunc('month', now())
         GROUP BY u.provider, u.model, u.kind) t), '[]'::jsonb),
    'unpricedCalls', (SELECT count(*) FROM public.ai_usage u WHERE u.cost_usd IS NULL AND u.at >= date_trunc('month', now())),
    'questionsProcessed', processed,
    'avgUsdPerQuestion', CASE WHEN processed > 0 THEN proc_cost / processed END);
END;
$$;

-- ─── F-26 ───────────────────────────────────────────────────────────────────
ALTER TABLE public.question_assignments DROP CONSTRAINT IF EXISTS question_assignments_status_check;
ALTER TABLE public.question_assignments ADD CONSTRAINT question_assignments_status_check
  CHECK (status IN ('pending', 'in_review', 'answered', 'approved', 'closed'));

-- Only the export (record_export, which runs as the database owner) closes an assignment, and a
-- closed one stays closed. SECURITY INVOKER, so current_user is the role making the change.
CREATE OR REPLACE FUNCTION public.guard_closed_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;
  IF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed') THEN
    RAISE EXCEPTION 'Assignments are closed by recording the export' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
    RAISE EXCEPTION 'This assignment was closed when the response was exported' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER question_assignments_guard_closed BEFORE INSERT OR UPDATE ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_assignments();

-- record_export closes open assignments (otherwise as in 20261024140000).
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
      IF q.gate IN ('unreviewed_source', 'stale_source') AND NOT public.user_is_admin(approver) THEN
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
