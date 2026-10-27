-- Sprint 15 (S15-2, F-65): policies ask who is signed in once per query, not once per row.
-- `(select auth.uid())` is evaluated once as an init plan; `auth.uid()` on its own is evaluated
-- for every row the policy looks at. The rules themselves are unchanged. New policies follow this
-- pattern (docs/technical/DATA-MODEL.md); supabase/tests/db/sprint15.test.ts checks every policy.

ALTER POLICY "Assignee, owner or admin updates an assignment" ON public.question_assignments
  USING (assigned_to = (select auth.uid()) OR public.is_response_owner(opportunity_id) OR public.is_admin())
  WITH CHECK (assigned_to = (select auth.uid()) OR public.is_response_owner(opportunity_id) OR public.is_admin());

ALTER POLICY "Assignee, assigner, owner or admin reads an assignment" ON public.question_assignments
  USING (assigned_to = (select auth.uid()) OR assigned_by = (select auth.uid())
         OR public.is_response_owner(opportunity_id) OR public.is_admin());

ALTER POLICY "Owner or admin assigns questions" ON public.question_assignments
  WITH CHECK (assigned_by = (select auth.uid()) AND (public.is_response_owner(opportunity_id) OR public.is_admin()));

ALTER POLICY "Users update own profile; admins update any" ON public.user_profiles
  USING (id = (select auth.uid()) OR public.is_admin())
  WITH CHECK (id = (select auth.uid()) OR public.is_admin());

ALTER POLICY "Members create responses they own" ON public.opportunities
  WITH CHECK (created_by = (select auth.uid()) AND owner_id = (select auth.uid()));

ALTER POLICY "Owner or admin edits a response" ON public.opportunities
  USING (owner_id = (select auth.uid()) OR public.is_admin());

ALTER POLICY "Members add entries as themselves" ON public.kb_entries
  WITH CHECK (created_by = (select auth.uid()) AND origin = ANY (ARRAY['import'::public.kb_origin, 'manual'::public.kb_origin]));

ALTER POLICY "Members read their own usage; admins read all" ON public.ai_usage
  USING (user_id = (select auth.uid()) OR public.is_admin());

-- The prototype's "any signed-in user may update any session" policy has been dead since Sprint 3,
-- when signed-in users lost the update right on rfi_sessions (sessions are completed only by
-- record_export). A policy that can never apply only misleads a reader, so it goes.
DROP POLICY "Authenticated users can update sessions" ON public.rfi_sessions;
