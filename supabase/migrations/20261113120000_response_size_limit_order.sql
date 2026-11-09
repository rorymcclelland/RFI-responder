-- Sprint 26 (S26-1), from the QA review: the response-size trigger must take its lock on the response
-- before Sprint 24's no_file_once_sent reads it FOR SHARE. Triggers fire in name order, so under its
-- first name it came second: two files added at the same moment could each take the share lock, then
-- each wait for the other's to upgrade, and Postgres aborted one ("deadlock detected") instead of
-- counting them in turn. Renamed so it fires first; nothing else changes.
ALTER TRIGGER rfi_sessions_response_size_within_limit ON public.rfi_sessions
  RENAME TO rfi_sessions_a_response_size_within_limit;

-- Sprint 26 (S26-1), from the security review (M1): the size limit counts a file's stated number of
-- questions, so a file must not hold more than it states. Through the API (signed-in users, visitors,
-- the service role) a question beyond the file's count is refused. The database owner is not limited:
-- the demo loaders and the tests' fixtures make a file and then add its questions. The file's row is
-- locked first, and this trigger fires before Sprint 24's no_question_once_sent (which reads it FOR
-- SHARE), so two inserts at once are counted in turn without deadlocking.
CREATE OR REPLACE FUNCTION private.no_question_beyond_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  stated integer;
  held bigint;
BEGIN
  IF coalesce(current_setting('role', true), 'none') NOT IN ('authenticated', 'anon', 'service_role') THEN
    RETURN NEW;
  END IF;
  SELECT s.question_count INTO stated FROM public.rfi_sessions s WHERE s.id = NEW.session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NEW;  -- the foreign key refuses it
  END IF;
  SELECT count(*) INTO held FROM public.rfi_questions q WHERE q.session_id = NEW.session_id;
  IF held >= stated THEN
    RAISE EXCEPTION 'This file said it had % questions, and holds them all, so no more can be added.',
      to_char(stated, 'FM999,999,999') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.no_question_beyond_count() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER rfi_questions_a_no_question_beyond_count
  BEFORE INSERT ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION private.no_question_beyond_count();
