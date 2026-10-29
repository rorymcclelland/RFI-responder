-- Sprint 18 (S18-1, BUG-42): entry numbers past KB-9999.
--
-- ref was 'KB-' || lpad(seq::text, 4, '0'), and lpad cuts longer text to four characters, so entry
-- 10,000 would have been numbered KB-1000 and refused as a repeat. Postgres 16 cannot change a
-- generated column's expression in place, so the column is rebuilt with the same name and
-- constraint. Every existing number is unchanged (seq is below 10,000), and functions that use ref
-- read it by name.
ALTER TABLE public.kb_entries DROP COLUMN ref;
ALTER TABLE public.kb_entries
  ADD COLUMN ref text GENERATED ALWAYS AS (
    'KB-' || CASE WHEN seq < 10000 THEN lpad(seq::text, 4, '0') ELSE seq::text END) STORED;
ALTER TABLE public.kb_entries ADD CONSTRAINT kb_entries_ref_key UNIQUE (ref);
