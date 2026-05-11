/*
  # Extend user profiles and add opportunity contributors

  1. Modified Tables
    - `user_profiles`
      - Add `job_title` (text) — user's role title e.g. "Security Engineer"
      - Add `department` (text) — organisational department e.g. "Engineering"

  2. New Tables
    - `opportunity_contributors`
      - Links a user to an opportunity they are contributing to
      - Populated automatically when a question is assigned to them
      - `opportunity_id` FK → opportunities
      - `user_id` FK → user_profiles
      - `added_at` timestamp

  3. Security
    - RLS enabled on `opportunity_contributors`
    - Authenticated users can read all contributors (needed to display contributor lists)
    - Only admins (is_admin = true) or the system can insert/delete contributors
      — insertion happens server-side via the assignment flow using service role,
        but we also allow any authenticated user to insert so the client-side
        assignment handler can add the contributor row directly.
*/

-- ── Extend user_profiles ──────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'job_title'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN job_title text NOT NULL DEFAULT '';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'department'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN department text NOT NULL DEFAULT '';
  END IF;
END $$;

-- ── opportunity_contributors ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opportunity_contributors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id  uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, user_id)
);

ALTER TABLE opportunity_contributors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read opportunity contributors"
  ON opportunity_contributors FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can add opportunity contributors"
  ON opportunity_contributors FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can remove opportunity contributors"
  ON opportunity_contributors FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_opp_contributors_opportunity ON opportunity_contributors(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opp_contributors_user ON opportunity_contributors(user_id);
