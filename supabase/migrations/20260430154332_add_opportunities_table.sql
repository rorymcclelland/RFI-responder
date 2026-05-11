/*
  # Add Opportunities Table

  Introduces the concept of an "Opportunity" — a named deal or bid that groups
  one or more RFI sessions under a single trackable entity.

  ## New Tables

  ### opportunities
  One row per opportunity (deal/bid/tender).
  - id: UUID primary key
  - name: human-readable opportunity name
  - status: new | in_progress | won | lost
  - created_at: creation timestamp
  - updated_at: last modification timestamp

  ## Modified Tables

  ### rfi_sessions
  - opportunity_id (nullable FK to opportunities): links a session to an opportunity

  ## Security
  - RLS enabled on opportunities
  - Anon role granted read/write/update (matching existing pattern on rfi_sessions)

  ## Notes
  1. opportunity_id is nullable so existing sessions without an opportunity are unaffected
  2. updated_at is managed via a trigger
*/

-- ─── opportunities ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS opportunities (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'in_progress', 'won', 'lost')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can view opportunities"
  ON opportunities FOR SELECT TO anon
  USING (name IS NOT NULL);

CREATE POLICY "Anon can insert opportunities"
  ON opportunities FOR INSERT TO anon
  WITH CHECK (name IS NOT NULL);

CREATE POLICY "Anon can update opportunities"
  ON opportunities FOR UPDATE TO anon
  USING (name IS NOT NULL)
  WITH CHECK (name IS NOT NULL);

-- ─── updated_at trigger ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opportunities_updated_at ON opportunities;
CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── link rfi_sessions → opportunities ────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'rfi_sessions' AND column_name = 'opportunity_id'
  ) THEN
    ALTER TABLE rfi_sessions
      ADD COLUMN opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rfi_sessions_opportunity_id
  ON rfi_sessions(opportunity_id);
