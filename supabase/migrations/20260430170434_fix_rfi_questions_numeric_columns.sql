/*
  # Fix numeric column precision on rfi_questions

  ## Problem
  The `confidence` column is numeric(4,3) and `retrieval_score` is numeric(7,6).
  Raw TF-IDF retrieval scores computed client-side can have more than 6 decimal
  places, causing the INSERT to be silently rejected by Postgres's precision
  constraint. This is why rfi_questions has always been empty despite sessions
  being created successfully.

  ## Changes
  - Alter `confidence` to plain `numeric` (unconstrained precision)
  - Alter `retrieval_score` to plain `numeric` (unconstrained precision)
  - Keep the existing CHECK constraint (0–1) on confidence
*/

ALTER TABLE rfi_questions
  ALTER COLUMN confidence TYPE numeric,
  ALTER COLUMN retrieval_score TYPE numeric;
