-- Sprint 15 security review (findings 2, 3, 6, 10): invitations are reserved in the database before
-- anything is sent.
--
-- invite-user calls reserve_invitation first. Under a lock per admin it checks the admin, refuses any
-- address that already has an account (confirmed or not, so the demo's fictional people and reviewers
-- who have not yet accepted are never sent a fresh sign-in link), and counts the admin's invitations
-- today against the daily limit. Only then does it take a slot and the function send the email; a
-- send that fails gives the slot back. Parallel requests therefore cannot pass the limit.

-- Finding 10: functions added to the access schema later are not executable by everyone by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA access REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE private.invitation_slots (
  id    bigserial   PRIMARY KEY,
  admin uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_slots_admin_at ON private.invitation_slots (admin, at);
ALTER TABLE private.invitation_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.invitation_slots FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.reserve_invitation(p_admin uuid, p_email text, p_daily_limit int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_slot bigint;
  v_today int;
BEGIN
  -- One invitation at a time per admin, so the count below cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('rfi_respond.invite'), hashtext(p_admin::text));
  IF NOT public.user_is_admin(p_admin) THEN
    RETURN jsonb_build_object('outcome', 'not_admin');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(p_email))) THEN
    RETURN jsonb_build_object('outcome', 'exists');
  END IF;
  SELECT count(*) INTO v_today FROM private.invitation_slots
   WHERE admin = p_admin AND at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF v_today >= p_daily_limit THEN
    RETURN jsonb_build_object('outcome', 'limit');
  END IF;
  INSERT INTO private.invitation_slots (admin) VALUES (p_admin) RETURNING id INTO v_slot;
  RETURN jsonb_build_object('outcome', 'ok', 'slot', v_slot);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_invitation(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_invitation(uuid, text, int) TO service_role;

-- Gives back a slot when the email was not sent.
CREATE FUNCTION public.release_invitation(p_slot bigint)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM private.invitation_slots WHERE id = p_slot;
$$;
REVOKE ALL ON FUNCTION public.release_invitation(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_invitation(bigint) TO service_role;

-- Finding 5: auth.uid() also reads the older setting request.jwt.claim.sub, so the reset clears it
-- too while the demo reloads, and puts both back afterwards.
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

  UPDATE private.demo_reload SET last_reset_at = now();
  SELECT count(*) INTO v_entries FROM public.kb_entries;
  SELECT count(*) INTO v_responses FROM public.opportunities;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (v_admin, 'demo.reset', NULL, jsonb_build_object('entries', v_entries, 'responses', v_responses));
  RETURN jsonb_build_object('entries', v_entries, 'responses', v_responses);
END;
$$;
