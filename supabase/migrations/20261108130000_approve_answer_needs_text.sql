-- Sprint 21 security review (8): approve_answer() (20261108110000) approved a NULL answer (which
-- falls back to the model's draft) or an empty one. An approval through it now needs text. The
-- direct UPDATE path is unchanged; the app approves only through this function.
CREATE OR REPLACE FUNCTION public.approve_answer(p_question uuid, p_answer text, p_only_pending boolean DEFAULT false)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  st text;
BEGIN
  IF p_answer IS NULL OR btrim(p_answer) = '' THEN
    RAISE EXCEPTION 'Write the answer before approving it' USING ERRCODE = '22023';
  END IF;
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
