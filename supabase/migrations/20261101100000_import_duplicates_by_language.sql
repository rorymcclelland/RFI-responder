-- Sprint 13 (S13-2, F-61; Rory, Q3): an imported row is a duplicate only when the same question is
-- already held in the same language, within the file or in the knowledge base, as the unique index
-- on (question_key, language) has allowed since Sprint 12. Otherwise unchanged from 20261023150000.
-- The language is the entry's own rule (public.text_language, the generated column's), which this
-- definer function may call although members may not.

CREATE OR REPLACE FUNCTION public.import_kb_entries(
  entries     jsonb,
  entry_origin public.kb_origin,
  entry_origin_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  total      int;
  valid      int;
  inserted   int;
BEGIN
  -- SECURITY DEFINER because members no longer hold INSERT on origin_ref. That makes this
  -- function the gate: it checks the caller, the origin and every value it writes, and it
  -- records the caller as created_by.
  -- entry_origin_ref is the import's file name, kept as provenance (trimmed, at most 255
  -- characters). Learned entries get their origin_ref from record_export only.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to import' USING ERRCODE = '42501';
  END IF;
  IF entry_origin NOT IN ('import', 'manual') THEN
    RAISE EXCEPTION 'Origin % cannot be used for imports', entry_origin USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array' USING ERRCODE = '22023';
  END IF;
  total := jsonb_array_length(entries);
  IF total > 2000 THEN
    RAISE EXCEPTION 'Import at most 2,000 entries at a time' USING ERRCODE = '54000';
  END IF;

  WITH raw AS (
    SELECT ord,
           btrim(coalesce(e->>'question', '')) AS question,
           btrim(coalesce(e->>'answer', ''))   AS answer,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(e->'tags', '[]'::jsonb))), '{}') AS tags,
           left(btrim(coalesce(e->>'source', '')), 500) AS source
    FROM jsonb_array_elements(entries) WITH ORDINALITY AS t(e, ord)
  ),
  ok AS (
    SELECT *, lower(regexp_replace(question, '\s+', ' ', 'g')) AS key, public.text_language(question, answer) AS lang
    FROM raw
    WHERE length(question) BETWEEN 1 AND 5000 AND length(answer) BETWEEN 1 AND 20000
  ),
  first_of_each AS (
    SELECT DISTINCT ON (key, lang) * FROM ok ORDER BY key, lang, ord
  ),
  ins AS (
    INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref, created_by)
    SELECT f.question, f.answer, f.tags, f.source, entry_origin, nullif(left(btrim(coalesce(entry_origin_ref, '')), 255), ''), auth.uid()
    FROM first_of_each f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.kb_entries k WHERE k.question_key = f.key AND k.language = f.lang AND k.superseded_by IS NULL
    )
    ORDER BY f.ord
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ok), (SELECT count(*) FROM ins) INTO valid, inserted;

  RETURN jsonb_build_object('inserted', inserted, 'duplicates', valid - inserted, 'invalid', total - valid);
END;
$$;
