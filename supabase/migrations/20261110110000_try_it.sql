-- Sprint 23 (S23-1, U-8): Try it. A demo visitor's own response, made from a sample questionnaire.
--
-- opportunities.trial marks a try. It is set when the response is made (the visitor inserts it, as
-- any member makes a response they own) and never changed: there is no update grant for it, so
-- neither a try nor an ordinary response can become the other. A person has at most one open try.
--
-- Rory's answers: the lists show a person their own tries and admins all of them (Q2: a filter in
-- the app; the access rule is unchanged, every member may read every response); marking a try as
-- sent records it and learns nothing, enforced here (Q3); a try's questions are never gaps (Q3).

ALTER TABLE public.opportunities ADD COLUMN trial boolean NOT NULL DEFAULT false;
GRANT INSERT (trial) ON public.opportunities TO authenticated;
CREATE UNIQUE INDEX opportunities_one_open_try ON public.opportunities (owner_id) WHERE trial AND archived_at IS NULL;

ALTER TABLE public.rfi_questions DROP CONSTRAINT IF EXISTS rfi_questions_learn_outcome_check;
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_learn_outcome_check
  CHECK (learn_outcome IN ('added', 'superseded', 'proposed', 'translated', 'confirmed', 'not_confirmed_source', 'not_learned_pricing',
                           'not_learned_japanese', 'not_learned_empty', 'not_learned_unchecked', 'not_learned_try'));

-- The overview says which responses are tries (the view as in 20261030100000, with o.trial). A new
-- column goes at the end of a view's base select only, so the view is rebuilt.
DROP VIEW public.response_overview;
CREATE VIEW public.response_overview
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
         o.trial,
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
GRANT SELECT ON public.response_overview TO authenticated;
REVOKE ALL ON public.response_overview FROM anon;

-- Marking as sent: as in 20261106120000, except that a try learns nothing and confirms nothing.
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
               WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, '[]'::jsonb))->>'id')) t;

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

-- Gaps: as in 20261108120000, without tries.
CREATE OR REPLACE FUNCTION public.knowledge_gaps()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH q AS (
    SELECT q.id, q.question, q.status, q.learned_at, q.session_id, s.opportunity_id, s.created_at AS asked_at,
           o.name AS response, o.archived_at, k.ref AS entry_ref, k.retired_at AS entry_retired,
           k.proposed_replacement_of IS NOT NULL AS entry_proposed,
           regexp_replace(lower(q.question), '[[:punct:][:space:]、。，．？！：；「」『』（）［］【】・〜　]', '', 'g') AS wording
      FROM public.rfi_questions q
      JOIN public.rfi_sessions s ON s.id = q.session_id
      JOIN public.opportunities o ON o.id = s.opportunity_id
      LEFT JOIN public.kb_entries k ON k.id = q.learned_entry_id
     WHERE q.draft_kind = 'insufficient_evidence'
       AND q.gate IS DISTINCT FROM 'pricing'
       AND s.created_at >= now() - interval '90 days'
       AND NOT o.trial  -- Sprint 23 (S23-1, Q3): a visitor's try is never a gap
  ),
  s AS (
    SELECT q.*,
           CASE WHEN q.entry_ref IS NOT NULL AND q.entry_retired IS NULL AND NOT q.entry_proposed THEN 'learned'
                WHEN q.entry_ref IS NOT NULL AND q.entry_retired IS NULL THEN 'proposed'
                WHEN q.status = 'accepted' AND q.learned_at IS NULL AND q.archived_at IS NULL THEN 'answered'
                WHEN q.status = 'accepted' THEN 'not_learned'
                WHEN q.status = 'pending' AND q.archived_at IS NULL THEN 'open'
                ELSE 'unanswered' END AS state
      FROM q WHERE q.wording <> ''
  ),
  r AS (
    SELECT s.*, CASE s.state WHEN 'learned' THEN 1 WHEN 'proposed' THEN 2 WHEN 'answered' THEN 3
                             WHEN 'not_learned' THEN 4 WHEN 'open' THEN 5 ELSE 6 END AS rank
      FROM s
  ),
  g AS (
    SELECT r.wording, count(DISTINCT r.opportunity_id) AS responses, max(r.asked_at) AS last_asked
      FROM r GROUP BY r.wording
  ),
  pick AS (
    SELECT DISTINCT ON (r.wording) r.*
      FROM r ORDER BY r.wording, r.rank, r.asked_at DESC, r.id
  ),
  shown AS (
    SELECT p.*, g.responses, g.last_asked
      FROM pick p JOIN g ON g.wording = p.wording
     ORDER BY p.rank = 5 DESC, g.responses DESC, g.last_asked DESC, p.wording
     LIMIT 500
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM g),
    'gaps', coalesce((SELECT jsonb_agg(jsonb_build_object(
               'question', left(x.question, 500), 'state', x.state, 'responses', x.responses, 'lastAsked', x.last_asked,
               'entryRef', x.entry_ref, 'responseId', x.opportunity_id, 'response', left(x.response, 200),
               'sessionId', x.session_id, 'questionId', x.id)
             ORDER BY x.rank = 5 DESC, x.responses DESC, x.last_asked DESC, x.wording) FROM shown x), '[]'::jsonb));
$$;
