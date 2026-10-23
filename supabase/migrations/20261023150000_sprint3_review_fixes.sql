-- Sprint 3: fixes from the independent security review of 23 October 2026 (decision 0003).
--
-- 1. Any member could create an assignment pointing at any question (the question id was not
--    checked against the assignment's session), then decide it and get the answer learned. An
--    assignment's question must now be a question in its own session, which must belong to its
--    response; deciding through an assignment also requires that match.
-- 2. Learning used a block list (pricing, Japanese), so unprocessed or unchecked questions were
--    learned. It now learns only from an allow list: processed, English, and no gate other than legal.
-- 3. Members could insert responses already archived as won, and sessions and questions into
--    another owner's response. Inserts are limited to the columns the app sets, and only the
--    response owner or an admin may add sessions and questions to a response.
-- 4. S3-4 test 6: members could still set origin_ref on entries directly; only import_kb_entries
--    (file name, origin import or manual) and record_export (learned entries) now set it
--    (record_export), and imports leave it empty (the file name is kept in each entry's source).
-- 5. Supersession applied the judge's verdict to the top source even when the judge meant
--    another entry; the judge's chosen entry is now stored and must be the one superseded.

-- ─── 1. Assignments belong to their question's session ─────────────────────

CREATE OR REPLACE FUNCTION public.check_assignment_question()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'An assignment needs its session' USING ERRCODE = '23514';
  END IF;
  IF NEW.question_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NOT EXISTS (SELECT 1 FROM public.rfi_questions q WHERE q.id = NEW.question_id::uuid AND q.session_id = NEW.session_id) THEN
    RAISE EXCEPTION 'The question is not in this session' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.check_assignment_question() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER question_assignments_question_matches
  BEFORE INSERT OR UPDATE OF question_id, session_id, opportunity_id ON public.question_assignments
  FOR EACH ROW EXECUTE FUNCTION public.check_assignment_question();

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
           -- The assignment must be for this question, in this question's own session and response.
           SELECT 1 FROM public.question_assignments a
             JOIN public.rfi_questions q ON q.id = p_question AND q.session_id = a.session_id
             JOIN public.rfi_sessions s ON s.id = q.session_id AND s.opportunity_id IS NOT DISTINCT FROM a.opportunity_id
            WHERE a.question_id = p_question::text AND a.assigned_to = auth.uid())
$$;

-- ─── 2. Learning from an allow list ─────────────────────────────────────────

ALTER TABLE public.rfi_questions DROP CONSTRAINT IF EXISTS rfi_questions_learn_outcome_check;
ALTER TABLE public.rfi_questions ADD CONSTRAINT rfi_questions_learn_outcome_check
  CHECK (learn_outcome IN ('added', 'superseded', 'confirmed', 'not_learned_pricing', 'not_learned_japanese',
                           'not_learned_empty', 'not_learned_unchecked'));

-- ─── 5. The judge's chosen entry ────────────────────────────────────────────

ALTER TABLE public.rfi_questions ADD COLUMN judge_best_ref text;

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

  FOR q IN
    SELECT * FROM public.rfi_questions
     WHERE session_id = p_session AND status = 'accepted' AND learned_at IS NULL
     ORDER BY position
  LOOP
    new_id := NULL;
    answer := btrim(coalesce(q.final_answer, q.generated_answer, ''));
    -- Allow list: only questions the server processed, in English, with no gate but legal.
    IF q.gate = 'pricing' THEN
      outcome := 'not_learned_pricing';
    ELSIF q.processed_at IS NULL THEN
      outcome := 'not_learned_unchecked';
    ELSIF q.language IS DISTINCT FROM 'en' OR q.gate = 'translation' OR q.question ~ '[ぁ-ヿ一-鿿]' THEN
      outcome := 'not_learned_japanese';
    ELSIF q.gate IS NOT NULL AND q.gate <> 'legal' THEN
      outcome := 'not_learned_unchecked';
    ELSIF length(answer) = 0 THEN
      outcome := 'not_learned_empty';
    ELSIF q.draft_kind IN ('generated', 'assembled') AND answer = btrim(q.generated_answer) THEN
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
      UPDATE public.kb_entries k SET superseded_by = new_id
       WHERE k.superseded_by IS NULL
         AND (k.question_key = lower(regexp_replace(btrim(q.question), '\s+', ' ', 'g'))
              OR (k.id = top_entry AND limit_score IS NOT NULL AND top_score >= limit_score
                  AND q.verdict IN ('yes', 'partly') AND q.judge_best_ref = top_ref));
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

-- ─── 3. Inserts: only the columns the app sets, and only into your own response ─

REVOKE INSERT ON public.opportunities FROM authenticated;
GRANT INSERT (name, due_date) ON public.opportunities TO authenticated;

REVOKE INSERT ON public.rfi_sessions FROM authenticated;
GRANT INSERT (file_name, question_count, opportunity_id) ON public.rfi_sessions TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON public.rfi_sessions;
CREATE POLICY "Owner or admin adds a session to a response"
  ON public.rfi_sessions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR (opportunity_id IS NOT NULL AND public.is_response_owner(opportunity_id)));

DROP POLICY IF EXISTS "Authenticated users can insert questions" ON public.rfi_questions;
CREATE POLICY "Owner or admin adds questions to a session"
  ON public.rfi_questions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.is_response_owner(public.response_of_session(session_id)));

-- ─── 4. origin_ref is set only by the system ────────────────────────────────
-- Members cannot write it directly. Imports record their file name there (provenance), and
-- an import can only be origin 'import' or 'manual', so it cannot pass as a learned entry.

REVOKE INSERT ON public.kb_entries FROM authenticated;
GRANT INSERT (question, answer, tags, source, origin) ON public.kb_entries TO authenticated;

CREATE OR REPLACE FUNCTION public.import_kb_entries(
  entries     jsonb,
  entry_origin public.kb_origin,
  entry_origin_ref text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  total      int;
  valid      int;
  inserted   int;
BEGIN
  -- SECURITY DEFINER because members no longer hold INSERT on origin_ref. That makes this
  -- function the gate: it checks the caller, the origin and every value it writes, and it
  -- records the caller as created_by.
  -- entry_origin_ref is the import's file name, kept as provenance (trimmed, at most 255
  -- characters). Learned entries get their origin_ref from record_export only.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in to import' USING ERRCODE = '42501';
  END IF;
  IF entry_origin NOT IN ('import', 'manual') THEN
    RAISE EXCEPTION 'Origin % cannot be used for imports', entry_origin USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(entries) <> 'array' THEN
    RAISE EXCEPTION 'entries must be a JSON array' USING ERRCODE = '22023';
  END IF;
  total := jsonb_array_length(entries);
  IF total > 2000 THEN
    RAISE EXCEPTION 'Import at most 2,000 entries at a time' USING ERRCODE = '54000';
  END IF;

  WITH raw AS (
    SELECT ord,
           btrim(coalesce(e->>'question', '')) AS question,
           btrim(coalesce(e->>'answer', ''))   AS answer,
           coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(e->'tags', '[]'::jsonb))), '{}') AS tags,
           left(btrim(coalesce(e->>'source', '')), 500) AS source
    FROM jsonb_array_elements(entries) WITH ORDINALITY AS t(e, ord)
  ),
  ok AS (
    SELECT *, lower(regexp_replace(question, '\s+', ' ', 'g')) AS key
    FROM raw
    WHERE length(question) BETWEEN 1 AND 5000 AND length(answer) BETWEEN 1 AND 20000
  ),
  first_of_each AS (
    SELECT DISTINCT ON (key) * FROM ok ORDER BY key, ord
  ),
  ins AS (
    INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref, created_by)
    SELECT f.question, f.answer, f.tags, f.source, entry_origin, nullif(left(btrim(coalesce(entry_origin_ref, '')), 255), ''), auth.uid()
    FROM first_of_each f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.kb_entries k WHERE k.question_key = f.key AND k.superseded_by IS NULL
    )
    ORDER BY f.ord
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ok), (SELECT count(*) FROM ins) INTO valid, inserted;

  RETURN jsonb_build_object('inserted', inserted, 'duplicates', valid - inserted, 'invalid', total - valid);
END;
$$;
REVOKE ALL ON FUNCTION public.import_kb_entries(jsonb, public.kb_origin, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_kb_entries(jsonb, public.kb_origin, text) TO authenticated;
