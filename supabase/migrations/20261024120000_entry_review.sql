-- Sprint 4, story S4-3: entries added by members are reviewed by an admin, and drafts record
-- the entries they cited, so a draft resting on an unreviewed entry is never bulk-approved.
--
-- Who counts as having reviewed an entry when it is created:
-- - seed entries, and entries added or imported by an admin: reviewed at creation;
-- - entries added or imported by a member: unreviewed until an admin reviews them;
-- - entries learned at export (origin 'response'): reviewed only when the person who approved the
--   answer was the response owner or an admin. Since Sprint 3 an assignee can approve, and an
--   assignee is not someone with authority over the knowledge base.
-- Nobody writes the review columns directly; review_entry() is the only way to review.

ALTER TABLE public.rfi_questions ADD COLUMN cited_refs text[];
ALTER TABLE public.rfi_questions DROP CONSTRAINT rfi_questions_gate_check;
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_gate_check
  CHECK (gate IN ('pricing', 'legal', 'unchecked', 'translation', 'unreviewed_source', 'stale_source'));

ALTER TABLE public.kb_entries
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN reviewed_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.user_is_admin(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT p.is_admin FROM public.user_profiles p WHERE p.id = p_user), false);
$$;
REVOKE ALL ON FUNCTION public.user_is_admin(uuid) FROM PUBLIC, anon, authenticated;

-- Decides the review columns of a new entry; whatever the inserter sent is ignored, except for
-- system inserts with no signed-in user (seed data, migrations, tests as the superuser).
CREATE OR REPLACE FUNCTION public.set_entry_review_on_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  opp_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    IF NEW.origin = 'seed' AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := NEW.created_at;
    END IF;
    RETURN NEW;
  END IF;

  NEW.reviewed_at := NULL;
  NEW.reviewed_by := NULL;
  IF NEW.origin = 'response' THEN
    -- created_by is the approver (record_export); origin_ref starts 'response:<id>/'.
    SELECT o.owner_id INTO opp_owner FROM public.opportunities o
     WHERE o.id::text = substring(NEW.origin_ref FROM '^response:([0-9a-f-]{36})/');
    IF public.user_is_admin(NEW.created_by) OR (opp_owner IS NOT NULL AND NEW.created_by = opp_owner) THEN
      NEW.reviewed_at := now();
      NEW.reviewed_by := NEW.created_by;
    END IF;
  ELSIF public.user_is_admin(NEW.created_by) THEN
    NEW.reviewed_at := now();
    NEW.reviewed_by := NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_entry_review_on_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER kb_entries_review_on_insert BEFORE INSERT ON public.kb_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_entry_review_on_insert();

-- Existing entries, by the same rules.
UPDATE public.kb_entries k SET reviewed_at = coalesce(k.last_reviewed_at, k.created_at), reviewed_by = k.created_by
 WHERE k.origin = 'seed'
    OR public.user_is_admin(k.created_by)
    OR (k.origin = 'response' AND k.created_by = (
          SELECT o.owner_id FROM public.opportunities o
           WHERE o.id::text = substring(k.origin_ref FROM '^response:([0-9a-f-]{36})/')));

-- Admin review: approve as it is, or correct the text and approve. A changed text loses its
-- vector so the next indexing run embeds the corrected entry.
CREATE OR REPLACE FUNCTION public.review_entry(p_entry uuid, p_question text DEFAULT NULL, p_answer text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e       public.kb_entries;
  edited  boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can review knowledge-base entries' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.kb_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such entry' USING ERRCODE = 'P0002';
  END IF;
  IF e.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has been replaced by a newer one; review that instead' USING ERRCODE = '22023';
  END IF;
  edited := (p_question IS NOT NULL AND btrim(p_question) <> e.question) OR (p_answer IS NOT NULL AND btrim(p_answer) <> e.answer);
  UPDATE public.kb_entries
     SET question = CASE WHEN p_question IS NULL THEN question ELSE btrim(p_question) END,
         answer = CASE WHEN p_answer IS NULL THEN answer ELSE btrim(p_answer) END,
         reviewed_at = now(), reviewed_by = auth.uid(), last_reviewed_at = now(),
         embedding = CASE WHEN edited THEN NULL ELSE embedding END,
         embedding_model = CASE WHEN edited THEN NULL ELSE embedding_model END
   WHERE id = p_entry;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.reviewed', p_entry, jsonb_build_object('ref', e.ref, 'edited', edited,
          'previous', CASE WHEN edited THEN jsonb_build_object('question', e.question, 'answer', e.answer) END));
END;
$$;
REVOKE ALL ON FUNCTION public.review_entry(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_entry(uuid, text, text) TO authenticated;

-- When an entry should next be looked at (S4-4 uses it for the overdue report): its last review
-- or confirmation, else when it was reviewed, else when it was created, plus the interval.
CREATE OR REPLACE FUNCTION public.entry_review_due(e public.kb_entries)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(e.last_reviewed_at, e.reviewed_at, e.created_at)
         + make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s));
$$;
REVOKE ALL ON FUNCTION public.entry_review_due(public.kb_entries) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entry_review_due(public.kb_entries) TO authenticated, service_role;

-- For process-questions (service role): is each cited entry reviewed, and if it is overdue, since when.
CREATE OR REPLACE FUNCTION public.entry_review_status(p_refs text[])
RETURNS TABLE (ref text, reviewed boolean, overdue_since date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.ref, k.reviewed_at IS NOT NULL,
         CASE WHEN public.entry_review_due(k) < now() THEN public.entry_review_due(k)::date END
    FROM public.kb_entries k
   WHERE k.ref = ANY (p_refs);
$$;
REVOKE ALL ON FUNCTION public.entry_review_status(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entry_review_status(text[]) TO service_role;
