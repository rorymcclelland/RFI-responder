-- Sprint 11 (S11-10, F-54; Rory, Q6): who skipped a question, and when. Acceptances were recorded
-- in approvals from Sprint 3; a skip left no name. Set by the database on the change of status,
-- cleared on restore, and never taken from the request.
ALTER TABLE public.rfi_questions
  ADD COLUMN IF NOT EXISTS skipped_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS skipped_at timestamptz;

CREATE OR REPLACE FUNCTION public.record_skip()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_user = 'authenticated' THEN
      NEW.skipped_by := NULL;
      NEW.skipped_at := NULL;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'skipped' AND OLD.status IS DISTINCT FROM 'skipped' THEN
    NEW.skipped_by := auth.uid();
    NEW.skipped_at := now();
  ELSIF NEW.status IS DISTINCT FROM 'skipped' THEN
    NEW.skipped_by := NULL;
    NEW.skipped_at := NULL;
  ELSE
    -- Still skipped: keep who did it, whatever the request says.
    NEW.skipped_by := OLD.skipped_by;
    NEW.skipped_at := OLD.skipped_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS rfi_questions_record_skip ON public.rfi_questions;
CREATE TRIGGER rfi_questions_record_skip BEFORE INSERT OR UPDATE ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION public.record_skip();
