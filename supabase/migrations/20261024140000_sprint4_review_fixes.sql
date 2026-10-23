-- Sprint 4 independent security review: fixes for its seven findings.
--
-- 1. Any member could become a response owner, export an edited answer, and so create a
--    "reviewed" entry that replaced an admin-reviewed one. Learned entries now count as reviewed
--    only when an admin approved the answer; anyone else's answer that would replace an entry
--    becomes a proposed replacement (unreviewed, beside the entry) until an admin reviews it.
-- 2. Any member could clear an entry's review date by exporting an unedited draft held for citing
--    it. Such drafts confirm their entries only when an admin approved them; confirmations are
--    logged.
-- 3. The budget counted only recorded spend, and questions had no length limit. Questions are
--    capped at 5,000 characters; each reservation also reserves an estimated cost, and the budget
--    counts reserved but not yet recorded spend, under one lock for everyone.
-- 4. purge_old_usage() checked current_user, which inside a SECURITY DEFINER function is always
--    the owner: any member could run it. Only the service role (a scheduled job) may now.
-- 5. price_usage() kept a cost the inserter supplied, for the same reason, and costs could be
--    negative. Only a direct superuser insert (tests) may set a cost; costs are never negative.
-- 6. (Edge Functions) usage is recorded even when a call fails; a reservation whose usage cannot
--    be recorded keeps counting against the budget.
-- 7. (Docs) the controls assume members reach the database only through the API: someone with
--    a direct SQL connection controls their own JWT claims and so auth.uid().

-- ─── 1. Proposed replacements ───────────────────────────────────────────────

ALTER TABLE public.kb_entries ADD COLUMN proposed_replacement_of uuid REFERENCES public.kb_entries(id) ON DELETE SET NULL;
DROP INDEX public.kb_entries_current_question;
CREATE UNIQUE INDEX kb_entries_current_question ON public.kb_entries (question_key)
  WHERE superseded_by IS NULL AND proposed_replacement_of IS NULL;

CREATE OR REPLACE FUNCTION public.set_entry_review_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF NEW.origin = 'seed' AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := NEW.created_at;
    END IF;
    RETURN NEW;
  END IF;
  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  -- Seed, an admin's own entry, or (origin 'response') an answer an admin approved.
  IF public.user_is_admin(NEW.created_by) THEN
    NEW.reviewed_at := now();
    NEW.reviewed_by := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

-- Entries learned from a non-admin's approval under the old rule are unreviewed again.
UPDATE public.kb_entries k SET reviewed_at = NULL, reviewed_by = NULL
 WHERE k.origin = 'response' AND NOT public.user_is_admin(k.created_by);

-- Reviewing a proposal completes the replacement.
CREATE OR REPLACE FUNCTION public.review_entry(p_entry uuid, p_question text DEFAULT NULL, p_answer text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e        public.kb_entries;
  edited   boolean;
  replaced uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can review knowledge-base entries' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.kb_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such entry' USING ERRCODE = 'P0002';
  END IF;
  IF e.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has been replaced by a newer one; review that instead' USING ERRCODE = '22023';
  END IF;
  edited := (p_question IS NOT NULL AND btrim(p_question) <> e.question) OR (p_answer IS NOT NULL AND btrim(p_answer) <> e.answer);

  IF e.proposed_replacement_of IS NOT NULL THEN
    SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
    UPDATE public.kb_entries SET superseded_by = p_entry
     WHERE id = e.proposed_replacement_of AND superseded_by IS NULL
     RETURNING id INTO replaced;
  END IF;
  UPDATE public.kb_entries
     SET question = CASE WHEN p_question IS NULL THEN question ELSE btrim(p_question) END,
         answer = CASE WHEN p_answer IS NULL THEN answer ELSE btrim(p_answer) END,
         reviewed_at = now(), reviewed_by = auth.uid(), last_reviewed_at = now(),
         proposed_replacement_of = NULL,
         embedding = CASE WHEN edited THEN NULL ELSE embedding END,
         embedding_model = CASE WHEN edited THEN NULL ELSE embedding_model END
   WHERE id = p_entry;
  SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.reviewed', p_entry, jsonb_build_object('ref', e.ref, 'edited', edited,
          'replaced', (SELECT k.ref FROM public.kb_entries k WHERE k.id = replaced),
          'previous', CASE WHEN edited THEN jsonb_build_object('question', e.question, 'answer', e.answer) END));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Another current entry already has this question; correct the question or remove the other entry first'
    USING ERRCODE = '23505';
END;
$$;

-- ─── 2. Learning ────────────────────────────────────────────────────────────

ALTER TABLE public.rfi_questions DROP CONSTRAINT IF EXISTS rfi_questions_learn_outcome_check;
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_learn_outcome_check
  CHECK (learn_outcome IN ('added', 'superseded', 'proposed', 'confirmed', 'not_confirmed_source', 'not_learned_pricing',
                           'not_learned_japanese', 'not_learned_empty', 'not_learned_unchecked'));

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

  n := n || jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'skipped'));
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.exported', p_session, n);
  RETURN n;
END;
$$;

-- ─── 3. Question length and budget reservations ─────────────────────────────

ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_question_length
  CHECK (length(question) <= 5000) NOT VALID;

ALTER TABLE public.ai_settings
  ADD COLUMN est_usd_per_question   numeric NOT NULL DEFAULT 0.01   CHECK (est_usd_per_question > 0),
  ADD COLUMN est_usd_per_embed_text numeric NOT NULL DEFAULT 0.0001 CHECK (est_usd_per_embed_text > 0);
GRANT UPDATE (est_usd_per_question, est_usd_per_embed_text) ON public.ai_settings TO authenticated;

-- Work reserved but whose usage is not yet recorded. Removed by settle_reservation() once the
-- usage is written; one whose usage could not be written keeps counting for the month.
CREATE TABLE public.ai_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('questions', 'embed')),
  units       int  NOT NULL CHECK (units > 0),
  est_usd     numeric NOT NULL CHECK (est_usd >= 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_reservations FROM PUBLIC, anon, authenticated;

-- Recorded spend plus reserved estimates this month, in dollars.
CREATE OR REPLACE FUNCTION public.month_committed_usd()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT sum(u.cost_usd) FROM public.ai_usage u WHERE u.at >= date_trunc('month', now())), 0)
       + coalesce((SELECT sum(r.est_usd) FROM public.ai_reservations r WHERE r.created_at >= date_trunc('month', now())), 0);
$$;
REVOKE ALL ON FUNCTION public.month_committed_usd() FROM PUBLIC, anon, authenticated;

DROP FUNCTION public.reserve_quota(uuid, text, int);
CREATE FUNCTION public.reserve_quota(p_user uuid, p_kind text, p_n int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s          public.ai_settings;
  q          public.ai_quota;
  used       int;
  cap        int;
  per_unit   numeric;
  by_budget  int;
  allowed    int;
  reason     text;
  res_id     uuid;
BEGIN
  IF p_kind NOT IN ('questions', 'embed') OR p_n IS NULL OR p_n < 0 OR p_user IS NULL THEN
    RAISE EXCEPTION 'reserve_quota: bad arguments' USING ERRCODE = '22023';
  END IF;
  -- One lock for the organisation's budget, then the caller's row for the daily cap.
  PERFORM pg_advisory_xact_lock(hashtext('rfi-respond:ai-budget'));
  SELECT * INTO s FROM public.ai_settings;
  INSERT INTO public.ai_quota (user_id, day) VALUES (p_user, current_date) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM public.ai_quota WHERE user_id = p_user AND day = current_date FOR UPDATE;

  used     := CASE p_kind WHEN 'questions' THEN q.questions ELSE q.embed_texts END;
  cap      := CASE p_kind WHEN 'questions' THEN s.daily_question_cap ELSE s.daily_embed_cap END;
  per_unit := CASE p_kind WHEN 'questions' THEN s.est_usd_per_question ELSE s.est_usd_per_embed_text END;
  by_budget := greatest(0, floor((s.monthly_budget_gbp / s.gbp_per_usd - public.month_committed_usd()) / per_unit))::int;
  allowed := greatest(0, least(p_n, cap - used, by_budget));
  IF allowed < p_n THEN
    reason := CASE WHEN by_budget < least(p_n, cap - used) THEN 'monthly_budget'
                   WHEN p_kind = 'questions' THEN 'daily_questions' ELSE 'daily_embed' END;
  END IF;
  IF allowed > 0 THEN
    IF p_kind = 'questions' THEN
      UPDATE public.ai_quota SET questions = questions + allowed WHERE user_id = p_user AND day = current_date;
    ELSE
      UPDATE public.ai_quota SET embed_texts = embed_texts + allowed WHERE user_id = p_user AND day = current_date;
    END IF;
    INSERT INTO public.ai_reservations (user_id, kind, units, est_usd) VALUES (p_user, p_kind, allowed, allowed * per_unit)
    RETURNING id INTO res_id;
  END IF;
  RETURN jsonb_build_object('allowed', allowed, 'reason', reason, 'reservation', res_id);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.settle_reservation(p_reservation uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM public.ai_reservations WHERE id = p_reservation;
$$;
REVOKE ALL ON FUNCTION public.settle_reservation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_reservation(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.usage_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s          public.ai_settings;
  q          public.ai_quota;
  committed  numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.ai_settings;
  SELECT * INTO q FROM public.ai_quota WHERE user_id = auth.uid() AND day = current_date;
  committed := public.month_committed_usd() * s.gbp_per_usd;
  RETURN jsonb_build_object(
    'questionsToday', coalesce(q.questions, 0), 'questionCap', s.daily_question_cap,
    'embedToday', coalesce(q.embed_texts, 0), 'embedCap', s.daily_embed_cap,
    'budgetGbp', s.monthly_budget_gbp,
    'spentGbp', CASE WHEN public.is_admin() THEN round(public.month_spend_gbp(), 4) END,
    'reservedGbp', CASE WHEN public.is_admin() THEN round(committed - public.month_spend_gbp(), 4) END,
    'alert', committed >= s.monthly_budget_gbp * s.alert_share,
    'exhausted', committed >= s.monthly_budget_gbp);
END;
$$;

-- ─── 4. Purge: the scheduled job only ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_usage()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n int;
BEGIN
  DELETE FROM public.ai_usage WHERE at < now() - interval '13 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.ai_quota WHERE day < current_date - 7;
  DELETE FROM public.ai_reservations WHERE created_at < date_trunc('month', now()) - interval '1 month';
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_usage() TO service_role;

-- ─── 5. Pricing ─────────────────────────────────────────────────────────────

ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_cost_not_negative CHECK (cost_usd >= 0);

CREATE OR REPLACE FUNCTION public.price_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.ai_prices;
BEGIN
  -- current_user inside a SECURITY DEFINER function is the owner, so the caller's role is read
  -- from the session's role setting: 'none' only for a direct superuser connection (tests).
  IF current_setting('role') <> 'none' THEN
    NEW.cost_usd := NULL;
  END IF;
  IF NEW.cost_usd IS NULL THEN
    IF NEW.provider = 'ollama' THEN
      NEW.cost_usd := 0;
    ELSE
      SELECT * INTO p FROM public.ai_prices WHERE provider = NEW.provider AND model = NEW.model;
      IF FOUND THEN
        NEW.cost_usd := (NEW.input_tokens * p.input_usd_per_mtok + NEW.output_tokens * p.output_usd_per_mtok) / 1000000;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
