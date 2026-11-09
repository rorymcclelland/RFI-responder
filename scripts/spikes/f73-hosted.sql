-- Spike S25-3 (F-73): time marking a large response as sent, and bulk-approving it, on the hosted
-- staging database. Run by the throwaway branch sprint-25-f73 only, never merged.
--   psql "$STAGING_DB_URL" -v files=2 -v per=2000 -f scripts/spikes/f73-hosted.sql
-- Everything happens inside one transaction that is rolled back at the end: the synthetic response,
-- its files and questions, and whatever sending learns are never committed, so staging keeps nothing.
-- Synthetic data only; no AI; the questions cite entries already in staging's knowledge base.
\set ON_ERROR_STOP 1
\pset footer off
SELECT (SELECT count(*) FROM public.kb_entries WHERE superseded_by IS NULL AND retired_at IS NULL) AS kb_current,
       (SELECT count(*) FROM public.kb_entries) AS kb_all \gset
-- A response owner who is not an admin (the demo's people), so learning takes the ordinary path.
SELECT id AS owner FROM public.user_profiles WHERE NOT coalesce(is_admin, false) ORDER BY created_at LIMIT 1 \gset
SELECT pg_has_role('authenticated', 'MEMBER') AS can_be_user \gset

BEGIN;
SET LOCAL statement_timeout = '300s';
SELECT set_config('f73.files', :'files', true), set_config('f73.per', :'per', true) \g /dev/null
INSERT INTO public.opportunities (name, created_by, owner_id)
VALUES ('F-73 spike ' || :files || 'x' || :per || ' (rolled back)', :'owner', :'owner') RETURNING id AS sent_r \gset
INSERT INTO public.opportunities (name, created_by, owner_id)
VALUES ('F-73 spike bulk ' || :files || 'x' || :per || ' (rolled back)', :'owner', :'owner') RETURNING id AS bulk_r \gset
-- One file at a time, then its questions, as the database owner (since Sprint 26 the API refuses questions beyond a file's count).
DO $$
DECLARE r record; f int; s uuid; refs text[];
BEGIN
  -- Only entries the source check passes (reviewed, not overdue), so bulk approval takes the questions.
  SELECT array_agg(k.ref ORDER BY k.ref) INTO refs FROM public.kb_entries k
   WHERE k.superseded_by IS NULL AND k.retired_at IS NULL AND (SELECT g.gate FROM private.source_gate(ARRAY[k.ref]) g) IS NULL;
  IF refs IS NULL THEN RAISE EXCEPTION 'No reviewed entry to cite'; END IF;
  FOR r IN SELECT o.id, o.name LIKE 'F-73 spike bulk%' AS bulk FROM public.opportunities o
            WHERE o.name LIKE 'F-73 spike %(rolled back)' LOOP
    FOR f IN 1 .. current_setting('f73.files')::int LOOP
      INSERT INTO public.rfi_sessions (file_name, status, question_count, opportunity_id)
      VALUES ('f73-' || f || '.xlsx', 'in_progress', current_setting('f73.per')::int, r.id) RETURNING id INTO s;
      INSERT INTO public.rfi_questions (session_id, position, question, generated_answer, final_answer, confidence, status, language,
        verdict, sources_json, embedding_model, judge_model, draft_model, prompt_version, calibration_set, draft_kind, processed_at,
        judge_best_ref, cited_refs)
      SELECT s, g, 'F-73 spike file ' || f || ' question ' || g || ' (' || r.id || ')?', 'Drafted answer ' || g || '.',
             CASE WHEN NOT r.bulk THEN 'Approved answer ' || g || '.' END, 0.95,
             CASE WHEN r.bulk THEN 'pending' ELSE 'accepted' END, 'en', 'yes',
             jsonb_build_array(jsonb_build_object('id', refs[1 + g % array_length(refs, 1)], 'score', 0.5)),
             'voyage-4', 'claude-haiku-5-5', 'claude-haiku-5-5', 'draft-1', 'set 1', 'generated', now(),
             refs[1 + g % array_length(refs, 1)], ARRAY[refs[1 + g % array_length(refs, 1)]]
        FROM generate_series(1, current_setting('f73.per')::int) g;
    END LOOP;
  END LOOP;
END $$;
ANALYZE public.rfi_questions;

-- As the owner, the way the API calls it (without the 8-second limit, so the full time is measured).
SELECT set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true) \g /dev/null
\if :can_be_user
SET LOCAL ROLE authenticated;
\endif
SELECT clock_timestamp() AS t0 \gset
SELECT (public.record_response_export(:'sent_r'))->>'accepted' AS sent_accepted \gset
SELECT round(extract(epoch FROM clock_timestamp() - :'t0'::timestamptz) * 1000) AS send_ms \gset
SELECT clock_timestamp() AS t0 \gset
SELECT (public.bulk_accept_response(:'bulk_r', 0.8))->>'accepted' AS bulk_accepted \gset
SELECT round(extract(epoch FROM clock_timestamp() - :'t0'::timestamptz) * 1000) AS bulk_ms \gset
ROLLBACK;

\echo F73 :files x :per questions=:sent_accepted send_ms=:send_ms bulk_accepted=:bulk_accepted bulk_ms=:bulk_ms as_user=:can_be_user kb_current=:kb_current kb_all=:kb_all
-- Nothing of the spike is left (checked after the rollback).
SELECT count(*) AS left_behind FROM public.opportunities WHERE name LIKE 'F-73 spike %' \gset
\echo F73 left_behind=:left_behind
