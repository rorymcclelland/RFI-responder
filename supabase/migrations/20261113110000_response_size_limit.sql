-- Sprint 26 (S26-1, F-73): a response holds at most 2,000 questions, so it can be marked as sent, and
-- approved in bulk, within the hosted database's 8-second limit for signed-in users. After the fix in
-- 20261113100000, staging sent 2,000 questions in 3.0 to 4.1 seconds, about half the limit
-- (docs/spikes/f73-sending-large-responses.md; Rory, 9 November). The app's spreadsheet reader already
-- stops at 2,000 rows a file, but nothing in the database limited a file's count: a hand-made request
-- could create a file of any size. The check runs when a file is added, when its count changes, and
-- when it moves to another response, for every caller.
--
-- The response's row is locked first, so two files added at once are checked one after the other: the
-- second waits for the first, then counts it (as Sprint 24 does for a file added while sending).

CREATE OR REPLACE FUNCTION private.response_size_within_limit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  max_questions CONSTANT integer := 2000;
  total bigint;
BEGIN
  IF NEW.question_count < 0 THEN
    RAISE EXCEPTION 'A file cannot have a negative number of questions.' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.opportunity_id IS NULL THEN
    IF NEW.question_count > max_questions THEN
      RAISE EXCEPTION 'A file can have at most % questions; this one has %.', to_char(max_questions, 'FM999,999,999'),
        to_char(NEW.question_count, 'FM999,999,999') USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM 1 FROM public.opportunities o WHERE o.id = NEW.opportunity_id FOR UPDATE;
  SELECT coalesce(sum(s.question_count), 0) + NEW.question_count INTO total
    FROM public.rfi_sessions s
   WHERE s.opportunity_id = NEW.opportunity_id AND s.id IS DISTINCT FROM NEW.id;
  IF total > max_questions THEN
    RAISE EXCEPTION 'This response would have % questions; a response can have at most %, so that it can be marked as sent in one go. Put the rest in a new response.',
      to_char(total, 'FM999,999,999'), to_char(max_questions, 'FM999,999,999') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.response_size_within_limit() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER rfi_sessions_response_size_within_limit
  BEFORE INSERT OR UPDATE OF question_count, opportunity_id ON public.rfi_sessions
  FOR EACH ROW EXECUTE FUNCTION private.response_size_within_limit();
