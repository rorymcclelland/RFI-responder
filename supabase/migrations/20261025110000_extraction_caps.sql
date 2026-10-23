-- Sprint 5, story S5-2: extracting questions from Word documents spends money, so it goes through
-- the Sprint 4 reservation and caps: 20 documents per person per day (refinement Q6) and an
-- estimated $0.02 per document held against the monthly budget until the real cost is recorded.

ALTER TABLE public.ai_settings
  ADD COLUMN daily_extract_cap       int     NOT NULL DEFAULT 20   CHECK (daily_extract_cap >= 0),
  ADD COLUMN est_usd_per_extract_doc numeric NOT NULL DEFAULT 0.02 CHECK (est_usd_per_extract_doc > 0);
GRANT UPDATE (daily_extract_cap, est_usd_per_extract_doc) ON public.ai_settings TO authenticated;

ALTER TABLE public.ai_quota ADD COLUMN extract_docs int NOT NULL DEFAULT 0 CHECK (extract_docs >= 0);

ALTER TABLE public.ai_usage DROP CONSTRAINT ai_usage_kind_check;
ALTER TABLE public.ai_usage ADD CONSTRAINT ai_usage_kind_check CHECK (kind IN ('judge', 'gate', 'draft', 'embed', 'rerank', 'extract'));
ALTER TABLE public.ai_reservations DROP CONSTRAINT ai_reservations_kind_check;
ALTER TABLE public.ai_reservations ADD CONSTRAINT ai_reservations_kind_check CHECK (kind IN ('questions', 'embed', 'extract'));

CREATE OR REPLACE FUNCTION public.reserve_quota(p_user uuid, p_kind text, p_n int)
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
  IF p_kind NOT IN ('questions', 'embed', 'extract') OR p_n IS NULL OR p_n < 0 OR p_user IS NULL THEN
    RAISE EXCEPTION 'reserve_quota: bad arguments' USING ERRCODE = '22023';
  END IF;
  -- One lock for the organisation's budget, then the caller's row for the daily cap.
  PERFORM pg_advisory_xact_lock(hashtext('rfi-respond:ai-budget'));
  SELECT * INTO s FROM public.ai_settings;
  INSERT INTO public.ai_quota (user_id, day) VALUES (p_user, current_date) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM public.ai_quota WHERE user_id = p_user AND day = current_date FOR UPDATE;

  used     := CASE p_kind WHEN 'questions' THEN q.questions WHEN 'embed' THEN q.embed_texts ELSE q.extract_docs END;
  cap      := CASE p_kind WHEN 'questions' THEN s.daily_question_cap WHEN 'embed' THEN s.daily_embed_cap ELSE s.daily_extract_cap END;
  per_unit := CASE p_kind WHEN 'questions' THEN s.est_usd_per_question WHEN 'embed' THEN s.est_usd_per_embed_text ELSE s.est_usd_per_extract_doc END;
  by_budget := greatest(0, floor((s.monthly_budget_gbp / s.gbp_per_usd - public.month_committed_usd()) / per_unit))::int;
  allowed := greatest(0, least(p_n, cap - used, by_budget));
  IF allowed < p_n THEN
    reason := CASE WHEN by_budget < least(p_n, cap - used) THEN 'monthly_budget'
                   WHEN p_kind = 'questions' THEN 'daily_questions' WHEN p_kind = 'embed' THEN 'daily_embed' ELSE 'daily_extract' END;
  END IF;
  IF allowed > 0 THEN
    IF p_kind = 'questions' THEN
      UPDATE public.ai_quota SET questions = questions + allowed WHERE user_id = p_user AND day = current_date;
    ELSIF p_kind = 'embed' THEN
      UPDATE public.ai_quota SET embed_texts = embed_texts + allowed WHERE user_id = p_user AND day = current_date;
    ELSE
      UPDATE public.ai_quota SET extract_docs = extract_docs + allowed WHERE user_id = p_user AND day = current_date;
    END IF;
    INSERT INTO public.ai_reservations (user_id, kind, units, est_usd) VALUES (p_user, p_kind, allowed, allowed * per_unit)
    RETURNING id INTO res_id;
  END IF;
  RETURN jsonb_build_object('allowed', allowed, 'reason', reason, 'reservation', res_id);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, int) TO service_role;

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
    'extractToday', coalesce(q.extract_docs, 0), 'extractCap', s.daily_extract_cap,
    'budgetGbp', s.monthly_budget_gbp,
    'spentGbp', CASE WHEN public.is_admin() THEN round(public.month_spend_gbp(), 4) END,
    'reservedGbp', CASE WHEN public.is_admin() THEN round(committed - public.month_spend_gbp(), 4) END,
    'alert', committed >= s.monthly_budget_gbp * s.alert_share,
    'exhausted', committed >= s.monthly_budget_gbp);
END;
$$;
