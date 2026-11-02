-- Sprint 21 (S21-2, K-4): gaps, what the knowledge base could not answer in recent responses.
--
-- Security invoker: it reads under the caller's own rights, and every signed-in person reads every
-- response and question, so every member sees the same gaps (no new access rule). Read-only.
--
-- A gap is a question in a response uploaded in the last 90 days whose draft says the knowledge base
-- does not answer it (draft_kind 'insufficient_evidence'). Pricing questions are never listed (they
-- are 'person_required', and the gate is checked as well). Questions worded the same, ignoring case,
-- spaces and punctuation (Q3: wording only, not meaning), form one group, with how many responses
-- asked it. A group stands where its furthest question stands:
--   learned      a person's answer is in the knowledge base (learned_entry_id), with its entry
--   answered     a person approved an answer, not yet considered for learning (the response is not
--                marked as sent, or was changed since)
--   not_learned  approved and considered when marked as sent, but not added (for instance the same
--                answer as before, or not fully checked)
--   open         still to do, in a response not archived: open it there to answer or assign it
--   unanswered   left unanswered by the owner, or still to do in an archived response
-- The question shown, and opened, is the group's furthest one, the most recently asked first.
-- Nothing here learns anything (rule 7): learning still happens only when a response is marked as sent.
CREATE FUNCTION public.knowledge_gaps()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH q AS (
    SELECT q.id, q.question, q.status, q.learned_at, q.session_id, s.opportunity_id, s.created_at AS asked_at,
           o.name AS response, o.archived_at, k.ref AS entry_ref,
           -- The wording without case, spaces or punctuation (ASCII and full-width), so "on-site" and
           -- "On site" are one; letters and digits in any script are kept.
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
           CASE WHEN q.entry_ref IS NOT NULL THEN 'learned'
                WHEN q.status = 'accepted' AND q.learned_at IS NULL THEN 'answered'
                WHEN q.status = 'accepted' THEN 'not_learned'
                WHEN q.status = 'pending' AND q.archived_at IS NULL THEN 'open'
                ELSE 'unanswered' END AS state
      FROM q
  ),
  r AS (
    SELECT s.*, CASE s.state WHEN 'learned' THEN 1 WHEN 'answered' THEN 2 WHEN 'not_learned' THEN 3
                             WHEN 'open' THEN 4 ELSE 5 END AS rank
      FROM s
  ),
  g AS (
    SELECT r.wording, count(DISTINCT r.opportunity_id) AS responses, max(r.asked_at) AS last_asked
      FROM r WHERE r.wording <> '' GROUP BY r.wording
  ),
  pick AS (
    SELECT DISTINCT ON (r.wording) r.*
      FROM r WHERE r.wording <> ''
     ORDER BY r.wording, r.rank, r.asked_at DESC, r.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'question', p.question, 'state', p.state, 'responses', g.responses, 'lastAsked', g.last_asked,
           'entryRef', p.entry_ref, 'responseId', p.opportunity_id, 'response', p.response,
           'sessionId', p.session_id, 'questionId', p.id)
         ORDER BY p.rank = 4 DESC, g.responses DESC, g.last_asked DESC, p.wording), '[]'::jsonb)
    FROM pick p JOIN g ON g.wording = p.wording;
$$;
REVOKE ALL ON FUNCTION public.knowledge_gaps() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.knowledge_gaps() TO authenticated;

-- The function reads only the questions the knowledge base could not answer.
CREATE INDEX IF NOT EXISTS rfi_questions_gaps_idx ON public.rfi_questions (session_id) WHERE draft_kind = 'insufficient_evidence';
