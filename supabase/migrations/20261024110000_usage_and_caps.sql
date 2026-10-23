-- Sprint 4, story S4-1 (F-21): every AI call recorded and priced; per-user daily caps and an
-- organisation monthly budget, checked before any provider is called.
--
-- How it fits together:
-- - The Edge Functions call reserve_quota() before they call a provider. It takes a row lock
--   on the caller's quota row for today, so parallel requests cannot both pass the cap.
-- - After the calls, the functions insert one ai_usage row per call with the token counts from
--   the provider's reply; a trigger prices it from ai_prices.
-- - Prices are in US dollars, as the providers publish them. The budget is in pounds and is
--   compared using ai_settings.gbp_per_usd, which defaults to 1.00: every dollar counted as a
--   pound, so the cap bites early rather than late until an admin sets the real rate.
--
-- The settings row and the price rows are configuration the functions need to run, not sample
-- data; prices carry the date they were checked and their source.

-- ─── Settings (one row) ─────────────────────────────────────────────────────

CREATE TABLE public.ai_settings (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  daily_question_cap     int     NOT NULL DEFAULT 300  CHECK (daily_question_cap >= 0),
  daily_embed_cap        int     NOT NULL DEFAULT 5000 CHECK (daily_embed_cap >= 0),
  monthly_budget_gbp     numeric NOT NULL DEFAULT 10   CHECK (monthly_budget_gbp >= 0),
  alert_share            numeric NOT NULL DEFAULT 0.8  CHECK (alert_share > 0 AND alert_share <= 1),
  gbp_per_usd            numeric NOT NULL DEFAULT 1.00 CHECK (gbp_per_usd > 0),
  review_interval_months int     NOT NULL DEFAULT 12   CHECK (review_interval_months BETWEEN 1 AND 60),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL
);
INSERT INTO public.ai_settings DEFAULT VALUES;

ALTER TABLE public.ai_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_settings TO authenticated;
GRANT UPDATE (daily_question_cap, daily_embed_cap, monthly_budget_gbp, alert_share, gbp_per_usd, review_interval_months)
  ON public.ai_settings TO authenticated;
CREATE POLICY "Members read the settings" ON public.ai_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins change the settings" ON public.ai_settings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.stamp_settings_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'settings.changed', NULL, jsonb_build_object('before', to_jsonb(OLD) - 'updated_at' - 'updated_by',
                                                                     'after', to_jsonb(NEW) - 'updated_at' - 'updated_by'));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_settings_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ai_settings_stamp BEFORE UPDATE ON public.ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.stamp_settings_change();

-- ─── Prices ─────────────────────────────────────────────────────────────────

CREATE TABLE public.ai_prices (
  provider            text    NOT NULL,
  model               text    NOT NULL,
  input_usd_per_mtok  numeric NOT NULL CHECK (input_usd_per_mtok >= 0),
  output_usd_per_mtok numeric NOT NULL DEFAULT 0 CHECK (output_usd_per_mtok >= 0),
  checked_on          date    NOT NULL,
  source_url          text    NOT NULL,
  PRIMARY KEY (provider, model)
);
INSERT INTO public.ai_prices (provider, model, input_usd_per_mtok, output_usd_per_mtok, checked_on, source_url) VALUES
  ('anthropic', 'claude-haiku-5-5', 0.10, 0.50, '2026-10-23', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('anthropic', 'claude-sonnet-5-5', 2.00, 10.00, '2026-10-23', 'https://platform.claude.com/docs/en/about-claude/pricing'),
  ('voyage', 'voyage-4', 0.06, 0, '2026-10-23', 'https://docs.voyageai.com/docs/pricing'),
  ('voyage', 'rerank-2.5', 0.05, 0, '2026-10-23', 'https://docs.voyageai.com/docs/pricing');

ALTER TABLE public.ai_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_prices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_prices TO authenticated;
CREATE POLICY "Members read prices" ON public.ai_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins add prices" ON public.ai_prices FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admins change prices" ON public.ai_prices FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins remove prices" ON public.ai_prices FOR DELETE TO authenticated USING (public.is_admin());

-- ─── Usage ──────────────────────────────────────────────────────────────────

CREATE TABLE public.ai_usage (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  function       text NOT NULL CHECK (length(function) <= 60),
  kind           text NOT NULL CHECK (kind IN ('judge', 'gate', 'draft', 'embed', 'rerank')),
  provider       text NOT NULL,
  model          text NOT NULL,
  input_tokens   bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens  bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- Priced on insert from ai_prices; NULL when the model has no price row (shown to admins).
  cost_usd       numeric,
  session_id     uuid,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_at ON public.ai_usage (at);
CREATE INDEX ai_usage_user_at ON public.ai_usage (user_id, at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_usage TO authenticated;
GRANT SELECT, INSERT ON public.ai_usage TO service_role;
CREATE POLICY "Members read their own usage; admins read all" ON public.ai_usage FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "The Edge Functions record usage" ON public.ai_usage FOR INSERT TO service_role WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.price_usage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.ai_prices;
BEGIN
  IF NEW.cost_usd IS NOT NULL AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    NEW.cost_usd := NULL; -- only the database prices a call (tests may set it as the superuser)
  END IF;
  IF NEW.cost_usd IS NULL THEN
    IF NEW.provider = 'ollama' THEN
      NEW.cost_usd := 0; -- runs locally
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
REVOKE ALL ON FUNCTION public.price_usage() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER ai_usage_price BEFORE INSERT ON public.ai_usage FOR EACH ROW EXECUTE FUNCTION public.price_usage();

-- ─── Daily quotas ───────────────────────────────────────────────────────────

CREATE TABLE public.ai_quota (
  user_id      uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  day          date NOT NULL,
  questions    int  NOT NULL DEFAULT 0 CHECK (questions >= 0),
  embed_texts  int  NOT NULL DEFAULT 0 CHECK (embed_texts >= 0),
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.ai_quota ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_quota FROM PUBLIC, anon, authenticated;
-- No policies and no grants for members: only reserve_quota (SECURITY DEFINER) touches it.

/** Spend this calendar month (UTC), in pounds at the configured rate. */
CREATE OR REPLACE FUNCTION public.month_spend_gbp()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(u.cost_usd), 0) * (SELECT s.gbp_per_usd FROM public.ai_settings s)
    FROM public.ai_usage u
   WHERE u.at >= date_trunc('month', now());
$$;
REVOKE ALL ON FUNCTION public.month_spend_gbp() FROM PUBLIC, anon, authenticated;

-- Reserve up to p_n questions or embedding texts for p_user today. Returns how many are allowed
-- and, when fewer than asked, why ('daily_questions', 'daily_embed' or 'monthly_budget').
CREATE OR REPLACE FUNCTION public.reserve_quota(p_user uuid, p_kind text, p_n int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s        public.ai_settings;
  q        public.ai_quota;
  used     int;
  cap      int;
  allowed  int;
BEGIN
  IF p_kind NOT IN ('questions', 'embed') OR p_n IS NULL OR p_n < 0 OR p_user IS NULL THEN
    RAISE EXCEPTION 'reserve_quota: bad arguments' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.ai_settings;
  INSERT INTO public.ai_quota (user_id, day) VALUES (p_user, current_date) ON CONFLICT DO NOTHING;
  -- The row lock serialises reservations for this user (test 8).
  SELECT * INTO q FROM public.ai_quota WHERE user_id = p_user AND day = current_date FOR UPDATE;

  IF public.month_spend_gbp() >= s.monthly_budget_gbp THEN
    RETURN jsonb_build_object('allowed', 0, 'reason', 'monthly_budget');
  END IF;

  used := CASE p_kind WHEN 'questions' THEN q.questions ELSE q.embed_texts END;
  cap  := CASE p_kind WHEN 'questions' THEN s.daily_question_cap ELSE s.daily_embed_cap END;
  allowed := greatest(0, least(p_n, cap - used));
  IF p_kind = 'questions' THEN
    UPDATE public.ai_quota SET questions = questions + allowed WHERE user_id = p_user AND day = current_date;
  ELSE
    UPDATE public.ai_quota SET embed_texts = embed_texts + allowed WHERE user_id = p_user AND day = current_date;
  END IF;
  RETURN jsonb_build_object('allowed', allowed,
    'reason', CASE WHEN allowed < p_n THEN CASE p_kind WHEN 'questions' THEN 'daily_questions' ELSE 'daily_embed' END END);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, int) TO service_role;

-- What the caller has left today, and the organisation's position this month. Exact spend is
-- shown to admins only; members see whether the budget is near or reached.
CREATE OR REPLACE FUNCTION public.usage_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s      public.ai_settings;
  q      public.ai_quota;
  spent  numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.ai_settings;
  SELECT * INTO q FROM public.ai_quota WHERE user_id = auth.uid() AND day = current_date;
  spent := public.month_spend_gbp();
  RETURN jsonb_build_object(
    'questionsToday', coalesce(q.questions, 0), 'questionCap', s.daily_question_cap,
    'embedToday', coalesce(q.embed_texts, 0), 'embedCap', s.daily_embed_cap,
    'budgetGbp', s.monthly_budget_gbp,
    'spentGbp', CASE WHEN public.is_admin() THEN round(spent, 4) END,
    'alert', spent >= s.monthly_budget_gbp * s.alert_share,
    'exhausted', spent >= s.monthly_budget_gbp);
END;
$$;
REVOKE ALL ON FUNCTION public.usage_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_status() TO authenticated;

-- Admin report: this month's spend by user and by model, and any calls with no price.
CREATE OR REPLACE FUNCTION public.usage_report()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rate numeric := (SELECT gbp_per_usd FROM public.ai_settings);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can see the usage report' USING ERRCODE = '42501';
  END IF;
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
    'unpricedCalls', (SELECT count(*) FROM public.ai_usage u WHERE u.cost_usd IS NULL AND u.at >= date_trunc('month', now())));
END;
$$;
REVOKE ALL ON FUNCTION public.usage_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usage_report() TO authenticated;

-- Retention (Sprint 4, Q5): usage records are kept for 13 months. Hosted deployments schedule
-- this (for example with pg_cron); locally an admin can run it.
CREATE OR REPLACE FUNCTION public.purge_old_usage()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n int;
BEGIN
  IF NOT (public.is_admin() OR current_user IN ('service_role', 'postgres')) THEN
    RAISE EXCEPTION 'Only an admin can purge usage records' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.ai_usage WHERE at < now() - interval '13 months';
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.ai_quota WHERE day < current_date - 7;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_usage() TO authenticated, service_role;
