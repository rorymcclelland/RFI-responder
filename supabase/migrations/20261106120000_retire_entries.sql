-- Sprint 18 (S18-3, K-2): retire an answer, or decline a proposed change, with a reason; restore it.
--
-- A retired answer stays readable, with its reason, history and the responses that cited it, but it
-- is no longer current: it is never matched, indexed, drafted from, confirmed or replaced by
-- learning, and its question is free for a new answer. Each function that means "the current
-- answer" (superseded_by IS NULL) now also requires retired_at IS NULL; each is tested in
-- supabase/tests/db/sprint18.test.ts. Retiring a proposal declines it: it no longer waits beside the
-- entry it would have changed. Only an admin retires or restores (Rory, Q2), through two audited
-- definer functions; nobody can set the columns directly (no column grant).
ALTER TABLE public.kb_entries
  ADD COLUMN retired_at     timestamptz,
  ADD COLUMN retired_by     uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN retired_reason text,
  ADD CONSTRAINT kb_entries_retired_reason CHECK (
    (retired_at IS NULL AND retired_reason IS NULL)
    OR (retired_at IS NOT NULL AND length(btrim(retired_reason)) BETWEEN 5 AND 500));

DROP INDEX public.kb_entries_current_question;
CREATE UNIQUE INDEX kb_entries_current_question ON public.kb_entries (question_key, language)
  WHERE superseded_by IS NULL AND proposed_replacement_of IS NULL AND retired_at IS NULL;

-- Matching: never a retired answer.
CREATE OR REPLACE FUNCTION public.match_kb_entries(query_embedding extensions.vector, query_text text, match_count integer DEFAULT 5, model_name text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, ref text, question text, answer text, tags text[], source text, similarity double precision, keyword_rank real, fused_score double precision, embedding_model text, language text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  WITH q AS (
    SELECT CASE WHEN plainto_tsquery('english'::regconfig, coalesce(query_text, ''))::text = '' THEN NULL
                ELSE to_tsquery('english'::regconfig,
                       replace(plainto_tsquery('english'::regconfig, query_text)::text, '&', '|'))
           END AS tsq
  ),
  vec AS (
    SELECT k.id, 1 - (k.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
    FROM public.kb_entries k
    WHERE query_embedding IS NOT NULL
      AND k.superseded_by IS NULL AND k.retired_at IS NULL
      AND k.embedding IS NOT NULL
      AND k.embedding_model = model_name
    ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding
    LIMIT 50
  ),
  kw AS (
    SELECT k.id, ts_rank_cd(k.search_text, q.tsq) AS keyword_rank
    FROM public.kb_entries k, q
    WHERE q.tsq IS NOT NULL AND k.superseded_by IS NULL AND k.retired_at IS NULL AND k.search_text @@ q.tsq
    ORDER BY keyword_rank DESC, k.seq
    LIMIT 50
  ),
  ranked AS (
    -- With a query vector: meaning decides the order. Without one: keywords do.
    SELECT v.id, v.similarity, w.keyword_rank, v.similarity AS score
    FROM vec v LEFT JOIN kw w ON w.id = v.id
    WHERE query_embedding IS NOT NULL
    UNION ALL
    SELECT w.id, NULL::double precision, w.keyword_rank, w.keyword_rank::double precision
    FROM kw w
    WHERE query_embedding IS NULL
  )
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source,
         r.similarity, r.keyword_rank, r.score, k.embedding_model, k.language
  FROM ranked r JOIN public.kb_entries k ON k.id = r.id
  ORDER BY r.score DESC, k.seq
  LIMIT least(greatest(match_count, 1), 20)
$function$;

-- Indexing: a retired answer is not indexed again.
CREATE OR REPLACE FUNCTION public.pending_embeddings(model text, max_rows integer)
 RETURNS TABLE(id uuid, question text, answer text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT k.id, k.question, k.answer
  FROM public.kb_entries k
  WHERE k.superseded_by IS NULL AND k.retired_at IS NULL
    AND (k.embedding IS NULL OR k.embedding_model IS DISTINCT FROM model)
  ORDER BY k.seq
  LIMIT least(max_rows, 500)
$function$;

-- Importing: a retired answer's question can be imported again.
CREATE OR REPLACE FUNCTION public.import_kb_entries(entries jsonb, entry_origin public.kb_origin, entry_origin_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    SELECT *, lower(regexp_replace(question, '\s+', ' ', 'g')) AS key, public.text_language(question, answer) AS lang
    FROM raw
    WHERE length(question) BETWEEN 1 AND 5000 AND length(answer) BETWEEN 1 AND 20000
  ),
  first_of_each AS (
    SELECT DISTINCT ON (key, lang) * FROM ok ORDER BY key, lang, ord
  ),
  ins AS (
    INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref, created_by)
    SELECT f.question, f.answer, f.tags, f.source, entry_origin, nullif(left(btrim(coalesce(entry_origin_ref, '')), 255), ''), auth.uid()
    FROM first_of_each f
    WHERE NOT EXISTS (
      SELECT 1 FROM public.kb_entries k WHERE k.question_key = f.key AND k.language = f.lang AND k.superseded_by IS NULL AND k.retired_at IS NULL
    )
    ORDER BY f.ord
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM ok), (SELECT count(*) FROM ins) INTO valid, inserted;

  RETURN jsonb_build_object('inserted', inserted, 'duplicates', valid - inserted, 'invalid', total - valid);
END;
$function$;

-- The overdue report: retired answers are not due for review.
CREATE OR REPLACE FUNCTION public.overdue_entries()
 RETURNS TABLE(id uuid, ref text, question text, answer text, tags text[], source text, origin public.kb_origin, origin_ref text, added_by text, created_at timestamp with time zone, last_reviewed_at timestamp with time zone, review_due timestamp with time zone, recent_citations bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can see the overdue-entries report' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT k.id, k.ref, k.question, k.answer, k.tags, k.source, k.origin, k.origin_ref, p.display_name,
         k.created_at, k.last_reviewed_at, access.entry_review_due(k),
         (SELECT count(*) FROM public.rfi_questions q
           WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days')
    FROM public.kb_entries k
    LEFT JOIN public.user_profiles p ON p.id = k.created_by
   WHERE k.superseded_by IS NULL AND k.retired_at IS NULL
     AND access.entry_review_due(k) < now()
   ORDER BY access.entry_review_due(k) ASC,
            (SELECT count(*) FROM public.rfi_questions q
              WHERE k.ref = ANY (q.cited_refs) AND q.processed_at > now() - interval '90 days') DESC;
END;
$function$;

-- Learning at export: a retired answer is never confirmed, and never replaced (a near-duplicate of one becomes a new entry).
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
  SELECT o.name INTO opp_name FROM public.opportunities o WHERE o.id = sess.opportunity_id;
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
    IF q.gate = 'pricing' THEN
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

-- Reviewing: a retired answer (or a declined proposal) must be restored first.
CREATE OR REPLACE FUNCTION public.review_entry(p_entry uuid, p_question text DEFAULT NULL::text, p_answer text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  e        public.kb_entries;
  edited   boolean;
  replaced uuid;
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can review knowledge-base entries' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.kb_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such entry' USING ERRCODE = 'P0002';
  END IF;
  IF e.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has been replaced by a newer one; review that instead' USING ERRCODE = '22023';
  END IF;
  IF e.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'This entry is retired; restore it before reviewing it' USING ERRCODE = '22023';
  END IF;
  IF e.proposed_replacement_of IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.kb_entries k WHERE k.id = e.proposed_replacement_of AND k.retired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The answer this change was proposed for is retired; restore it first, or decline the change' USING ERRCODE = '22023';
  END IF;
  edited := (p_question IS NOT NULL AND btrim(p_question) <> e.question) OR (p_answer IS NOT NULL AND btrim(p_answer) <> e.answer);

  IF e.proposed_replacement_of IS NOT NULL THEN
    SET CONSTRAINTS public.kb_entries_superseded_by_fkey DEFERRED;
    UPDATE public.kb_entries SET superseded_by = p_entry
     WHERE id = e.proposed_replacement_of AND superseded_by IS NULL
     RETURNING id INTO replaced;
  END IF;
  UPDATE public.kb_entries
     SET question = CASE WHEN p_question IS NULL THEN question ELSE btrim(p_question) END,
         answer = CASE WHEN p_answer IS NULL THEN answer ELSE btrim(p_answer) END,
         reviewed_at = now(), reviewed_by = auth.uid(), last_reviewed_at = now(),
         proposed_replacement_of = NULL,
         embedding = CASE WHEN edited THEN NULL ELSE embedding END,
         embedding_model = CASE WHEN edited THEN NULL ELSE embedding_model END
   WHERE id = p_entry;
  SET CONSTRAINTS public.kb_entries_superseded_by_fkey IMMEDIATE;
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.reviewed', p_entry, jsonb_build_object('ref', e.ref, 'edited', edited,
          'replaced', (SELECT k.ref FROM public.kb_entries k WHERE k.id = replaced),
          'previous', CASE WHEN edited THEN jsonb_build_object('question', e.question, 'answer', e.answer) END));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Another current entry already has this question; correct the question or remove the other entry first'
    USING ERRCODE = '23505';
END;
$function$;

-- The source gate: a draft citing a retired answer is held, as for a replaced one.
CREATE OR REPLACE FUNCTION private.source_gate(p_refs text[])
 RETURNS TABLE(gate text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  unreviewed text[];
  overdue    text[];
BEGIN
  -- Each ref once, in the order first cited; a blank ref matches no entry and counts as unreviewed,
  -- as a missing ref does in process-questions.
  WITH refs AS (
    SELECT coalesce(nullif(btrim(r.ref), ''), '') AS ref, min(r.ord) AS ord
      FROM unnest(coalesce(p_refs, '{}'::text[])) WITH ORDINALITY AS r(ref, ord)
     GROUP BY 1
  )
  SELECT array_agg(CASE WHEN refs.ref = '' THEN 'an unknown entry' ELSE refs.ref END ORDER BY refs.ord)
           FILTER (WHERE k.id IS NULL OR k.reviewed_at IS NULL),
         -- Sprint 7 (F-32): a replaced entry is out of date like an overdue one, whatever its dates.
         array_agg(CASE WHEN k.superseded_by IS NOT NULL
                        THEN refs.ref || ' (replaced by ' || coalesce(nk.ref, 'a newer entry') || ')'
                        -- Sprint 18 (S18-3): a retired entry is out of date like a replaced one.
                        WHEN k.retired_at IS NOT NULL THEN refs.ref || ' (retired)'
                        ELSE refs.ref || ' (overdue for review since ' || to_char(access.entry_review_due(k), 'YYYY-MM-DD') || ')' END
                   ORDER BY refs.ord)
           FILTER (WHERE k.reviewed_at IS NOT NULL AND (k.superseded_by IS NOT NULL OR k.retired_at IS NOT NULL OR access.entry_review_due(k) < now()))
    INTO unreviewed, overdue
    FROM refs
    LEFT JOIN public.kb_entries k ON k.ref = refs.ref AND refs.ref <> ''
    LEFT JOIN public.kb_entries nk ON nk.id = k.superseded_by;
  IF cardinality(unreviewed) > 0 THEN
    RETURN QUERY SELECT 'unreviewed_source'::text,
      'Cites ' || array_to_string(unreviewed, ', ') || ', not reviewed by an admin yet, so it is reviewed individually.';
  ELSIF cardinality(overdue) > 0 THEN
    RETURN QUERY SELECT 'stale_source'::text,
      'Cites ' || array_to_string(overdue, ', ') || ', so it is reviewed individually.';
  ELSE
    RETURN QUERY SELECT NULL::text, NULL::text;
  END IF;
END;
$function$;

-- process-questions' view of the cited entries gains whether each is retired.
DROP FUNCTION public.entry_review_status(text[]);
CREATE FUNCTION public.entry_review_status(p_refs text[])
RETURNS TABLE (ref text, reviewed boolean, overdue_since date, replaced_by text, retired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT k.ref, k.reviewed_at IS NOT NULL,
         CASE WHEN access.entry_review_due(k) < now() THEN access.entry_review_due(k)::date END,
         CASE WHEN k.superseded_by IS NOT NULL THEN coalesce(nk.ref, 'a newer entry') END,
         k.retired_at IS NOT NULL
    FROM public.kb_entries k
    LEFT JOIN public.kb_entries nk ON nk.id = k.superseded_by
   WHERE k.ref = ANY (p_refs);
$$;
REVOKE ALL ON FUNCTION public.entry_review_status(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entry_review_status(text[]) TO service_role;

-- The knowledge page's overview leaves retired answers out of every count, and lists them in the
-- browse map with the state 'retired' (and how often they were cited), for the Retired filter.
CREATE OR REPLACE FUNCTION public.knowledge_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH iv AS (
    SELECT make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s)) AS months
  ),
  cites AS (
    SELECT c.ref, count(*) AS n
      FROM (SELECT DISTINCT q.id, r AS ref
              FROM public.rfi_questions q, unnest(coalesce(q.cited_refs, '{}'::text[])) AS r) c
     GROUP BY c.ref
  ),
  e AS (
    SELECT k.ref, k.seq, k.question, k.tags, k.language, k.translated_from, k.reviewed_at,
           k.created_by, k.created_at, k.origin, k.source,
           coalesce(k.last_reviewed_at, k.reviewed_at, k.created_at) + iv.months AS due,
           coalesce(c.n, 0) AS citations
      FROM public.kb_entries k CROSS JOIN iv LEFT JOIN cites c ON c.ref = k.ref
     WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL AND k.retired_at IS NULL
  ),
  retired AS (
    SELECT k.ref, coalesce(c.n, 0) AS citations
      FROM public.kb_entries k LEFT JOIN cites c ON c.ref = k.ref
     WHERE k.superseded_by IS NULL AND k.proposed_replacement_of IS NULL AND k.retired_at IS NOT NULL
  ),
  proposals AS (
    SELECT k.ref, k.seq, k.question, k.created_at, k.origin, k.source, k.reviewed_at, o.ref AS replaces
      FROM public.kb_entries k JOIN public.kb_entries o ON o.id = k.proposed_replacement_of
     WHERE k.superseded_by IS NULL AND k.retired_at IS NULL
  ),
  tagged AS (
    SELECT DISTINCT t.tag, e.ref, e.citations
      FROM e LEFT JOIN LATERAL unnest(CASE WHEN cardinality(e.tags) > 0 THEN e.tags ELSE ARRAY[NULL::text] END) AS t(tag) ON true
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM e),
    'languages', jsonb_build_object(
      'en', (SELECT count(*) FROM e WHERE e.language = 'en'),
      'ja', (SELECT count(*) FROM e WHERE e.language = 'ja')),
    'contributors', (SELECT count(DISTINCT e.created_by) FROM e),
    'states', jsonb_build_object(
      'reviewed', (SELECT count(*) FROM e WHERE e.reviewed_at IS NOT NULL AND e.due >= now()),
      'overdue', (SELECT count(*) FROM e WHERE e.reviewed_at IS NOT NULL AND e.due < now()),
      'waiting', (SELECT count(*) FROM e WHERE e.reviewed_at IS NULL AND e.translated_from IS NULL),
      'translations', (SELECT count(*) FROM e WHERE e.reviewed_at IS NULL AND e.translated_from IS NOT NULL),
      'proposals', (SELECT count(*) FROM proposals),
      'retired', (SELECT count(*) FROM retired)),
    'topics', coalesce((
      SELECT jsonb_agg(jsonb_build_object('tag', x.tag, 'entries', x.entries, 'citations', x.citations) ORDER BY x.entries DESC, x.tag)
        FROM (SELECT t.tag, count(*) AS entries, sum(t.citations) AS citations FROM tagged t GROUP BY t.tag) x), '[]'::jsonb),
    'learned', coalesce((
      SELECT jsonb_agg(jsonb_build_object('ref', l.ref, 'question', l.question, 'at', l.created_at,
                                          'from', nullif(regexp_replace(l.source, '^RFI response: ', ''), ''),
                                          'reviewed', l.reviewed_at IS NOT NULL, 'replaces', l.replaces)
                       ORDER BY l.created_at DESC, l.seq DESC)
        FROM (SELECT u.* FROM (SELECT e.ref, e.seq, e.question, e.created_at, e.source, e.reviewed_at, NULL::text AS replaces
                                 FROM e WHERE e.origin = 'response'
                               UNION ALL
                               SELECT p.ref, p.seq, p.question, p.created_at, p.source, p.reviewed_at, p.replaces
                                 FROM proposals p WHERE p.origin = 'response') u
               ORDER BY u.created_at DESC, u.seq DESC LIMIT 5) l), '[]'::jsonb),
    'entries', coalesce((
      SELECT jsonb_object_agg(e.ref, jsonb_build_object(
               'state', CASE WHEN e.reviewed_at IS NULL AND e.translated_from IS NOT NULL THEN 'translation'
                             WHEN e.reviewed_at IS NULL THEN 'waiting'
                             WHEN e.due < now() THEN 'overdue' ELSE 'reviewed' END,
               'citations', e.citations,
               'due', e.due))
        FROM e), '{}'::jsonb)
      || coalesce((SELECT jsonb_object_agg(r.ref, jsonb_build_object('state', 'retired', 'citations', r.citations, 'due', NULL))
                     FROM retired r), '{}'::jsonb)
  );
$$;

-- An answer's page says when it was retired, by whom and why; a declined proposal no longer shows
-- as waiting beside its entry.
CREATE OR REPLACE FUNCTION public.entry_detail(p_ref text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH k AS (
    SELECT x.*, coalesce(x.last_reviewed_at, x.reviewed_at, x.created_at)
                + make_interval(months => (SELECT s.review_interval_months FROM public.ai_settings s)) AS due
      FROM public.kb_entries x
     WHERE x.ref = upper(btrim(p_ref))
  ),
  used AS (
    SELECT q.id, q.question, q.status, coalesce(q.learned_at, q.processed_at, q.created_at) AS at,
           -- Edited: approved with an answer other than the draft (an unedited approval leaves final_answer
           -- empty or equal to the draft).
           coalesce(q.status = 'accepted' AND q.final_answer IS NOT NULL
                    AND btrim(q.final_answer) <> btrim(coalesce(q.generated_answer, '')), false) AS edited,
           o.id AS response_id, o.name AS response, o.outcome, o.exported_at, o.archived_at
      FROM k
      JOIN public.rfi_questions q ON q.cited_refs @> ARRAY[k.ref]
      JOIN public.rfi_sessions s ON s.id = q.session_id
      JOIN public.opportunities o ON o.id = s.opportunity_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM k) THEN NULL ELSE jsonb_build_object(
    'entry', (SELECT jsonb_build_object(
        'id', k.id, 'ref', k.ref, 'question', k.question, 'answer', k.answer, 'tags', to_jsonb(k.tags),
        'source', k.source, 'origin', k.origin, 'createdBy', k.created_by, 'createdAt', k.created_at,
        'language', k.language, 'translatedFrom', to_jsonb(k.translated_from),
        'reviewedAt', k.reviewed_at, 'reviewedBy', k.reviewed_by, 'lastReviewedAt', k.last_reviewed_at,
        'due', k.due,
        'state', CASE WHEN k.superseded_by IS NOT NULL THEN 'replaced'
                      WHEN k.retired_at IS NOT NULL THEN 'retired'
                      WHEN k.proposed_replacement_of IS NOT NULL THEN 'proposal'
                      WHEN k.reviewed_at IS NULL AND k.translated_from IS NOT NULL THEN 'translation'
                      WHEN k.reviewed_at IS NULL THEN 'waiting'
                      WHEN k.due < now() THEN 'overdue' ELSE 'reviewed' END,
        'replacedBy', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.superseded_by),
        'proposalFor', (SELECT n.ref FROM public.kb_entries n WHERE n.id = k.proposed_replacement_of),
        'retiredAt', k.retired_at, 'retiredBy', k.retired_by, 'retiredReason', k.retired_reason)
      FROM k),
    'proposal', (SELECT jsonb_build_object('id', p.id, 'ref', p.ref, 'question', p.question, 'answer', p.answer,
                                           'source', p.source, 'createdBy', p.created_by, 'createdAt', p.created_at)
                   FROM k JOIN public.kb_entries p ON p.proposed_replacement_of = k.id AND p.superseded_by IS NULL AND p.retired_at IS NULL
                  ORDER BY p.created_at DESC LIMIT 1),
    'replaced', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', o.ref, 'question', o.question) ORDER BY o.seq)
                            FROM k JOIN public.kb_entries o ON o.superseded_by = k.id), '[]'::jsonb),
    'translations', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', t.ref, 'language', t.language,
                                                                  'reviewed', t.reviewed_at IS NOT NULL) ORDER BY t.seq)
                                FROM k JOIN public.kb_entries t ON t.translated_from @> ARRAY[k.ref] AND t.superseded_by IS NULL), '[]'::jsonb),
    'usedCount', (SELECT count(*) FROM used),
    'used', coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'questionId', u.id, 'question', u.question, 'status', u.status, 'edited', u.edited,
                         'responseId', u.response_id, 'response', u.response, 'outcome', u.outcome,
                         'exportedAt', u.exported_at, 'archivedAt', u.archived_at, 'at', u.at) ORDER BY u.at DESC)
                        FROM (SELECT * FROM used ORDER BY used.at DESC LIMIT 100) u), '[]'::jsonb),
    'history', coalesce((SELECT jsonb_agg(jsonb_build_object('at', h.at, 'action', h.action, 'actor', h.actor, 'details', h.details)
                                          ORDER BY h.at)
                           FROM k, access.entry_events(k.id) h), '[]'::jsonb)
  ) END;
$$;

CREATE FUNCTION public.retire_entry(p_entry uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.kb_entries;
  reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can retire an answer' USING ERRCODE = '42501';
  END IF;
  IF length(reason) < 5 OR length(reason) > 500 THEN
    RAISE EXCEPTION 'Say why it is being retired, in 5 to 500 characters' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO e FROM public.kb_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such entry' USING ERRCODE = 'P0002';
  END IF;
  IF e.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has been replaced by a newer one; retire that instead' USING ERRCODE = '22023';
  END IF;
  IF e.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'This entry is already retired' USING ERRCODE = '22023';
  END IF;
  UPDATE public.kb_entries SET retired_at = now(), retired_by = auth.uid(), retired_reason = reason WHERE id = p_entry;
  -- Security review (L3): changes proposed for the answer being retired are declined with it, so none
  -- waits for review or could bring it back by being approved. Restoring the answer does not restore them.
  WITH declined AS (
    UPDATE public.kb_entries p
       SET retired_at = now(), retired_by = auth.uid(),
           retired_reason = left('Declined because ' || e.ref || ' was retired: ' || reason, 500)
     WHERE p.proposed_replacement_of = p_entry AND p.superseded_by IS NULL AND p.retired_at IS NULL
    RETURNING p.id, p.ref, p.retired_reason
  )
  INSERT INTO public.audit_log (actor, action, target_id, details)
  SELECT auth.uid(), 'kb.retired', d.id, jsonb_build_object('ref', d.ref, 'reason', d.retired_reason, 'declined', true, 'proposal_for', e.ref)
    FROM declined d;
  -- Pending questions in open responses whose draft cites it are held from bulk approval, saying why
  -- (bulk approval checks the source gate again in any case); those already held for their sources
  -- get the new reason.
  WITH c AS (
    SELECT q.id, g.gate, g.reason
      FROM public.rfi_questions q
      JOIN public.rfi_sessions s ON s.id = q.session_id
      LEFT JOIN public.opportunities o ON o.id = s.opportunity_id
      CROSS JOIN LATERAL private.source_gate(q.cited_refs) g
     WHERE q.status = 'pending' AND q.gate IS NULL AND q.cited_refs @> ARRAY[e.ref]
       AND s.status <> 'completed' AND s.exported_at IS NULL
       AND (o.id IS NULL OR o.archived_at IS NULL)
       AND g.gate IS NOT NULL
  ), held AS (
    UPDATE public.rfi_questions q SET gate = c.gate, gate_reason = c.reason
      FROM c WHERE q.id = c.id
    RETURNING q.id, c.gate
  )
  INSERT INTO public.audit_log (actor, action, target_id, details)
  SELECT auth.uid(), 'question.held', held.id, jsonb_build_object('from', NULL, 'to', held.gate, 'refs', to_jsonb(ARRAY[e.ref]))
    FROM held;
  PERFORM private.release_source_gates(ARRAY[e.ref]);
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.retired', p_entry, jsonb_build_object('ref', e.ref, 'reason', reason,
          'declined', e.proposed_replacement_of IS NOT NULL,
          'proposal_for', (SELECT k.ref FROM public.kb_entries k WHERE k.id = e.proposed_replacement_of)));
END;
$$;
REVOKE ALL ON FUNCTION public.retire_entry(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.retire_entry(uuid, text) TO authenticated;

CREATE FUNCTION public.restore_entry(p_entry uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e public.kb_entries;
BEGIN
  IF NOT access.is_admin() THEN
    RAISE EXCEPTION 'Only an admin can restore an answer' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO e FROM public.kb_entries WHERE id = p_entry FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such entry' USING ERRCODE = 'P0002';
  END IF;
  IF e.retired_at IS NULL THEN
    RAISE EXCEPTION 'This entry is not retired' USING ERRCODE = '22023';
  END IF;
  IF e.superseded_by IS NOT NULL THEN
    RAISE EXCEPTION 'This entry has been replaced by a newer one since; it cannot be restored' USING ERRCODE = '22023';
  END IF;
  -- A restored proposal waits again beside its entry, unless that entry has been replaced or retired.
  IF e.proposed_replacement_of IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.kb_entries k WHERE k.id = e.proposed_replacement_of AND k.superseded_by IS NULL AND k.retired_at IS NULL) THEN
    RAISE EXCEPTION 'The answer this change was proposed for has been replaced or retired since; it cannot be restored' USING ERRCODE = '22023';
  END IF;
  UPDATE public.kb_entries SET retired_at = NULL, retired_by = NULL, retired_reason = NULL WHERE id = p_entry;
  -- Questions held only because they cite it are released again.
  PERFORM private.release_source_gates(ARRAY[e.ref]);
  INSERT INTO public.audit_log (actor, action, target_id, details)
  VALUES (auth.uid(), 'kb.restored', p_entry, jsonb_build_object('ref', e.ref, 'reason', e.retired_reason));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Another current answer now has this question; retire or change that one first' USING ERRCODE = '23505';
END;
$$;
REVOKE ALL ON FUNCTION public.restore_entry(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.restore_entry(uuid) TO authenticated;
