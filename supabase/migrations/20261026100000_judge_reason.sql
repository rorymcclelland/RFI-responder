-- Sprint 6 (S6-1 and S6-3): the answerability checker's one-sentence reason, shown on the card.
-- Written only by process-questions (service role); no grant to signed-in users, so members,
-- owners and admins can read it with the row but never write it (decision 0003).

ALTER TABLE public.rfi_questions ADD COLUMN judge_reason text
  CHECK (judge_reason IS NULL OR char_length(judge_reason) <= 300);
