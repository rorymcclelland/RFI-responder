-- Sprint 22 (S22-2, U-9): spend by use, and the audit log by person and response.
--
-- usage_report() gains 'byFunction': calls and spend this month for each Edge Function that called a
-- provider (ai_usage.function: process-questions, ask-knowledge, embed, embed-entries,
-- extract-questions). The screen gives each a plain name and shows an unknown one as itself.
-- Otherwise the function is as in 20261030150000, with the helper in `access` (Sprint 15).
CREATE OR REPLACE FUNCTION public.usage_report()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rate      numeric := (SELECT gbp_per_usd FROM public.ai_settings);
  processed bigint;
  proc_cost numeric;
BEGIN
  IF NOT access.is_admin() THEN
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
    'byFunction', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'spentGbp')::numeric DESC, x->>'function') FROM (
        SELECT jsonb_build_object('function', u.function, 'calls', count(*),
                                  'spentGbp', round(coalesce(sum(u.cost_usd), 0) * rate, 4)) AS x
          FROM public.ai_usage u
         WHERE u.at >= date_trunc('month', now())
         GROUP BY u.function) t), '[]'::jsonb),
    'unpricedCalls', (SELECT count(*) FROM public.ai_usage u WHERE u.cost_usd IS NULL AND u.at >= date_trunc('month', now())),
    'unpricedModels', coalesce((SELECT jsonb_agg(DISTINCT u.provider || ' ' || u.model) FROM public.ai_usage u
                                 WHERE u.cost_usd IS NULL AND u.at >= date_trunc('month', now())), '[]'::jsonb),
    'questionsProcessed', processed,
    'avgUsdPerQuestion', CASE WHEN processed > 0 THEN proc_cost / processed END);
END;
$$;

-- The audit log, filtered by kind (a list of actions), by who acted and by response, together; NULL
-- means any. Security invoker: it reads the log under the caller's own rights, so only admins see
-- rows, as with the table itself (a member gets none). Read-only.
--
-- Who acted is actor_ref, kept after a profile is deleted (Sprint 14), so a former person's rows can
-- still be found; their name is then null. A row belongs to a response when its target is the
-- response, one of its files, or one of its questions (question.*, kb.confirmed, response.exported,
-- response.archived); rows about entries, settings, prices, people or the demo belong to none.
-- Newest first, at most p_limit (1 to 200) rows, and whether more match.
CREATE FUNCTION public.audit_log_search(p_actions text[], p_actor uuid, p_response uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH lim AS (SELECT least(greatest(coalesce(p_limit, 200), 1), 200) AS n),
  targets AS (
    SELECT p_response AS id WHERE p_response IS NOT NULL
    UNION ALL SELECT s.id FROM public.rfi_sessions s WHERE p_response IS NOT NULL AND s.opportunity_id = p_response
    UNION ALL SELECT q.id FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
               WHERE p_response IS NOT NULL AND s.opportunity_id = p_response
  ),
  found AS (
    SELECT a.id, a.at, a.action, a.actor_ref, a.target_id, a.details
      FROM public.audit_log a
     WHERE (p_actions IS NULL OR a.action = ANY (p_actions))
       AND (p_actor IS NULL OR a.actor_ref = p_actor)
       AND (p_response IS NULL OR a.target_id IN (SELECT id FROM targets))
     ORDER BY a.at DESC, a.id DESC
     LIMIT (SELECT n + 1 FROM lim)
  ),
  shown AS (SELECT * FROM found ORDER BY at DESC, id DESC LIMIT (SELECT n FROM lim))
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
              'id', x.id, 'at', x.at, 'action', x.action, 'actor', x.actor_ref, 'actorName', p.display_name,
              'targetId', x.target_id, 'details', x.details) ORDER BY x.at DESC, x.id DESC)
            FROM shown x LEFT JOIN public.user_profiles p ON p.id = x.actor_ref), '[]'::jsonb),
    'more', (SELECT count(*) FROM found) > (SELECT n FROM lim));
$$;
REVOKE ALL ON FUNCTION public.audit_log_search(text[], uuid, uuid, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.audit_log_search(text[], uuid, uuid, integer) TO authenticated;

-- Everyone who has acted in the log, for the person filter: their name, or null for someone whose
-- profile has since been deleted. Invoker, so only admins get anyone.
CREATE FUNCTION public.audit_log_people()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', a.actor_ref, 'name', p.display_name)
                            ORDER BY p.display_name NULLS LAST, a.actor_ref), '[]'::jsonb)
    FROM (SELECT DISTINCT actor_ref FROM public.audit_log WHERE actor_ref IS NOT NULL) a
    LEFT JOIN public.user_profiles p ON p.id = a.actor_ref;
$$;
REVOKE ALL ON FUNCTION public.audit_log_people() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.audit_log_people() TO authenticated;

-- The filters read by who acted, by target, and newest first.
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_ref, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON public.audit_log (target_id, at DESC);
