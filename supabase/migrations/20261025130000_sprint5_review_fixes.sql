-- Sprint 5 independent security review: database fixes (the others are in the app and the
-- Edge Functions; docs/refinement/sprint-5.md lists all five).
--
-- 1. A customer number reached the Word export unescaped. The export now escapes it; here it is
--    also limited to what a list number looks like: letters, digits, spaces and . ( ) -.
-- 4. Extraction reserved a flat $0.02 per document, about seven times too little for a large
--    one. It now reserves per 1,000 characters sent ($0.0005 each: $0.10 for the 200,000 limit).
-- 5. An owner could delete a closed assignment and recreate it open, losing the history that
--    refinement Q4 keeps. Closed assignments cannot be deleted, except with their response
--    (delete_response, which runs as the database owner).

-- ─── 1 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_customer_ref_safe
  CHECK (customer_ref ~ '^[[:alnum:].() -]{1,20}$') NOT VALID;

-- ─── 4 ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.ai_settings
  ADD COLUMN est_usd_per_extract_kchar numeric NOT NULL DEFAULT 0.0005 CHECK (est_usd_per_extract_kchar > 0);
ALTER TABLE public.ai_settings DROP COLUMN est_usd_per_extract_doc;
GRANT UPDATE (est_usd_per_extract_kchar) ON public.ai_settings TO authenticated;

DROP FUNCTION public.reserve_quota(uuid, text, int);
CREATE FUNCTION public.reserve_quota(p_user uuid, p_kind text, p_n int, p_size int DEFAULT NULL)
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
REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, int, int) TO service_role;

-- ─── 5 ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_closed_assignments()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'closed' THEN
      RAISE EXCEPTION 'This assignment was closed when the response was exported, and is kept as a record' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
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
DROP TRIGGER question_assignments_guard_closed ON public.question_assignments;
CREATE TRIGGER question_assignments_guard_closed BEFORE INSERT OR UPDATE OR DELETE ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_assignments();
