/*
  # User Profiles, Expertise Tags, and Question Assignments

  ## New Tables

  ### `user_profiles`
  - Extends Supabase auth.users with display name and expertise tags
  - `id` (uuid, FK to auth.users)
  - `display_name` (text)
  - `expertise_tags` (text[]) — matches KB entry tags for routing recommendations
  - `is_admin` (boolean) — can manage users and see all assignments
  - `created_at`, `updated_at`

  ### `question_assignments`
  - Tracks which user a question has been assigned to for review
  - `id` (uuid)
  - `question_id` (text) — matches RFIQuestion.id stored in rfi_questions table
  - `session_id` (uuid, FK to rfi_sessions)
  - `opportunity_id` (uuid, FK to opportunities)
  - `assigned_to` (uuid, FK to user_profiles)
  - `assigned_by` (uuid, FK to user_profiles)
  - `question_text` (text) — denormalised for inbox display without session join
  - `answer_text` (text) — current answer
  - `status` (text): 'pending' | 'in_review' | 'answered' | 'approved'
  - `notes` (text) — reviewer notes
  - `created_at`, `updated_at`

  ## Security
  - RLS enabled on both tables
  - user_profiles: users can read all profiles, update only their own
  - question_assignments: assigned user can read/update their own; admins can do everything
*/

-- user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  text NOT NULL DEFAULT '',
  expertise_tags text[] NOT NULL DEFAULT '{}',
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read all profiles"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- question_assignments
CREATE TABLE IF NOT EXISTS question_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     text NOT NULL,
  session_id      uuid REFERENCES rfi_sessions(id) ON DELETE CASCADE,
  opportunity_id  uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  assigned_to     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  assigned_by     uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  question_text   text NOT NULL DEFAULT '',
  answer_text     text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','answered','approved')),
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_question_assignments_assigned_to ON question_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_question_assignments_session_id  ON question_assignments(session_id);
CREATE INDEX IF NOT EXISTS idx_question_assignments_question_id ON question_assignments(question_id);

ALTER TABLE question_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assigned user can read own assignments"
  ON question_assignments FOR SELECT
  TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Assigned user can update own assignments"
  ON question_assignments FOR UPDATE
  TO authenticated
  USING (
    assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Authenticated users can insert assignments"
  ON question_assignments FOR INSERT
  TO authenticated
  WITH CHECK (assigned_by = auth.uid());

CREATE POLICY "Admin or assigner can delete assignments"
  ON question_assignments FOR DELETE
  TO authenticated
  USING (
    assigned_by = auth.uid()
    OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
