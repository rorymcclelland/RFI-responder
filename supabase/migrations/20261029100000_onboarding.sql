-- Sprint 10, S10-6 (Rory, refinement): the introduction is shown once per person, remembered on
-- their account so it is not shown again on another browser.
--
-- Nobody writes the column directly. Admins may update any profile (decision 0003), so a column
-- grant would let an admin mark someone else as having seen it; instead mark_onboarded() records it
-- for the signed-in person only. Tested in supabase/tests/db/sprint10.test.ts.

ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

COMMENT ON COLUMN public.user_profiles.onboarded_at IS
  'When the person finished or skipped the introduction (S10-6). Set only by mark_onboarded().';

CREATE OR REPLACE FUNCTION public.mark_onboarded()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_profiles SET onboarded_at = now() WHERE id = auth.uid() AND onboarded_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_onboarded() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarded() TO authenticated;
