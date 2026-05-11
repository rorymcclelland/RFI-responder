/*
  # RFI Response Workflow Tables

  Stores RFI sessions (one per uploaded file) and the individual questions
  within each session, including generated answers, confidence scores, and
  human review decisions.

  ## New Tables

  ### rfi_sessions
  One row per uploaded file / questionnaire run.
  - id: UUID primary key
  - file_name: original uploaded filename
  - status: in_progress | completed
  - question_count: total questions extracted
  - accepted_count: questions accepted/edited by user
  - created_at: session start timestamp

  ### rfi_questions
  One row per extracted question in a session.
  - id: UUID primary key
  - session_id: FK to rfi_sessions (cascades on delete)
  - position: ordinal position in the source file (0-based)
  - question: the raw question text
  - generated_answer: KB-synthesised draft answer
  - final_answer: user-edited final answer (starts = generated_answer)
  - confidence: 0.000–1.000 combined confidence score
  - retrieval_score: raw TF-IDF cosine similarity of top KB match
  - status: pending | accepted | skipped
  - sources_json: JSON array of KB entry IDs used for the answer
  - created_at: when the question was processed

  ## Security
  - RLS enabled on both tables
  - Anon role granted read/write for prototype (no auth required)
  - No DELETE policies — session history is preserved
*/

-- ─── rfi_sessions ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rfi_sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'in_progress'
                             CHECK (status IN ('in_progress', 'completed')),
  question_count int         NOT NULL DEFAULT 0,
  accepted_count int         NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rfi_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can view sessions"
  ON rfi_sessions FOR SELECT TO anon
  USING (file_name IS NOT NULL);

CREATE POLICY "Anon can insert sessions"
  ON rfi_sessions FOR INSERT TO anon
  WITH CHECK (file_name IS NOT NULL);

CREATE POLICY "Anon can update sessions"
  ON rfi_sessions FOR UPDATE TO anon
  USING (file_name IS NOT NULL)
  WITH CHECK (file_name IS NOT NULL);

-- ─── rfi_questions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rfi_questions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid        NOT NULL REFERENCES rfi_sessions(id) ON DELETE CASCADE,
  position         int         NOT NULL DEFAULT 0,
  question         text        NOT NULL,
  generated_answer text,
  final_answer     text,
  confidence       numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  retrieval_score  numeric(7,6),
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'accepted', 'skipped')),
  sources_json     jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rfi_questions_session_id
  ON rfi_questions(session_id);

CREATE INDEX IF NOT EXISTS idx_rfi_questions_confidence
  ON rfi_questions(confidence ASC);

ALTER TABLE rfi_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can view questions"
  ON rfi_questions FOR SELECT TO anon
  USING (question IS NOT NULL);

CREATE POLICY "Anon can insert questions"
  ON rfi_questions FOR INSERT TO anon
  WITH CHECK (question IS NOT NULL AND session_id IS NOT NULL);

CREATE POLICY "Anon can update questions"
  ON rfi_questions FOR UPDATE TO anon
  USING (question IS NOT NULL)
  WITH CHECK (question IS NOT NULL);
