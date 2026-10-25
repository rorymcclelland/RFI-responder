-- Sprint 11 (S11-7): admin changes all audited, assignments created as intended, and an empty
-- search path everywhere. From reading the code for the Sprint 10 data model reference.

-- F-49: a change of model prices changes every cost estimate, so it is audited like the settings.
CREATE OR REPLACE FUNCTION public.audit_price_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'prices.changed', NULL, jsonb_build_object(
    'operation', lower(TG_OP),
    'before', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    'after',  CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_price_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS ai_prices_audit ON public.ai_prices;
CREATE TRIGGER ai_prices_audit AFTER INSERT OR UPDATE OR DELETE ON public.ai_prices
  FOR EACH ROW EXECUTE FUNCTION public.audit_price_change();

-- F-49: an entry is replaced only through review_entry and record_export, which check and audit it.
REVOKE UPDATE (superseded_by) ON public.kb_entries FROM authenticated;

-- F-49: archiving locks contributors too, like the response's sessions, questions and assignments.
DROP TRIGGER IF EXISTS opportunity_contributors_archived ON public.opportunity_contributors;
CREATE TRIGGER opportunity_contributors_archived BEFORE INSERT OR UPDATE OR DELETE ON public.opportunity_contributors
  FOR EACH ROW EXECUTE FUNCTION public.refuse_if_archived();

-- F-50: a new assignment starts pending, now, with the question's own text. What the person
-- assigning supplies is the question, the session, the response, the assignee and the proposed
-- answer; anything else they send is replaced. Applies to signed-in users, not to the database's
-- own functions or tests set up as the superuser.
CREATE OR REPLACE FUNCTION public.normalise_new_assignment()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    NEW.status := 'pending';
    NEW.notes := '';
    NEW.completed_at := NULL;
    NEW.created_at := now();
    NEW.updated_at := now();
    NEW.question_text := (SELECT q.question FROM public.rfi_questions q WHERE q.id::text = NEW.question_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS question_assignments_normalise ON public.question_assignments;
CREATE TRIGGER question_assignments_normalise BEFORE INSERT ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.normalise_new_assignment();

-- F-51: the last function with a search path other than empty.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
