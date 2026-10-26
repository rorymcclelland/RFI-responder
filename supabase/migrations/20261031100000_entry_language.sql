-- Sprint 12 (S12-1, C-1; Rory, Q1): every knowledge-base entry knows its language, English or
-- Japanese, detected from its text by the database and never taken from a request. Japanese if at
-- least a fifth of the question, or of the answer, is in Japanese script (kana or kanji), counting
-- characters other than spaces after NFKC folding (so half-width katakana counts); an English text
-- that mentions one Japanese name stays English (Sprint 12 security review, L3: one rule, the same
-- in public.text_language and in the TypeScript textLanguage). Being generated, it follows every
-- correction.
ALTER TABLE public.kb_entries ADD COLUMN IF NOT EXISTS language text GENERATED ALWAYS AS (
  CASE WHEN length(regexp_replace(normalize(question, NFKC), '[^ぁ-ヿ一-鿿]', '', 'g')) * 5
              >= greatest(length(regexp_replace(normalize(question, NFKC), '\s', '', 'g')), 1)
         OR length(regexp_replace(normalize(answer, NFKC), '[^ぁ-ヿ一-鿿]', '', 'g')) * 5
              >= greatest(length(regexp_replace(normalize(answer, NFKC), '\s', '', 'g')), 1)
       THEN 'ja' ELSE 'en' END
) STORED;
