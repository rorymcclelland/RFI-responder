/*
  # Fix rfi_sessions and rfi_questions RLS policies for authenticated users

  Same root cause as opportunities: policies were anon-only. Replace with
  authenticated equivalents so logged-in users can read and write sessions
  and questions.
*/

-- rfi_sessions
DROP POLICY IF EXISTS "Anon can view sessions"   ON rfi_sessions;
DROP POLICY IF EXISTS "Anon can insert sessions" ON rfi_sessions;
DROP POLICY IF EXISTS "Anon can update sessions" ON rfi_sessions;

CREATE POLICY "Authenticated users can view sessions"
  ON rfi_sessions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert sessions"
  ON rfi_sessions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update sessions"
  ON rfi_sessions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- rfi_questions
DROP POLICY IF EXISTS "Anon can view questions"   ON rfi_questions;
DROP POLICY IF EXISTS "Anon can insert questions" ON rfi_questions;
DROP POLICY IF EXISTS "Anon can update questions" ON rfi_questions;

CREATE POLICY "Authenticated users can view questions"
  ON rfi_questions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert questions"
  ON rfi_questions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update questions"
  ON rfi_questions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
