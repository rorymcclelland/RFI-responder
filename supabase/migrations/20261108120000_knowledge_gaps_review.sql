-- Sprint 21 reviews of knowledge_gaps() (20261108100000):
--
-- QA 9 (rule 1): "learned" said the answer is in the knowledge base, for any learned entry. It now
-- means a current entry (not retired, not a proposed change); a proposed change waiting for an
-- admin is its own state, 'proposed'; an answer whose entry was retired since, or approved in a
-- response archived without being sent (so never learned), is 'not_learned'.
-- Security 5: the result was unbounded (every group, every question in full). It now returns at most
-- 500 groups, those still to do first, each question cut to 500 characters, and the total.
--
-- Returns { "total": <groups>, "gaps": [ ... ] }. States, furthest first:
--   learned      a person's answer is a current entry in the knowledge base (with its entry)
--   proposed     a person's answer was learned as a proposed change, waiting for an admin's review
--   answered     approved, in a response not archived, not yet considered for learning
--   not_learned  approved, but not in the knowledge base now (not added when sent, retired since, or
--                its response archived without being sent)
--   open         still to do, in a response not archived
--   unanswered   left unanswered, or still to do when its response was archived
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
