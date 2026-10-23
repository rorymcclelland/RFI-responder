-- Sprint 4, story S4-3: entries added by members are reviewed, and drafts record what they cited.

ALTER TABLE public.rfi_questions ADD COLUMN cited_refs text[];
ALTER TABLE public.kb_entries
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;
