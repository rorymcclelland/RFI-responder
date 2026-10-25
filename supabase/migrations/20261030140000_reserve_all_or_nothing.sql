-- Sprint 11 (S11-4, F-44): reserve_quota can reserve all or nothing. The embed function asked for
-- all its texts, was allowed some, refused the request, and the allowed units still counted
-- against the caller's day. Other callers keep the partial behaviour (a batch processes what fits).
DROP FUNCTION public.reserve_quota(uuid, text, int, int);
CREATE FUNCTION public.reserve_quota(p_user uuid, p_kind text, p_n int, p_size int DEFAULT NULL, p_all boolean DEFAULT false)
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
  IF p_kind NOT IN ('questions', 'embed', 'extract') OR p_n IS NULL OR p_n < 0 OR p_user IS NULL
     OR (p_size IS NOT NULL AND (p_size < 0 OR p_size > 1000000)) THEN
    RAISE EXCEPTION 'reserve_quota: bad arguments' USING ERRCODE = '22023';
  END IF;
  -- One lock for the organisation's budget, then the caller's row for the daily cap.
  PERFORM pg_advisory_xact_lock(hashtext('rfi-respond:ai-budget'));
  SELECT * INTO s FROM public.ai_settings;
  INSERT INTO public.ai_quota (user_id, day) VALUES (p_user, current_date) ON CONFLICT DO NOTHING;
  SELECT * INTO q FROM public.ai_quota WHERE user_id = p_user AND day = current_date FOR UPDATE;

  used := CASE p_kind WHEN 'questions' THEN q.questions WHEN 'embed' THEN q.embed_texts ELSE q.extract_docs END;
  cap  := CASE p_kind WHEN 'questions' THEN s.daily_question_cap WHEN 'embed' THEN s.daily_embed_cap ELSE s.daily_extract_cap END;
  -- A document is estimated by its size (the 200,000-character limit when the size is not given).
  per_unit := CASE p_kind
    WHEN 'questions' THEN s.est_usd_per_question
    WHEN 'embed' THEN s.est_usd_per_embed_text
    ELSE s.est_usd_per_extract_kchar * greatest(1, ceil(coalesce(p_size, 200000) / 1000.0)) END;
  by_budget := greatest(0, floor((s.monthly_budget_gbp / s.gbp_per_usd - public.month_committed_usd()) / per_unit))::int;
  allowed := greatest(0, least(p_n, cap - used, by_budget));
  IF allowed < p_n THEN
    reason := CASE WHEN by_budget < least(p_n, cap - used) THEN 'monthly_budget'
                   WHEN p_kind = 'questions' THEN 'daily_questions' WHEN p_kind = 'embed' THEN 'daily_embed' ELSE 'daily_extract' END;
    -- Sprint 11 (S11-4, F-44): all or nothing, so a refused request uses none of the day's allowance.
    IF p_all THEN
      allowed := 0;
    END IF;
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
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, int, int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, int, int, boolean) TO service_role;
