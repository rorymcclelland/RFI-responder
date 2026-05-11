/*
  # Allow multiple assignments per question

  ## Summary
  Previously the application only stored one assignment per question (enforced by
  application logic, not a DB constraint). This migration makes the intent explicit
  and adds a `completed_at` timestamp so we can track when a question was first
  resolved.  It also adds a `question_id` + `session_id` index to make
  "find all assignments for this question" queries fast.

  ## Changes
  1. `question_assignments` — add `completed_at` (nullable timestamptz)
  2. New index `idx_question_assignments_question_session` on
     (question_id, session_id) for bulk sibling lookups
*/

-- Add completed_at if it doesn't exist yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'question_assignments' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE question_assignments ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

-- Index for sibling-lookup ("all assignments for this question in this session")
CREATE INDEX IF NOT EXISTS idx_question_assignments_question_session
  ON question_assignments (question_id, session_id);
