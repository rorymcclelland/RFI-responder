-- Sprint 6 (S6-2): the near-duplicate thresholds for learning, refitted after the checker fix.
-- Before Sprint 6 about a third of the checker's replies were cut off and counted as "no", which
-- kept the judge condition strict and let the similarity threshold sit low (0.30). With readable
-- verdicts the checker says "yes" or "partly" more often, so similarity carries more of the
-- decision: at the old thresholds wrong supersessions would exceed the 2% bar. Values from
-- docs/evals/duplicates-2026-10-23-2.md and supabase/functions/_shared/duplicate-thresholds.json.

UPDATE public.learning_thresholds SET threshold = 0.55, evaluation_set = '2026-10-22.3 (judge-2026-10-24.1)' WHERE embedding_model = 'voyage-4';
UPDATE public.learning_thresholds SET threshold = 0.59, evaluation_set = '2026-10-22.3 (judge-2026-10-24.1)' WHERE embedding_model = 'qwen3-embedding:0.6b';
