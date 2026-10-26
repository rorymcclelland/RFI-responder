-- Sprint 12 (S12-1, C-1; Rory, Q1): every knowledge-base entry knows its language, English or
-- Japanese, detected from its text by the database and never taken from a request. Japanese if the
-- question is in Japanese script, or at least a fifth of the answer is; an English answer that
-- mentions one Japanese name stays English. Being generated, it follows every correction.
ALTER TABLE public.kb_entries ADD COLUMN IF NOT EXISTS language text GENERATED ALWAYS AS (
  CASE WHEN question ~ '[ぁ-ヿ一-鿿]'
         OR length(regexp_replace(answer, '[^ぁ-ヿ一-鿿]', '', 'g')) * 5 >= greatest(length(answer), 1)
       THEN 'ja' ELSE 'en' END
) STORED;
