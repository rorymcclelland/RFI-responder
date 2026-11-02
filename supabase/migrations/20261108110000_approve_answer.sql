-- Sprint 21 (BUG-45): approving an answer in one step.
--
-- The app approved an answer with two saves, the text and then the decision, as the database's rules
-- require (a changed accepted answer reopens the question, so the new text is accepted afterwards).
-- Between the two, someone else could save their own text, and the approval then landed on text the
-- approver had not seen. Found by the Sprint 21 staging run.
--
-- approve_answer() makes both writes in one transaction, holding the question's row from the start,
-- so a second person's save waits and then sees the decision. Security invoker: the same rules apply
-- as to the two saves (who may change and decide the question, the gates, the triggers that record the
-- approval and reopen a changed answer). If the decision is refused, the text is not saved either.
-- p_only_pending: for a specialist answering from Questions for you, approve only a question still to
-- do, so a screen opened before the owner decided cannot overwrite the owner's decision.
-- Returns 'approved', or 'decided' (p_only_pending, and it was decided meanwhile), or 'refused' (the
-- caller cannot change it, or it does not exist).
CREATE FUNCTION public.approve_answer(p_question uuid, p_answer text, p_only_pending boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  st text;
BEGIN
  -- Locks the row for this transaction (a row the caller may not change is not found).
  SELECT q.status INTO st FROM public.rfi_questions q WHERE q.id = p_question FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'refused';
  END IF;
  IF p_only_pending AND st <> 'pending' THEN
    RETURN 'decided';
  END IF;
  UPDATE public.rfi_questions SET final_answer = p_answer WHERE id = p_question;
  IF NOT FOUND THEN
    RETURN 'refused';
  END IF;
  UPDATE public.rfi_questions SET status = 'accepted' WHERE id = p_question;
  IF NOT FOUND THEN
    -- Undo the text: an answer is saved with its decision or not at all.
    RAISE EXCEPTION 'You cannot approve this question' USING ERRCODE = '42501';
  END IF;
  RETURN 'approved';
END;
$$;
REVOKE ALL ON FUNCTION public.approve_answer(uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_answer(uuid, text, boolean) TO authenticated;
