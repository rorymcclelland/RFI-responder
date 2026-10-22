/*
  # Knowledge base in the database (Sprint 0, story S0-4)

  Until now the knowledge base lived only in browser memory: imports and answers
  added back from a response were lost on reload. It is now a shared table.

  Provenance and versioning columns are created now, ahead of the learning loop
  in Sprint 3, so nothing needs back-filling later:
    origin / origin_ref   where an entry came from (seed, manual, import, response)
    created_by, created_at who added it, and when
    superseded_by          the newer entry that replaces it (Sprint 3)
    last_reviewed_at       when a person last confirmed it (Sprint 4)

  Access (decision 0003): every member reads and adds; only admins edit or delete.
  Imports go through import_kb_entries(), which is all-or-nothing and reports how
  many rows were inserted, skipped as duplicates, or rejected as invalid.
*/

CREATE TYPE public.kb_origin AS ENUM ('seed', 'manual', 'import', 'response');

CREATE TABLE public.kb_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq               bigint GENERATED ALWAYS AS IDENTITY,
  -- Short reference shown in drafts and citations, e.g. KB-0042.
  ref               text GENERATED ALWAYS AS ('KB-' || lpad(seq::text, 4, '0')) STORED UNIQUE,
  question          text NOT NULL CHECK (length(btrim(question)) BETWEEN 1 AND 5000),
  answer            text NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 20000),
  tags              text[] NOT NULL DEFAULT '{}',
  source            text NOT NULL DEFAULT '' CHECK (length(source) <= 500),
  origin            public.kb_origin NOT NULL,
  origin_ref        text CHECK (length(origin_ref) <= 500),
  created_by        uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  superseded_by     uuid REFERENCES public.kb_entries(id) ON DELETE SET NULL,
  last_reviewed_at  timestamptz,
  -- Used to spot duplicates regardless of case and spacing.
  question_key      text GENERATED ALWAYS AS (lower(regexp_replace(btrim(question), '\s+', ' ', 'g'))) STORED
);

-- One current entry per question. Superseded entries are kept for history.
CREATE UNIQUE INDEX kb_entries_current_question ON public.kb_entries (question_key) WHERE superseded_by IS NULL;
CREATE INDEX kb_entries_created_by ON public.kb_entries (created_by);

CREATE TRIGGER kb_entries_set_updated_at
  BEFORE UPDATE ON public.kb_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.kb_entries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.kb_entries FROM anon, authenticated;
GRANT SELECT, DELETE ON public.kb_entries TO authenticated;
GRANT INSERT (question, answer, tags, source, origin, origin_ref) ON public.kb_entries TO authenticated;
GRANT UPDATE (question, answer, tags, source, superseded_by, last_reviewed_at, updated_at) ON public.kb_entries TO authenticated;

CREATE POLICY "Members read the knowledge base"
  ON public.kb_entries FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Members add entries as themselves"
  ON public.kb_entries FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND origin <> 'seed');

CREATE POLICY "Admins edit entries"
  ON public.kb_entries FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete entries"
  ON public.kb_entries FOR DELETE TO authenticated
  USING (public.is_admin());

-- ─── Import ─────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: runs with the caller's rights, so the policies above apply.
-- A single statement, so the whole import succeeds or fails together.

CREATE OR REPLACE FUNCTION public.import_kb_entries(
  entries     jsonb,
  entry_origin public.kb_origin,
  entry_origin_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  total      int;
  valid      int;
  inserted   int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to import' USING ERRCODE = '42501';
  END IF;
  IF entry_origin NOT IN ('import', 'response', 'manual') THEN
    RAISE EXCEPTION 'Origin % cannot be used for imports', entry_origin USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array' USING ERRCODE = '22023';
  END IF;

  total := jsonb_array_length(entries);

  WITH raw AS (
    SELECT ord,
           btrim(coalesce(e->>'question', '')) AS question,
           btrim(coalesce(e->>'answer', ''))   AS answer,
           -- Raises (and so aborts the whole import) if tags is not an array of strings.
           coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(e->'tags', '[]'::jsonb))), '{}') AS tags,
           left(btrim(coalesce(e->>'source', '')), 500) AS source
    FROM jsonb_array_elements(entries) WITH ORDINALITY AS t(e, ord)
  ),
  ok AS (
    SELECT *, lower(regexp_replace(question, '\s+', ' ', 'g')) AS key
    FROM raw
    WHERE length(question) BETWEEN 1 AND 5000 AND length(answer) BETWEEN 1 AND 20000
  ),
  first_of_each AS (
    -- Within one file, keep the first occurrence of each question.
    SELECT DISTINCT ON (key) * FROM ok ORDER BY key, ord
  ),
  ins AS (
    INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref)
    SELECT f.question, f.answer, f.tags, f.source, entry_origin, entry_origin_ref
    FROM first_of_each f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.kb_entries k WHERE k.question_key = f.key AND k.superseded_by IS NULL
    )
    ORDER BY f.ord
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ok), (SELECT count(*) FROM ins) INTO valid, inserted;

  RETURN jsonb_build_object(
    'inserted',   inserted,
    'duplicates', valid - inserted,
    'invalid',    total - valid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_kb_entries(jsonb, public.kb_origin, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_kb_entries(jsonb, public.kb_origin, text) TO authenticated;
