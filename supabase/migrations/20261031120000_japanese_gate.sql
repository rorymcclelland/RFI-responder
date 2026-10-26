-- Sprint 12 (S12-2; Rory, Q2): a Japanese question answered from Japanese entries is not translated,
-- but the Japanese drafting is unverified until a native reader checks the Japanese evaluation items
-- (F-14), so it is held from bulk approval with its own gate, 'japanese'. 'translation' now means a
-- draft that crosses languages, in either direction.
ALTER TABLE public.rfi_questions DROP CONSTRAINT rfi_questions_gate_check;
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_gate_check
  CHECK (gate IN ('pricing', 'legal', 'unchecked', 'translation', 'japanese', 'unreviewed_source', 'stale_source', 'unindexed_entries'));
