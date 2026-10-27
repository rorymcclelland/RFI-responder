-- Sprint 15 (S15-3, F-64): the six helpers the access rules use are no longer API endpoints.
--
-- Supabase's API exposes every function in `public` that the caller may execute, so any signed-in
-- user could call is_admin() and the rest directly. They reveal little (the caller's own rights),
-- but need not be callable. Revoking execute is not an option: policies run with the caller's
-- rights, so the caller must be able to execute what the policies call. Instead the helpers move to
-- a schema of their own, `access`, which the API does not expose (supabase/config.toml, [api]
-- schemas), with usage and execute for signed-in users and the service role only.
--
-- Policies, views and triggers refer to a function by its identity, so they follow the move
-- unchanged. Function bodies refer to it by name (`public.is_admin()`), so every function that
-- calls a helper is recreated from its own current definition with the new name, and nothing else
-- in it changes. supabase/tests/db/sprint15.test.ts checks none still uses the old names.

CREATE SCHEMA access;
REVOKE ALL ON SCHEMA access FROM PUBLIC;
GRANT USAGE ON SCHEMA access TO authenticated, service_role;

ALTER FUNCTION public.is_admin() SET SCHEMA access;
ALTER FUNCTION public.is_response_owner(uuid) SET SCHEMA access;
ALTER FUNCTION public.can_decide_question(uuid) SET SCHEMA access;
ALTER FUNCTION public.response_of_session(uuid) SET SCHEMA access;
ALTER FUNCTION public.current_operation(text) SET SCHEMA access;
ALTER FUNCTION public.entry_review_due(public.kb_entries) SET SCHEMA access;

-- Execute rights moved with the functions; state them again so this file says who may call them.
DO $grants$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'access.is_admin()', 'access.is_response_owner(uuid)', 'access.can_decide_question(uuid)',
    'access.response_of_session(uuid)', 'access.current_operation(text)', 'access.entry_review_due(public.kb_entries)'
  ]::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END
$grants$;

-- Recreate every function that calls a helper by its old name. CREATE OR REPLACE keeps each
-- function's owner, grants, security and settings.
DO $rename$
DECLARE
  fn record;
  helpers constant text := '(is_admin|is_response_owner|can_decide_question|response_of_session|current_operation|entry_review_due)';
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private', 'access') AND p.prokind = 'f'
       AND p.prosrc ~ ('public\.' || helpers || '\s*\(')
  LOOP
    def := regexp_replace(pg_get_functiondef(fn.oid), 'public\.' || helpers || '(\s*\()', 'access.\1\2', 'g');
    EXECUTE def;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('public', 'private', 'access') AND p.prosrc ~ ('public\.' || helpers || '\s*\(')
  ) THEN
    RAISE EXCEPTION 'A function still calls a policy helper in public';
  END IF;
END
$rename$;
