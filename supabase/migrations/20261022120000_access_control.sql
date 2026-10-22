/*
  # Access control (Sprint 0, story S0-5)

  Implements the role matrix in docs/decisions/0003-access-control.md:

  | Action                                        | Admin | Response owner | Member        |
  |-----------------------------------------------|-------|----------------|---------------|
  | Read responses, sessions, questions, KB       | yes   | yes            | yes           |
  | Create a response (and own it), run a session | yes   | yes            | yes           |
  | Edit a response, hand it to a new owner       | yes   | yes            | no            |
  | Permanently delete a response                 | yes   | no             | no            |
  | Assign questions on a response                | yes   | yes            | no            |
  | Update an assignment                          | yes   | yes            | assignee only |
  | Edit own name, title, department, expertise   | yes   | yes            | yes           |
  | Grant or remove admin rights                  | yes   | no             | no            |

  Fixes found in the Sprint 0 review:
  1. Any signed-in user could set user_profiles.is_admin = true on their own row.
     is_admin can now only be changed through set_user_admin(), which checks the
     caller is an admin, refuses to remove the last admin, and writes the audit log.
  2. Responses with no recorded creator (created_by IS NULL) could be edited and
     deleted by anyone. Responses now have an explicit owner_id.
  3. Any signed-in user could create assignments on any response.
  4. Anonymous visitors kept table privileges (RLS hid the rows); they are now
     revoked outright, including for tables created later.

  Sessions and questions stay team-shared (any member may add and update them);
  Sprint 3's readiness workflow tightens that.
*/

-- ─── New column first: the helpers below refer to it ──────────────────────

ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so policies on user_profiles can call them without recursion.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT COALESCE((SELECT p.is_admin FROM public.user_profiles p WHERE p.id = auth.uid()), false)
$$;

CREATE OR REPLACE FUNCTION public.is_response_owner(opportunity uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.opportunities o WHERE o.id = opportunity AND o.owner_id = auth.uid()
  )
$$;

REVOKE ALL ON FUNCTION public.is_admin(), public.is_response_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(), public.is_response_owner(uuid) TO authenticated, service_role;

-- ─── Audit log ──────────────────────────────────────────────────────────────
-- Append-only record of privileged actions. Written only by SECURITY DEFINER
-- functions; readable by admins. Sprint 3 extends it to approvals.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target_id  uuid,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_log FROM anon, authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

CREATE POLICY "Admins can read the audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_admin());

-- ─── user_profiles ──────────────────────────────────────────────────────────

-- Profiles are created by the on_auth_user_created trigger, never by the API.
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
REVOKE INSERT, DELETE ON public.user_profiles FROM authenticated;

-- Only these columns can be changed through the API. is_admin is not among them.
REVOKE UPDATE ON public.user_profiles FROM authenticated;
GRANT UPDATE (display_name, job_title, department, expertise_tags, updated_at)
  ON public.user_profiles TO authenticated;

DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
CREATE POLICY "Users update own profile; admins update any"
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

CREATE OR REPLACE FUNCTION public.set_user_admin(target uuid, make_admin boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can change admin rights' USING ERRCODE = '42501';
  END IF;
  IF NOT make_admin
     AND (SELECT count(*) FROM public.user_profiles WHERE is_admin) <= 1
     AND (SELECT is_admin FROM public.user_profiles WHERE id = target) THEN
    RAISE EXCEPTION 'At least one admin must remain' USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles SET is_admin = make_admin, updated_at = now() WHERE id = target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such user' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (actor, action, target_id)
  VALUES (auth.uid(), CASE WHEN make_admin THEN 'user.admin_granted' ELSE 'user.admin_removed' END, target);
END;
$$;
REVOKE ALL ON FUNCTION public.set_user_admin(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_admin(uuid, boolean) TO authenticated;

-- ─── opportunities (responses) ──────────────────────────────────────────────

UPDATE public.opportunities SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;
ALTER TABLE public.opportunities ALTER COLUMN created_by SET DEFAULT auth.uid();
ALTER TABLE public.opportunities ALTER COLUMN owner_id SET DEFAULT auth.uid();
CREATE INDEX IF NOT EXISTS idx_opportunities_owner_id ON public.opportunities(owner_id);

REVOKE UPDATE ON public.opportunities FROM authenticated;
GRANT UPDATE (name, status, owner_id, updated_at) ON public.opportunities TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can insert own opportunities" ON public.opportunities;
CREATE POLICY "Members create responses they own"
  ON public.opportunities FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND owner_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated users can update own opportunities" ON public.opportunities;
CREATE POLICY "Owner or admin edits a response"
  ON public.opportunities FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin())
  WITH CHECK (owner_id IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can delete own opportunities" ON public.opportunities;
CREATE POLICY "Only admins delete responses"
  ON public.opportunities FOR DELETE TO authenticated
  USING (public.is_admin());

-- ─── question_assignments ───────────────────────────────────────────────────

DROP POLICY IF EXISTS "Assigned user can read own assignments" ON public.question_assignments;
CREATE POLICY "Assignee, assigner, owner or admin reads an assignment"
  ON public.question_assignments FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid() OR assigned_by = auth.uid()
    OR public.is_response_owner(opportunity_id) OR public.is_admin()
  );

DROP POLICY IF EXISTS "Authenticated users can insert assignments" ON public.question_assignments;
CREATE POLICY "Owner or admin assigns questions"
  ON public.question_assignments FOR INSERT TO authenticated
  WITH CHECK (
    assigned_by = auth.uid()
    AND (public.is_response_owner(opportunity_id) OR public.is_admin())
  );

DROP POLICY IF EXISTS "Assigned user can update own assignments" ON public.question_assignments;
CREATE POLICY "Assignee, owner or admin updates an assignment"
  ON public.question_assignments FOR UPDATE TO authenticated
  USING (assigned_to = auth.uid() OR public.is_response_owner(opportunity_id) OR public.is_admin())
  WITH CHECK (assigned_to IS NOT NULL);

DROP POLICY IF EXISTS "Admin or assigner can delete assignments" ON public.question_assignments;
CREATE POLICY "Owner or admin removes an assignment"
  ON public.question_assignments FOR DELETE TO authenticated
  USING (public.is_response_owner(opportunity_id) OR public.is_admin());

-- ─── opportunity_contributors ───────────────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can add opportunity contributors" ON public.opportunity_contributors;
CREATE POLICY "Owner or admin adds contributors"
  ON public.opportunity_contributors FOR INSERT TO authenticated
  WITH CHECK (public.is_response_owner(opportunity_id) OR public.is_admin());

DROP POLICY IF EXISTS "Authenticated users can remove opportunity contributors" ON public.opportunity_contributors;
CREATE POLICY "Owner or admin removes contributors"
  ON public.opportunity_contributors FOR DELETE TO authenticated
  USING (public.is_response_owner(opportunity_id) OR public.is_admin());

-- ─── Anonymous visitors: no table access at all ─────────────────────────────

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
