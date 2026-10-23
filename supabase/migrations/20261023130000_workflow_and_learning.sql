-- Sprint 3: workflow and the learning loop (docs/refinement/sprint-3.md; decision 0003).
--
-- S3-1  responses get a due date, export and archive dates and an outcome; the hand-set status
--       is replaced by a stage computed in the response_overview view.
-- S3-2  every acceptance is recorded in approvals (individual or bulk, with the models behind the
--       draft); several questions can only be accepted together through bulk_accept();
--       record_export() refuses while any question is pending, and is what triggers learning.
-- S3-3  archive_response() keeps finished responses read-only with their outcome;
--       delete_response() is admin-only, needs a reason and is logged.
-- S3-4  learning at export, inside record_export(): edited and person-written answers become
--       entries with provenance (pricing and Japanese never); near-duplicates are superseded;
--       unedited drafts confirm the entries they came from. Only the export creates entries with
--       origin 'response' (F-6).
-- S3-5  only the response owner, an admin or an assignee may decide a question (F-7).

-- ─── S3-1: responses ────────────────────────────────────────────────────────

ALTER TABLE public.opportunities
  ADD COLUMN due_date    date,
  ADD COLUMN exported_at timestamptz,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN outcome     text CHECK (outcome IN ('won', 'lost', 'withdrawn'));

-- Responses marked won or lost by hand become archived with that outcome.
UPDATE public.opportunities
   SET outcome = status, archived_at = coalesce(updated_at, now())
 WHERE status IN ('won', 'lost');
ALTER TABLE public.opportunities DROP COLUMN status;

REVOKE UPDATE ON public.opportunities FROM authenticated;
GRANT UPDATE (name, due_date, owner_id, updated_at) ON public.opportunities TO authenticated;

ALTER TABLE public.rfi_sessions ADD COLUMN exported_at timestamptz;
-- Sessions are completed only by record_export().
REVOKE UPDATE ON public.rfi_sessions FROM authenticated;

-- ─── S3-3: archived responses are read-only ─────────────────────────────────

CREATE OR REPLACE FUNCTION public.response_of_session(p_session uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT s.opportunity_id FROM public.rfi_sessions s WHERE s.id = p_session $$;
REVOKE ALL ON FUNCTION public.response_of_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.response_of_session(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refuse_if_archived()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  row_json jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  opp      uuid;
BEGIN
  IF TG_TABLE_NAME = 'rfi_questions' THEN
    opp := public.response_of_session((row_json->>'session_id')::uuid);
  ELSE
    opp := (row_json->>'opportunity_id')::uuid; -- rfi_sessions, question_assignments
  END IF;
  -- An admin deleting a response created in error is the one change allowed.
  IF opp IS NOT NULL AND current_setting('app.deleting_response', true) IS DISTINCT FROM opp::text
     AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opp AND o.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This response is archived and can no longer be changed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refuse_if_archived() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER rfi_sessions_archived BEFORE INSERT OR UPDATE OR DELETE ON public.rfi_sessions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_if_archived();
CREATE TRIGGER rfi_questions_archived BEFORE INSERT OR UPDATE OR DELETE ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION public.refuse_if_archived();
CREATE TRIGGER question_assignments_archived BEFORE INSERT OR UPDATE OR DELETE ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.refuse_if_archived();

CREATE OR REPLACE FUNCTION public.refuse_archived_response_edit()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.archived_at IS NOT NULL AND current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'This response is archived and can no longer be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER opportunities_archived BEFORE UPDATE ON public.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.refuse_archived_response_edit();

-- ─── S3-5: who may decide a question (F-7) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.can_decide_question(p_question uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_admin()
      OR EXISTS (
           SELECT 1 FROM public.rfi_questions q
             JOIN public.rfi_sessions s ON s.id = q.session_id
             JOIN public.opportunities o ON o.id = s.opportunity_id
            WHERE q.id = p_question AND o.owner_id = auth.uid())
      OR EXISTS (
           SELECT 1 FROM public.question_assignments a
            WHERE a.question_id = p_question::text AND a.assigned_to = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.can_decide_question(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_decide_question(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authenticated users can update questions" ON public.rfi_questions;
CREATE POLICY "Owner, admin or assignee decides a question"
  ON public.rfi_questions FOR UPDATE TO authenticated
  USING (public.can_decide_question(id))
  WITH CHECK (public.can_decide_question(id));

-- ─── S3-2: approvals ────────────────────────────────────────────────────────

CREATE TABLE public.approvals (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id      uuid NOT NULL REFERENCES public.rfi_questions(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL REFERENCES public.rfi_sessions(id) ON DELETE CASCADE,
  opportunity_id   uuid REFERENCES public.opportunities(id) ON DELETE CASCADE,
  decided_by       uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  kind             text NOT NULL CHECK (kind IN ('individual', 'bulk')),
  threshold        numeric,
  confidence       numeric,
  gate             text,
  final_answer     text,
  judge_model      text,
  draft_model      text,
  prompt_version   text,
  calibration_set  text,
  decided_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_question ON public.approvals (question_id);
CREATE INDEX approvals_decided_by ON public.approvals (decided_by);
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.approvals FROM anon, authenticated;
GRANT SELECT ON public.approvals TO authenticated;
CREATE POLICY "Members read approvals" ON public.approvals FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.record_approval()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  bulk text := nullif(current_setting('app.bulk_threshold', true), '');
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    INSERT INTO public.approvals (question_id, session_id, opportunity_id, decided_by, kind, threshold, confidence,
                                  gate, final_answer, judge_model, draft_model, prompt_version, calibration_set)
    VALUES (NEW.id, NEW.session_id, public.response_of_session(NEW.session_id), auth.uid(),
            CASE WHEN bulk IS NULL THEN 'individual' ELSE 'bulk' END, bulk::numeric, NEW.confidence,
            NEW.gate, coalesce(NEW.final_answer, NEW.generated_answer), NEW.judge_model, NEW.draft_model,
            NEW.prompt_version, NEW.calibration_set);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.record_approval() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER rfi_questions_record_approval
  AFTER UPDATE OF status ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION public.record_approval();

-- Several questions can be accepted together only through bulk_accept(), so each approval is
-- recorded truthfully as individual or bulk. Other rules as in 20261023120000.
CREATE OR REPLACE FUNCTION public.check_bulk_acceptance()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  moved     int;
  changed   int;
  blocked   int;
  sessions  int;
  opp       uuid;
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'),
         count(*) FILTER (WHERE n.status IS DISTINCT FROM o.status OR n.final_answer IS DISTINCT FROM o.final_answer),
         count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'
                            AND (n.gate IS NOT NULL OR n.confidence IS NULL OR n.processed_at IS NULL
                                 OR n.draft_kind IS NULL OR n.draft_kind NOT IN ('generated', 'assembled'))),
         count(DISTINCT n.session_id)
    INTO moved, changed, blocked, sessions
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id;

  IF changed <= 1 THEN
    RETURN NULL;
  END IF;
  IF moved > 1 AND nullif(current_setting('app.bulk_threshold', true), '') IS NULL THEN
    RAISE EXCEPTION 'Accept several questions at once with bulk approval, so the decision is recorded'
      USING ERRCODE = '42501';
  END IF;
  IF moved > 1 AND blocked > 0 THEN
    RAISE EXCEPTION 'Bulk approval cannot include pricing, legal, translated, unchecked, unprocessed, uncalibrated or undrafted questions; accept those individually'
      USING ERRCODE = '42501';
  END IF;
  IF sessions > 1 THEN
    RAISE EXCEPTION 'Bulk changes work on one response session at a time' USING ERRCODE = '42501';
  END IF;

  SELECT s.opportunity_id INTO opp
    FROM public.rfi_sessions s
   WHERE s.id = (SELECT n.session_id FROM new_rows n LIMIT 1);
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can change several questions at once' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_accept(p_session uuid, p_min_confidence numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  opp               uuid;
  accepted          int;
  held_gated        int;
  held_uncalibrated int;
  held_no_draft     int;
  below             int;
BEGIN
  IF p_min_confidence IS NULL OR p_min_confidence < 0 OR p_min_confidence > 1 THEN
    RAISE EXCEPTION 'The confidence threshold must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  SELECT s.opportunity_id INTO opp FROM public.rfi_sessions s WHERE s.id = p_session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can approve questions in bulk' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE q.gate IS NOT NULL),
         count(*) FILTER (WHERE q.gate IS NULL AND (q.confidence IS NULL OR q.processed_at IS NULL)),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence IS NOT NULL
                            AND (q.draft_kind IS NULL OR q.draft_kind NOT IN ('generated', 'assembled'))),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL
                            AND q.draft_kind IN ('generated', 'assembled') AND q.confidence < p_min_confidence)
    INTO held_gated, held_uncalibrated, held_no_draft, below
    FROM public.rfi_questions q
   WHERE q.session_id = p_session AND q.status = 'pending';

  -- Marks this transaction's acceptances as bulk, with the threshold (read by record_approval).
  PERFORM set_config('app.bulk_threshold', p_min_confidence::text, true);
  UPDATE public.rfi_questions q
     SET status = 'accepted'
   WHERE q.session_id = p_session
     AND q.status = 'pending'
     AND q.gate IS NULL
     AND q.processed_at IS NOT NULL
     AND q.draft_kind IN ('generated', 'assembled')
     AND q.confidence IS NOT NULL
     AND q.confidence >= p_min_confidence;
  GET DIAGNOSTICS accepted = ROW_COUNT;
  PERFORM set_config('app.bulk_threshold', '', true);

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'heldNoDraft', held_no_draft,
    'belowThreshold', below
  );
END;
$$;

-- ─── S3-4: learning ─────────────────────────────────────────────────────────

-- Near-duplicate thresholds measured by `npm run eval:duplicates` (docs/evals/duplicates-*.md).
CREATE TABLE public.learning_thresholds (
  embedding_model text PRIMARY KEY,
  threshold       numeric NOT NULL CHECK (threshold BETWEEN 0 AND 1),
  evaluation_set  text NOT NULL
);
ALTER TABLE public.learning_thresholds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_thresholds FROM anon, authenticated;
GRANT SELECT ON public.learning_thresholds TO authenticated;
CREATE POLICY "Members read thresholds" ON public.learning_thresholds FOR SELECT TO authenticated USING (true);
INSERT INTO public.learning_thresholds VALUES
  ('voyage-4', 0.30, '2026-10-22.3'),
  ('qwen3-embedding:0.6b', 0.47, '2026-10-22.3');

ALTER TABLE public.rfi_questions
  ADD COLUMN learned_at       timestamptz,
  ADD COLUMN learn_outcome    text CHECK (learn_outcome IN ('added', 'superseded', 'confirmed', 'not_learned_pricing', 'not_learned_japanese', 'not_learned_empty')),
  ADD COLUMN learned_entry_id uuid REFERENCES public.kb_entries(id) ON DELETE SET NULL;

-- So a new entry and the entry it supersedes can be written in either order in one transaction.
ALTER TABLE public.kb_entries ALTER CONSTRAINT kb_entries_superseded_by_fkey DEFERRABLE INITIALLY IMMEDIATE;

-- F-6: entries that say they came from a response are created only by record_export().
DROP POLICY IF EXISTS "Members add entries as themselves" ON public.kb_entries;
CREATE POLICY "Members add entries as themselves"
  ON public.kb_entries FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND origin IN ('import', 'manual'));

-- ─── S3-2 and S3-4: record_export ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_export(p_session uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sess          record;
  opp_name      text;
  pending       int;
  q             record;
  approver      uuid;
  top_ref       text;
  top_score     numeric;
  top_entry     uuid;
  limit_score   numeric;
  new_id        uuid;
  tags          text[];
  outcome       text;
  answer        text;
  n             jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO sess FROM public.rfi_sessions s WHERE s.id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR (sess.opportunity_id IS NOT NULL AND public.is_response_owner(sess.opportunity_id))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can record an export' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO pending FROM public.rfi_questions WHERE session_id = p_session AND status = 'pending';
  IF pending > 0 THEN
    RAISE EXCEPTION '% question(s) are still pending; accept or skip every question before exporting', pending
      USING ERRCODE = '42501';
  END IF;
  SELECT o.name INTO opp_name FROM public.opportunities o WHERE o.id = sess.opportunity_id;

  -- Learning: each accepted question once, however many times the export is recorded.
  FOR q IN
    SELECT * FROM public.rfi_questions
     WHERE session_id = p_session AND status = 'accepted' AND learned_at IS NULL
     ORDER BY position
  LOOP
    new_id := NULL;
    -- Bulk approval keeps the draft as the answer without copying it into final_answer.
    answer := btrim(coalesce(q.final_answer, q.generated_answer, ''));
    IF q.gate = 'pricing' THEN
      outcome := 'not_learned_pricing';
    ELSIF q.language = 'ja' THEN
      outcome := 'not_learned_japanese';
    ELSIF length(answer) = 0 THEN
      outcome := 'not_learned_empty';
    ELSIF q.draft_kind IN ('generated', 'assembled') AND answer = btrim(q.generated_answer) THEN
      -- An unedited draft adds nothing new: it confirms the entries it was drawn from.
      UPDATE public.kb_entries k SET last_reviewed_at = now()
       WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id');
      outcome := 'confirmed';
    ELSE
      SELECT a.decided_by INTO approver FROM public.approvals a
       WHERE a.question_id = q.id ORDER BY a.decided_at DESC LIMIT 1;
      top_ref := q.sources_json->0->>'id';
      top_score := (q.sources_json->0->>'score')::numeric;
      SELECT k.id INTO top_entry FROM public.kb_entries k WHERE k.ref = top_ref AND k.superseded_by IS NULL;
      SELECT t.threshold INTO limit_score FROM public.learning_thresholds t WHERE t.embedding_model = q.embedding_model;
      SELECT coalesce(array_agg(DISTINCT tag), '{}') INTO tags
        FROM (SELECT unnest(k.tags) AS tag FROM public.kb_entries k
               WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id')) t;

      new_id := gen_random_uuid();
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
      outcome := 'added';
      -- The same question asked again, or a near-duplicate the judge confirmed, is superseded.
      UPDATE public.kb_entries k SET superseded_by = new_id
       WHERE k.superseded_by IS NULL
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly')));
      IF FOUND THEN
        outcome := 'superseded';
      END IF;
      INSERT INTO public.kb_entries (id, question, answer, tags, source, origin, origin_ref, created_by)
      VALUES (new_id, left(btrim(q.question), 5000), left(answer, 20000), tags[1:6],
              left('RFI response: ' || coalesce(opp_name, sess.file_name), 500), 'response',
              format('response:%s/session:%s/question:%s', sess.opportunity_id, p_session, q.id),
              coalesce(approver, auth.uid()));
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
    END IF;
    UPDATE public.rfi_questions SET learned_at = now(), learn_outcome = outcome, learned_entry_id = new_id WHERE id = q.id;
    n := jsonb_set(n, ARRAY[outcome], to_jsonb(coalesce((n->>outcome)::int, 0) + 1));
  END LOOP;

  UPDATE public.rfi_sessions SET status = 'completed', exported_at = now() WHERE id = p_session;
  IF sess.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities SET exported_at = now(), updated_at = now() WHERE id = sess.opportunity_id;
  END IF;

  n := n || jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'skipped'));
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.exported', p_session, n);
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.record_export(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_export(uuid) TO authenticated;

-- ─── S3-3: archive and delete ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.archive_response(p_response uuid, p_outcome text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public.opportunities WHERE id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR r.owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can archive a response' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('won', 'lost', 'withdrawn') THEN
    RAISE EXCEPTION 'The outcome must be won, lost or withdrawn' USING ERRCODE = '22023';
  END IF;
  IF r.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This response is already archived' USING ERRCODE = '42501';
  END IF;
  IF r.exported_at IS NULL AND p_outcome <> 'withdrawn' THEN
    RAISE EXCEPTION 'Record the export before archiving as won or lost; use withdrawn for a response that was never sent'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.opportunities SET archived_at = now(), outcome = p_outcome, updated_at = now() WHERE id = p_response;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.archived', p_response, jsonb_build_object('outcome', p_outcome));
END;
$$;
REVOKE ALL ON FUNCTION public.archive_response(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_response(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Only admins delete responses" ON public.opportunities;
REVOKE DELETE ON public.opportunities FROM authenticated;

CREATE OR REPLACE FUNCTION public.delete_response(p_response uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r       record;
  details jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can delete a response' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'Give a reason of at least 10 characters: deletion is only for responses created in error'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.opportunities WHERE id = p_response FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such response' USING ERRCODE = 'P0002';
  END IF;
  details := jsonb_build_object(
    'name', r.name, 'reason', left(btrim(p_reason), 500), 'owner', r.owner_id,
    'sessions', (SELECT count(*) FROM public.rfi_sessions WHERE opportunity_id = p_response),
    'questions', (SELECT count(*) FROM public.rfi_questions q JOIN public.rfi_sessions s ON s.id = q.session_id
                   WHERE s.opportunity_id = p_response));
  INSERT INTO public.audit_log (actor, action, target_id, details) VALUES (auth.uid(), 'response.deleted', p_response, details);
  PERFORM set_config('app.deleting_response', p_response::text, true);
  DELETE FROM public.rfi_sessions WHERE opportunity_id = p_response;
  DELETE FROM public.opportunities WHERE id = p_response;
  PERFORM set_config('app.deleting_response', '', true);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_response(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_response(uuid, text) TO authenticated;

-- ─── S3-1: the overview ─────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.response_overview
WITH (security_invoker = true)
AS
WITH counts AS (
  SELECT s.opportunity_id,
         count(q.id)                                                     AS total,
         count(q.id) FILTER (WHERE q.status = 'accepted')                AS accepted,
         count(q.id) FILTER (WHERE q.status = 'skipped')                 AS skipped,
         count(q.id) FILTER (WHERE q.status = 'pending')                 AS pending,
         count(q.id) FILTER (WHERE q.status = 'pending' AND q.gate IN ('pricing', 'legal')) AS gated_pending
    FROM public.rfi_sessions s
    LEFT JOIN public.rfi_questions q ON q.session_id = s.id
   GROUP BY s.opportunity_id
), assigned AS (
  SELECT a.opportunity_id, count(*) FILTER (WHERE a.status IN ('pending', 'in_review')) AS open_assignments
    FROM public.question_assignments a
   GROUP BY a.opportunity_id
), base AS (
  SELECT o.id, o.name, o.owner_id, p.display_name AS owner_name, o.due_date, o.created_at, o.updated_at,
         o.exported_at, o.archived_at, o.outcome,
         coalesce(c.total, 0)::int AS total, coalesce(c.accepted, 0)::int AS accepted,
         coalesce(c.skipped, 0)::int AS skipped, coalesce(c.pending, 0)::int AS pending,
         coalesce(c.gated_pending, 0)::int AS gated_pending,
         coalesce(a.open_assignments, 0)::int AS open_assignments,
         -- Working days from today to the due date (Monday to Friday), for the at-risk rule.
         CASE WHEN o.due_date IS NULL OR o.due_date < current_date THEN NULL
              ELSE (SELECT count(*)::int FROM generate_series(current_date + 1, o.due_date, interval '1 day') d
                     WHERE extract(isodow FROM d) < 6) END AS working_days_left
    FROM public.opportunities o
    LEFT JOIN public.user_profiles p ON p.id = o.owner_id
    LEFT JOIN counts c ON c.opportunity_id = o.id
    LEFT JOIN assigned a ON a.opportunity_id = o.id
)
SELECT b.*,
       b.accepted + b.skipped AS decided,
       CASE WHEN b.archived_at IS NOT NULL THEN 'archived'
            WHEN b.exported_at IS NOT NULL THEN 'exported'
            WHEN b.total = 0 THEN 'new'
            WHEN b.pending = 0 THEN 'ready'
            ELSE 'in_review' END AS stage,
       (b.due_date IS NOT NULL AND b.due_date < current_date AND b.exported_at IS NULL AND b.archived_at IS NULL) AS overdue,
       (b.due_date IS NOT NULL AND b.due_date >= current_date AND b.exported_at IS NULL AND b.archived_at IS NULL
        AND ((b.working_days_left <= 3 AND (b.total = 0 OR (b.accepted + b.skipped) < 0.8 * b.total))
             OR (b.due_date - current_date <= 1 AND b.gated_pending > 0))) AS at_risk
  FROM base b;

GRANT SELECT ON public.response_overview TO authenticated;
REVOKE ALL ON public.response_overview FROM anon;
