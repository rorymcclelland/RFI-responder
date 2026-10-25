-- Sprint 11 (S11-6, F-48; Rory, Q4): every model a documented setting can choose has a price, and
-- calls to a model with no price are named on the governance page rather than counted as free.
-- Price copied from Voyage's published pricing page, with the date it was checked; rerank-2.5's
-- price was rechecked the same day and is unchanged ($0.05 per million tokens).
INSERT INTO public.ai_prices (provider, model, input_usd_per_mtok, output_usd_per_mtok, checked_on, source_url) VALUES
  ('voyage', 'rerank-3', 0.05, 0, '2026-10-25', 'https://docs.voyageai.com/pricing')
ON CONFLICT (provider, model) DO NOTHING;

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
    -- Sprint 11 (S11-6, F-48): which models have no price, so an admin can add one.
    'unpricedModels', coalesce((SELECT jsonb_agg(DISTINCT u.provider || ' ' || u.model) FROM public.ai_usage u
                                 WHERE u.cost_usd IS NULL AND u.at >= date_trunc('month', now())), '[]'::jsonb),
    'questionsProcessed', processed,
    'avgUsdPerQuestion', CASE WHEN processed > 0 THEN proc_cost / processed END);
END;
$$;
