-- Sprint 11 security review: fixes for the three medium findings and the low ones in the database.

-- M2: record_skip kept OLD.skipped_by when the foreign key's ON DELETE SET NULL cleared it, so a
-- deleted person's id stayed behind. Only a signed-in user's change keeps the earlier value.
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
  ELSIF current_user = 'authenticated' THEN
    -- Still skipped: a person cannot change who did it.
    NEW.skipped_by := OLD.skipped_by;
    NEW.skipped_at := OLD.skipped_at;
  END IF;
  RETURN NEW;
END;
$$;

-- M3: deleting a person's account works again when they contributed to, were assigned on, or
-- skipped a question in an archived response.
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
  -- Sprint 11 review (M3): deleting a person's account removes or anonymises their rows, archived
  -- or not. These are the database's own referential actions (inside another trigger, after the
  -- profile row is gone), recognised by that: a contributor or assignment row for a person who no
  -- longer exists, or a question whose only change is forgetting who skipped it.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'opportunity_contributors'
       AND NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (row_json->>'user_id')::uuid) THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'question_assignments'
       AND (NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (row_json->>'assigned_to')::uuid)
            OR NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (row_json->>'assigned_by')::uuid)) THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'rfi_questions'
       AND (to_jsonb(OLD) ->> 'skipped_by') IS NOT NULL AND (row_json ->> 'skipped_by') IS NULL
       AND (to_jsonb(OLD) - 'skipped_by') = (row_json - 'skipped_by')
       AND NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = (to_jsonb(OLD) ->> 'skipped_by')::uuid) THEN
      RETURN NEW;
    END IF;
  END IF;
  -- An admin deleting a response created in error is the one change allowed.
  IF opp IS NOT NULL AND public.current_operation('deleting_response') IS DISTINCT FROM opp::text
     AND EXISTS (SELECT 1 FROM public.opportunities o WHERE o.id = opp AND o.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This response is archived and can no longer be changed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Low 1: triggers on one event fire in name order. The change-after-export trigger now runs after
-- the one that reopens a changed accepted answer, so its audit row records the final status.
DROP TRIGGER IF EXISTS rfi_questions_change_after_export ON public.rfi_questions;
DROP TRIGGER IF EXISTS rfi_questions_zz_change_after_export ON public.rfi_questions;
CREATE TRIGGER rfi_questions_zz_change_after_export
  BEFORE UPDATE OF status, final_answer ON public.rfi_questions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.final_answer IS DISTINCT FROM NEW.final_answer)
  EXECUTE FUNCTION public.note_change_after_export();

-- Low 2: a change keeps what was learned before, so that recording the export again can tell an
-- unchanged answer (learns nothing) from a corrected one.
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
  -- Considered again when the export is recorded again; learned again only if the answer changed.
  NEW.learned_at := NULL;
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
    -- Sprint 11 review (low 2): on a re-export, a question whose answer is what was learned before
    -- learns nothing again (no copy of the entry, and no fresh confirmation of the cited entries).
    IF reexport AND q.learn_outcome IS NOT NULL AND (
         (q.learned_entry_id IS NOT NULL AND answer = (SELECT btrim(k.answer) FROM public.kb_entries k WHERE k.id = q.learned_entry_id))
         OR (q.learn_outcome IN ('confirmed', 'not_confirmed_source') AND answer = btrim(coalesce(q.generated_answer, '')))) THEN
      UPDATE public.rfi_questions SET learned_at = now() WHERE id = q.id;
      CONTINUE;
    END IF;
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
    -- Sprint 11 (S11-2): a question held because some entries were not yet indexed was accepted by a
    -- person on its own, like the source gates, so it is learned too.
    ELSIF q.gate IS NOT NULL AND q.gate NOT IN ('legal', 'unreviewed_source', 'stale_source', 'unindexed_entries') THEN
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

-- Low 4: an admin's direct changes to the knowledge base (deleting an entry, changing its tags or
-- source) are audited too. Changes made by the database's own functions are audited by them.
CREATE OR REPLACE FUNCTION public.audit_entry_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (actor, action, target_id, details)
    VALUES (auth.uid(), 'kb.deleted', OLD.id, jsonb_build_object('ref', OLD.ref, 'question', OLD.question, 'answer', OLD.answer));
    RETURN OLD;
  END IF;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.changed', NEW.id, jsonb_build_object('ref', NEW.ref,
    'before', jsonb_build_object('tags', to_jsonb(OLD.tags), 'source', OLD.source),
    'after', jsonb_build_object('tags', to_jsonb(NEW.tags), 'source', NEW.source)));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_entry_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS kb_entries_audit_direct ON public.kb_entries;
CREATE TRIGGER kb_entries_audit_direct AFTER DELETE OR UPDATE OF tags, source ON public.kb_entries
  FOR EACH ROW WHEN (current_user = 'authenticated')
  EXECUTE FUNCTION public.audit_entry_change();

-- Low 8: the purge deletes reservations by date.
CREATE INDEX IF NOT EXISTS ai_reservations_created_at ON public.ai_reservations (created_at);
