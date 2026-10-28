-- Sprint 15 hosted check (BUG-41): the reset failed on the live project with "UPDATE requires a WHERE
-- clause". Supabase's API runs every request with pg_safeupdate, which refuses an UPDATE or DELETE
-- with no WHERE clause, even inside a function; the local test database does not load it. The step
-- recording the reset date had none, so every reset from the app rolled back. The table holds one row,
-- so `WHERE id` changes nothing else. supabase/tests/db/sprint15.test.ts now checks that no function
-- has an UPDATE or DELETE without a WHERE clause.

CREATE OR REPLACE FUNCTION public.reset_demo(p_confirm text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_admin  uuid := auth.uid();
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub    text := current_setting('request.jwt.claim.sub', true);
  v_script text;
  v_entries int;
  v_responses int;
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can reset the demo' USING ERRCODE = '42501';
  END IF;
  IF p_confirm IS DISTINCT FROM 'reset the demo' THEN
    RAISE EXCEPTION 'Type "reset the demo" to confirm' USING ERRCODE = '22023';
  END IF;
  -- One reset at a time, by the button or by supabase/demo-hosted-reset.sql, which takes the same lock.
  PERFORM pg_advisory_xact_lock(hashtext('rfi_respond.reset_demo'));
  SELECT script INTO v_script FROM private.demo_reload FOR UPDATE;
  IF v_script IS NULL THEN
    RAISE EXCEPTION 'No demo is loaded in this installation, so there is nothing to reset' USING ERRCODE = 'P0002';
  END IF;

  TRUNCATE public.opportunities, public.kb_entries RESTART IDENTITY CASCADE;
  DELETE FROM public.ai_usage WHERE user_id IN (SELECT id FROM auth.users WHERE email LIKE '%@example.invalid');
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  EXECUTE v_script;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  UPDATE private.demo_reload SET last_reset_at = now() WHERE id;
  SELECT count(*) INTO v_entries FROM public.kb_entries;
  SELECT count(*) INTO v_responses FROM public.opportunities;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (v_admin, 'demo.reset', NULL, jsonb_build_object('entries', v_entries, 'responses', v_responses));
  RETURN jsonb_build_object('entries', v_entries, 'responses', v_responses);
END;
$$;
