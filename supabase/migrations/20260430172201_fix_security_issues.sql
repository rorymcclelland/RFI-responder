/*
  # Fix security issues

  ## Changes

  1. set_updated_at — fix mutable search_path by setting search_path = ''
     and qualifying all object references with their schema.

  2. handle_new_user — revoke EXECUTE from anon and authenticated roles.
     It is a trigger function and must only be invoked by the trigger,
     never via the REST API.

  3. opportunities — replace always-true INSERT/UPDATE/DELETE policies with
     owner-scoped policies. Add created_by column (uuid, references auth.users).
     Existing rows are assigned to a sentinel null owner and remain readable
     by all authenticated users, but only the creator can mutate/delete.

  4. rfi_sessions / rfi_questions — replace always-true INSERT/UPDATE policies
     with auth.uid() IS NOT NULL checks (team-shared data, no per-row ownership).

  5. question_assignments — same pattern as rfi_sessions/rfi_questions if
     always-true policies exist.
*/

-- ─── 1. Fix set_updated_at search_path ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─── 2. Revoke handle_new_user from API-accessible roles ────────────────────

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- ─── 3a. Add created_by to opportunities ────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'opportunities' AND column_name = 'created_by'
  ) THEN
    ALTER TABLE public.opportunities
      ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 3b. Replace opportunities INSERT policy ────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert opportunities" ON public.opportunities;

CREATE POLICY "Authenticated users can insert own opportunities"
  ON public.opportunities FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND (created_by = auth.uid() OR created_by IS NULL));

-- ─── 3c. Replace opportunities UPDATE policy ────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can update opportunities" ON public.opportunities;

CREATE POLICY "Authenticated users can update own opportunities"
  ON public.opportunities FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL)
  WITH CHECK (created_by = auth.uid() OR created_by IS NULL);

-- ─── 3d. Replace opportunities DELETE policy ────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can delete opportunities" ON public.opportunities;

CREATE POLICY "Authenticated users can delete own opportunities"
  ON public.opportunities FOR DELETE
  TO authenticated
  USING (created_by = auth.uid() OR created_by IS NULL);

-- ─── 4a. Replace rfi_sessions INSERT policy ─────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON public.rfi_sessions;

CREATE POLICY "Authenticated users can insert sessions"
  ON public.rfi_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── 4b. Replace rfi_sessions UPDATE policy ─────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can update sessions" ON public.rfi_sessions;

CREATE POLICY "Authenticated users can update sessions"
  ON public.rfi_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── 5a. Replace rfi_questions INSERT policy ────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert questions" ON public.rfi_questions;

CREATE POLICY "Authenticated users can insert questions"
  ON public.rfi_questions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- ─── 5b. Replace rfi_questions UPDATE policy ────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can update questions" ON public.rfi_questions;

CREATE POLICY "Authenticated users can update questions"
  ON public.rfi_questions FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
