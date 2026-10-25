-- Sprint 10 security review (L3): when someone first used the app is theirs alone. Every member can
-- read every profile, so reading is now granted column by column, without onboarded_at, and a person
-- reads their own through my_onboarded_at().
REVOKE SELECT ON public.user_profiles FROM authenticated, anon;
GRANT SELECT (id, display_name, job_title, department, expertise_tags, is_admin, created_at, updated_at)
  ON public.user_profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.my_onboarded_at() RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.onboarded_at FROM public.user_profiles p WHERE p.id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.my_onboarded_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_onboarded_at() TO authenticated;
