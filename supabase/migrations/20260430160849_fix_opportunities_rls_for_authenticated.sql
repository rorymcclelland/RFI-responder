/*
  # Fix opportunities RLS policies for authenticated users

  The existing policies were scoped to the `anon` role. Now that the app
  requires authentication, all requests come from the `authenticated` role,
  which was blocked. This migration drops the anon policies and replaces them
  with equivalent policies for authenticated users.
*/

DROP POLICY IF EXISTS "Anon can view opportunities"   ON opportunities;
DROP POLICY IF EXISTS "Anon can insert opportunities" ON opportunities;
DROP POLICY IF EXISTS "Anon can update opportunities" ON opportunities;
DROP POLICY IF EXISTS "Anon can delete opportunities" ON opportunities;

CREATE POLICY "Authenticated users can view opportunities"
  ON opportunities FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert opportunities"
  ON opportunities FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update opportunities"
  ON opportunities FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete opportunities"
  ON opportunities FOR DELETE
  TO authenticated
  USING (true);
