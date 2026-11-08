-- Sprint 26 (S26-1, F-73): marking a large response as sent within the hosted database's time limit.
-- The Sprint 25 spike (docs/spikes/f73-sending-large-responses.md) found two costs that grow faster
-- than the number of questions. Neither change alters what is counted or learned:
--
-- 1. The approved-count trigger (Sprint 3) recounted a file after every update of its questions,
--    whatever changed; marking as sent updates each question once, so a file of n questions was
--    recounted n times. It now recounts only the files whose number of approved questions the
--    statement changed, counted from the statement's old and new rows separately (no join, which made
--    bulk approval slower in the spike), and still recounts exactly from the table.
-- 2. record_export found the cited entries' tags with `ref IN (subquery)`, which Postgres ran as a scan
--    of every entry; `ref = ANY (ARRAY(...))` uses the unique index on ref. The rest of the function is
--    as Sprint 23 left it (copied from the database). CREATE OR REPLACE keeps Sprint 25's revoke.

CREATE OR REPLACE FUNCTION public.refresh_accepted_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.rfi_sessions s
     SET accepted_count = (SELECT count(*) FROM public.rfi_questions q WHERE q.session_id = s.id AND q.status = 'accepted')
   WHERE s.id IN (
     SELECT d.session_id FROM (
       SELECT n.session_id, count(*) FILTER (WHERE n.status = 'accepted') AS c FROM new_rows n GROUP BY n.session_id
       UNION ALL
       SELECT o.session_id, -count(*) FILTER (WHERE o.status = 'accepted') FROM old_rows o GROUP BY o.session_id
     ) d
     GROUP BY d.session_id
     HAVING sum(d.c) <> 0);
  RETURN NULL;
END;
$$;

DROP TRIGGER rfi_questions_accepted_count ON public.rfi_questions;
CREATE TRIGGER rfi_questions_accepted_count
  AFTER UPDATE ON public.rfi_questions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_accepted_count();

CREATE OR REPLACE FUNCTION public.record_export(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  lang          text;
  qlang         text;
  translated    boolean;
  from_refs     text[];
  confirmed_refs text[];
  is_try        boolean;
BEGIN
  SELECT * INTO sess FROM public.rfi_sessions s WHERE s.id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (access.is_admin() OR (sess.opportunity_id IS NOT NULL AND access.is_response_owner(sess.opportunity_id))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can record an export' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO pending FROM public.rfi_questions WHERE session_id = p_session AND status = 'pending';
  IF pending > 0 THEN
    RAISE EXCEPTION '% question(s) are still pending; accept or skip every question before exporting', pending
      USING ERRCODE = '42501';
  END IF;
  SELECT o.name, o.trial INTO opp_name, is_try FROM public.opportunities o WHERE o.id = sess.opportunity_id;
  is_try := coalesce(is_try, false);
  -- Sprint 11 (S11-1): recording the export again after a change; only the changed questions learn.
  reexport := sess.exported_at IS NOT NULL;

  FOR q IN
    SELECT * FROM public.rfi_questions
     WHERE session_id = p_session AND status = 'accepted' AND learned_at IS NULL
     ORDER BY position
  LOOP
    new_id := NULL;
    -- Sprint 12 (S12-3): the reference list and a translation label are notes on the draft, not
    -- knowledge; they are left out of what is learned (security review, L1 and L2: exactly as the app
    -- writes them, at the end only).
    answer := private.learnable_text(coalesce(q.final_answer, q.generated_answer, ''));
    -- The learned entry's language: its own text's, as the generated column will have it.
    lang := public.text_language(q.question, answer);
    -- Translated (security review, M2 and M3): decided against the question's language, as when the
    -- question was processed, not the answer's. A draft (generated or assembled, edited or not) is
    -- translated when it was gated as one, when a cited entry is in the other language, or when a
    -- cited entry is itself an unreviewed translation (its provenance is carried forward, so an
    -- unreviewed machine translation never becomes reviewed knowledge by being cited).
    qlang := coalesce(q.language, public.text_language(q.question, ''));
    from_refs := ARRAY(
      SELECT DISTINCT r FROM (
        SELECT k.ref AS r FROM public.kb_entries k
         WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[])) AND k.language <> qlang
        UNION
        SELECT unnest(k.translated_from) FROM public.kb_entries k
         WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[])) AND k.language = qlang
           AND k.translated_from IS NOT NULL AND k.reviewed_at IS NULL) x
       ORDER BY r);
    translated := coalesce(q.draft_kind IN ('generated', 'assembled')
                  AND (q.gate IS NOT DISTINCT FROM 'translation' OR cardinality(from_refs) > 0), false);
    IF translated AND cardinality(from_refs) = 0 THEN
      from_refs := coalesce(q.cited_refs, '{}'::text[]);
    END IF;
    -- Sprint 11 review (low 2): on a re-export, a question whose answer is what was learned before
    -- learns nothing again (no copy of the entry, and no fresh confirmation of the cited entries).
    IF reexport AND q.learn_outcome IS NOT NULL AND (
         (q.learned_entry_id IS NOT NULL AND answer = (SELECT btrim(k.answer) FROM public.kb_entries k WHERE k.id = q.learned_entry_id))
         OR (q.learn_outcome IN ('confirmed', 'not_confirmed_source') AND answer = private.learnable_text(q.generated_answer))) THEN
      UPDATE public.rfi_questions SET learned_at = now() WHERE id = q.id;
      CONTINUE;
    END IF;
    SELECT a.decided_by INTO approver FROM public.approvals a
     WHERE a.question_id = q.id ORDER BY a.decided_at DESC LIMIT 1;
    approver := coalesce(approver, auth.uid());
    -- Allow list: only questions the server processed, in English, with no gate but legal.
    -- Sprint 23 (S23-1, Q3): a visitor's try never teaches the shared knowledge base, and never
    -- confirms an entry it cited (that would reset the entry's review date).
    IF is_try THEN
      outcome := 'not_learned_try';
    ELSIF q.gate = 'pricing' THEN
      outcome := 'not_learned_pricing';
    ELSIF q.processed_at IS NULL THEN
      outcome := 'not_learned_unchecked';
    -- Legal answers are learned (Sprint 3, Q3). The Sprint 4 source gates concern the entries a
    -- draft cited, not the question, and a person accepted the answer individually, so they are
    -- learned too; a learned entry then goes through the S4-3 review rule.
    -- Sprint 11 (S11-2): a question held because some entries were not yet indexed was accepted by a
    -- person on its own, like the source gates, so it is learned too.
    ELSIF q.gate IS NOT NULL AND q.gate NOT IN ('legal', 'unreviewed_source', 'stale_source', 'unindexed_entries', 'translation', 'japanese') THEN
      outcome := 'not_learned_unchecked';
    ELSIF length(answer) = 0 THEN
      outcome := 'not_learned_empty';
    ELSIF q.draft_kind IN ('generated', 'assembled') AND NOT translated
          AND answer = private.learnable_text(q.generated_answer) THEN
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
        -- Sprint 18 security review (M1): only the entries actually confirmed (current: not replaced or
        -- retired) are named in the audit row, so a retired or replaced entry's history never says it
        -- was confirmed by use. A draft whose every cited entry was retired or replaced confirms nothing.
        WITH upd AS (
          UPDATE public.kb_entries k SET last_reviewed_at = now()
           WHERE k.ref = ANY (coalesce(q.cited_refs, '{}'::text[])) AND k.superseded_by IS NULL AND k.retired_at IS NULL
          RETURNING k.ref
        )
        SELECT coalesce(array_agg(upd.ref ORDER BY upd.ref), '{}'::text[]) INTO confirmed_refs FROM upd;
        IF cardinality(confirmed_refs) > 0 THEN
          INSERT INTO public.audit_log (actor, action, target_id, details)
          VALUES (auth.uid(), 'kb.confirmed', q.id, jsonb_build_object('refs', to_jsonb(confirmed_refs), 'approver', approver));
          outcome := 'confirmed';
        ELSIF coalesce(cardinality(q.cited_refs), 0) > 0 THEN
          outcome := 'not_confirmed_source';
        ELSE
          outcome := 'confirmed';
        END IF;
      END IF;
    ELSE
      top_ref := q.sources_json->0->>'id';
      top_score := (q.sources_json->0->>'score')::numeric;
      SELECT k.id INTO top_entry FROM public.kb_entries k WHERE k.ref = top_ref AND k.superseded_by IS NULL AND k.retired_at IS NULL;
      SELECT t.threshold INTO limit_score FROM public.learning_thresholds t WHERE t.embedding_model = q.embedding_model;
      SELECT coalesce(array_agg(DISTINCT tag), '{}') INTO tags
        FROM (SELECT unnest(k.tags) AS tag FROM public.kb_entries k
               -- Sprint 26 (S26-1, F-73): through the unique index on ref, not a scan of the knowledge base.
               WHERE k.ref = ANY (ARRAY(SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id'))) t;

      new_id := gen_random_uuid();
      -- The entry this answer would replace: the current entry for the same question, or a
      -- near-duplicate the judge confirmed (Sprint 3). Proposals waiting for review are not targets.
      -- Sprint 12 (S12-3): only an entry in the same language is replaced.
      SELECT k.id INTO replaces FROM public.kb_entries k
       WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL AND k.retired_at IS NULL AND k.language = lang
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly') AND q.judge_best_ref = top_ref))
       ORDER BY (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))) DESC
       LIMIT 1;
      -- Security review, finding 1: only an admin's approval replaces an entry at once (and the
      -- new entry starts reviewed). Anyone else's answer becomes a proposed replacement that sits
      -- beside the entry, unreviewed, until an admin reviews it.
      IF translated AND replaces IS NULL THEN
        -- Sprint 12 (S12-3; Rory, Q3): a translation waits for an admin's review, whoever approved it.
        outcome := 'translated';
      ELSIF replaces IS NULL THEN
        outcome := 'added';
      ELSIF public.user_is_admin(approver) AND NOT translated THEN
        SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
        UPDATE public.kb_entries k SET superseded_by = new_id WHERE k.id = replaces;
        outcome := 'superseded';
      ELSE
        outcome := 'proposed';
      END IF;
      INSERT INTO public.kb_entries (id, question, answer, tags, source, origin, origin_ref, created_by, proposed_replacement_of, translated_from)
      VALUES (new_id, left(btrim(q.question), 5000), left(answer, 20000), tags[1:6],
              left('RFI response: ' || coalesce(opp_name, sess.file_name), 500), 'response',
              format('response:%s/session:%s/question:%s', sess.opportunity_id, p_session, q.id),
              approver, CASE WHEN outcome = 'proposed' THEN replaces END,
              CASE WHEN translated THEN from_refs END);
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
$function$;
