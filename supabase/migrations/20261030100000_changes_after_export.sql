-- Sprint 11 (S11-1, F-42; Rory, Q1): a change after an export is recorded, and the export is
-- recorded again.
--
-- Recording an export marked the session exported, but the owner, an admin or an assignee could
-- still change its questions afterwards, and nothing said so. Changes stay allowed; now each one
-- marks the session changed since export (and in progress again), writes who changed what to the
-- audit log, and clears the question's learning record so its corrected answer is learned when the
-- export is recorded again. record_export can be run again: it clears the mark, and its audit row
-- says it was a re-export. A response with a session changed since export shows that stage and
-- cannot be archived as won or lost until the export is recorded again.

ALTER TABLE public.rfi_sessions ADD COLUMN IF NOT EXISTS changed_since_export_at timestamptz;
-- Members have no update rights on rfi_sessions columns, so nobody can set or clear it directly.

CREATE OR REPLACE FUNCTION public.note_change_after_export()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  sess record;
BEGIN
  SELECT s.id, s.exported_at INTO sess FROM public.rfi_sessions s WHERE s.id = NEW.session_id;
  IF sess.exported_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- The corrected answer is learned when the export is recorded again.
  NEW.learned_at := NULL;
  NEW.learn_outcome := NULL;
  NEW.learned_entry_id := NULL;
  UPDATE public.rfi_sessions
     SET changed_since_export_at = coalesce(changed_since_export_at, now()), status = 'in_progress'
   WHERE id = sess.id;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'question.changed_after_export', NEW.id, jsonb_build_object(
    'session', sess.id, 'exported_at', sess.exported_at,
    'status_from', OLD.status, 'status_to', NEW.status,
    'answer_changed', OLD.final_answer IS DISTINCT FROM NEW.final_answer));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.note_change_after_export() FROM PUBLIC, anon, authenticated;

-- Only a change of decision or answer counts: record_export's own writes (learning outcomes) do not.
DROP TRIGGER IF EXISTS rfi_questions_change_after_export ON public.rfi_questions;
CREATE TRIGGER rfi_questions_change_after_export
  BEFORE UPDATE OF status, final_answer ON public.rfi_questions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.final_answer IS DISTINCT FROM NEW.final_answer)
  EXECUTE FUNCTION public.note_change_after_export();

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
  replaces      uuid;
  n             jsonb := '{}'::jsonb;
  reexport      boolean;
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
  -- Sprint 11 (S11-1): recording the export again after a change; only the changed questions learn.
  reexport := sess.exported_at IS NOT NULL;

  FOR q IN
    SELECT * FROM public.rfi_questions
     WHERE session_id = p_session AND status = 'accepted' AND learned_at IS NULL
     ORDER BY position
  LOOP
    new_id := NULL;
    answer := btrim(coalesce(q.final_answer, q.generated_answer, ''));
    SELECT a.decided_by INTO approver FROM public.approvals a
     WHERE a.question_id = q.id ORDER BY a.decided_at DESC LIMIT 1;
    approver := coalesce(approver, auth.uid());
    -- Allow list: only questions the server processed, in English, with no gate but legal.
    IF q.gate = 'pricing' THEN
      outcome := 'not_learned_pricing';
    ELSIF q.processed_at IS NULL THEN
      outcome := 'not_learned_unchecked';
    ELSIF q.language IS DISTINCT FROM 'en' OR q.gate = 'translation' OR q.question ~ '[ぁ-ヿ一-鿿]' THEN
      outcome := 'not_learned_japanese';
    -- Legal answers are learned (Sprint 3, Q3). The Sprint 4 source gates concern the entries a
    -- draft cited, not the question, and a person accepted the answer individually, so they are
    -- learned too; a learned entry then goes through the S4-3 review rule.
    ELSIF q.gate IS NOT NULL AND q.gate NOT IN ('legal', 'unreviewed_source', 'stale_source') THEN
      outcome := 'not_learned_unchecked';
    ELSIF length(answer) = 0 THEN
      outcome := 'not_learned_empty';
    ELSIF q.draft_kind IN ('generated', 'assembled') AND answer = btrim(q.generated_answer) THEN
      -- Security review, finding 2: a draft held because it cited an unreviewed or overdue entry
      -- confirms that entry only if an admin approved it; otherwise any member could clear an
      -- entry's review date by exporting from a response of their own.
      -- Sprint 6 review, finding 1: decided from the entries' state now, not only the stored gate,
      -- since an entry can fall overdue after processing (and a confirmation now releases holds).
      IF NOT public.user_is_admin(approver)
         AND (q.gate IN ('unreviewed_source', 'stale_source')
              OR (SELECT g.gate FROM private.source_gate(coalesce(q.cited_refs, '{}'::text[])) g) IS NOT NULL) THEN
        outcome := 'not_confirmed_source';
      ELSE
        -- F-25: only the entries the draft cited are confirmed (before Sprint 4, none were recorded).
        UPDATE public.kb_entries k SET last_reviewed_at = now()
         WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[])) AND k.superseded_by IS NULL;
        IF coalesce(cardinality(q.cited_refs), 0) > 0 THEN
          INSERT INTO public.audit_log (actor, action, target_id, details)
          VALUES (auth.uid(), 'kb.confirmed', q.id, jsonb_build_object('refs', to_jsonb(q.cited_refs), 'approver', approver));
        END IF;
        outcome := 'confirmed';
      END IF;
    ELSE
      top_ref := q.sources_json->0->>'id';
      top_score := (q.sources_json->0->>'score')::numeric;
      SELECT k.id INTO top_entry FROM public.kb_entries k WHERE k.ref = top_ref AND k.superseded_by IS NULL;
      SELECT t.threshold INTO limit_score FROM public.learning_thresholds t WHERE t.embedding_model = q.embedding_model;
      SELECT coalesce(array_agg(DISTINCT tag), '{}') INTO tags
        FROM (SELECT unnest(k.tags) AS tag FROM public.kb_entries k
               WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id')) t;

      new_id := gen_random_uuid();
      -- The entry this answer would replace: the current entry for the same question, or a
      -- near-duplicate the judge confirmed (Sprint 3). Proposals waiting for review are not targets.
      SELECT k.id INTO replaces FROM public.kb_entries k
       WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly') AND q.judge_best_ref = top_ref))
       ORDER BY (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))) DESC
       LIMIT 1;
      -- Security review, finding 1: only an admin's approval replaces an entry at once (and the
      -- new entry starts reviewed). Anyone else's answer becomes a proposed replacement that sits
      -- beside the entry, unreviewed, until an admin reviews it.
      IF replaces IS NULL THEN
        outcome := 'added';
      ELSIF public.user_is_admin(approver) THEN
        SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
        UPDATE public.kb_entries k SET superseded_by = new_id WHERE k.id = replaces;
        outcome := 'superseded';
      ELSE
        outcome := 'proposed';
      END IF;
      INSERT INTO public.kb_entries (id, question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of)
      VALUES (new_id, left(btrim(q.question), 5000), left(answer, 20000), tags[1:6],
              left('RFI response: ' || coalesce(opp_name, sess.file_name), 500), 'response',
              format('response:%s/session:%s/question:%s', sess.opportunity_id, p_session, q.id),
              approver, CASE WHEN outcome = 'proposed' THEN replaces END);
      SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
      replaces := NULL;
    END IF;
    UPDATE public.rfi_questions SET learned_at = now(), learn_outcome = outcome, learned_entry_id = new_id WHERE id = q.id;
    n := jsonb_set(n, ARRAY[outcome], to_jsonb(coalesce((n->>outcome)::int, 0) + 1));
  END LOOP;

  UPDATE public.rfi_sessions SET status = 'completed', exported_at = now(), changed_since_export_at = NULL WHERE id = p_session;
  IF sess.opportunity_id IS NOT NULL THEN
    UPDATE public.opportunities SET exported_at = now(), updated_at = now() WHERE id = sess.opportunity_id;
  END IF;

  -- F-26: the response is sent, so open expert assignments are closed (kept for history).
  UPDATE public.question_assignments SET status = 'closed', completed_at = now(), updated_at = now()
   WHERE session_id = p_session AND status IN ('pending', 'in_review');
  GET DIAGNOSTICS pending = ROW_COUNT;
  IF pending > 0 THEN
    n := n || jsonb_build_object('assignments_closed', pending);
  END IF;

  n := n || jsonb_build_object(
    'accepted', (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'accepted'),
    'skipped',  (SELECT count(*) FROM public.rfi_questions WHERE session_id = p_session AND status = 'skipped'));
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.exported', p_session, n || jsonb_build_object('re_export', reexport));
  RETURN n;
END;
$$;

-- Archiving as won or lost needs the export recorded since the last change.
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
  IF p_outcome <> 'withdrawn' AND EXISTS (
       SELECT 1 FROM public.rfi_sessions s WHERE s.opportunity_id = p_response AND s.changed_since_export_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Answers changed after the export was recorded; record the export again before archiving as won or lost'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.opportunities SET archived_at = now(), outcome = p_outcome, updated_at = now() WHERE id = p_response;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'response.archived', p_response, jsonb_build_object('outcome', p_outcome));
END;
$$;
REVOKE ALL ON FUNCTION public.archive_response(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_response(uuid, text) TO authenticated;

-- The overview's stage: 'changed' until the export is recorded again.
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
            WHEN EXISTS (SELECT 1 FROM public.rfi_sessions s WHERE s.opportunity_id = b.id AND s.changed_since_export_at IS NOT NULL) THEN 'changed'
            WHEN b.exported_at IS NOT NULL THEN 'exported'
            WHEN b.total = 0 THEN 'new'
            WHEN b.pending = 0 THEN 'ready'
            ELSE 'in_review' END AS stage,
       (b.due_date IS NOT NULL AND b.due_date < current_date AND b.exported_at IS NULL AND b.archived_at IS NULL) AS overdue,
       (b.due_date IS NOT NULL AND b.due_date >= current_date AND b.exported_at IS NULL AND b.archived_at IS NULL
        AND ((b.working_days_left <= 3 AND (b.total = 0 OR (b.accepted + b.skipped) < 0.8 * b.total))
             OR (b.due_date - current_date <= 1 AND b.gated_pending > 0))) AS at_risk
  FROM base b;
