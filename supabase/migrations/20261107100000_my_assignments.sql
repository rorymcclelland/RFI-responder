-- Sprint 19 (S19-1, U-3; and S19-3, U-4): the caller's open assignments, each with its question as it
-- is now, in one call.
--
-- question_assignments.question_id is text, not a foreign key, so the API cannot join an assignment
-- to its question; and the assignment's question_text and answer_text are copies taken when it was
-- assigned. This function joins them under the caller's own rights (SECURITY INVOKER): row-level
-- security decides which assignments they may read (assignee, assigner, the response's owner, or an
-- admin) and every member may read every question and response. It changes nothing.
--
-- toMe:   the caller is the assignee.
-- fromMe: the caller assigned it, or owns its response (an admin's view of everyone else's
--         assignments is the Assignments page's All, not this).
-- Closed assignments (the response was exported) and those on archived responses are left out.
CREATE FUNCTION public.my_assignments()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH a AS (
    SELECT a.*, q.question, q.generated_answer, q.final_answer, q.status AS question_status, q.confidence,
           q.verdict, q.judge_reason, q.gate, q.gate_reason, q.cited_refs, q.sources_json, q.draft_kind,
           q.language, q.position, o.name AS response, o.due_date, o.owner_id,
           (a.assigned_to = (SELECT auth.uid())) AS to_me,
           (a.assigned_by = (SELECT auth.uid()) OR o.owner_id = (SELECT auth.uid())) AS from_me
      FROM public.question_assignments a
      JOIN public.rfi_questions q ON q.id::text = a.question_id AND q.session_id = a.session_id
      JOIN public.rfi_sessions s ON s.id = a.session_id
      JOIN public.opportunities o ON o.id = s.opportunity_id
     WHERE a.status <> 'closed' AND o.archived_at IS NULL
       -- Only the caller's own (security review, L3): an admin may read every assignment, and
       -- filtering here keeps the cost to the caller's rows.
       AND (a.assigned_to = (SELECT auth.uid()) OR a.assigned_by = (SELECT auth.uid()) OR o.owner_id = (SELECT auth.uid()))
  ),
  rows AS (
    SELECT a.to_me, a.from_me, jsonb_build_object(
             'id', a.id, 'status', a.status, 'notes', a.notes, 'answerText', a.answer_text,
             'assignedTo', a.assigned_to, 'assignedBy', a.assigned_by, 'createdAt', a.created_at, 'updatedAt', a.updated_at,
             'responseId', a.opportunity_id, 'response', a.response, 'dueDate', a.due_date, 'ownerId', a.owner_id,
             'sessionId', a.session_id,
             'question', jsonb_build_object(
               'id', a.question_id, 'text', a.question, 'position', a.position, 'status', a.question_status,
               'generatedAnswer', a.generated_answer, 'finalAnswer', a.final_answer, 'draftKind', a.draft_kind,
               'confidence', a.confidence, 'verdict', a.verdict, 'judgeReason', a.judge_reason,
               'gate', a.gate, 'gateReason', a.gate_reason, 'language', a.language,
               'citedRefs', to_jsonb(coalesce(a.cited_refs, '{}'::text[])), 'sources', coalesce(a.sources_json, '[]'::jsonb))) AS j,
           a.due_date, a.created_at
      FROM a
  )
  SELECT jsonb_build_object(
    'toMe', coalesce((SELECT jsonb_agg(r.j ORDER BY r.due_date NULLS LAST, r.created_at) FROM rows r WHERE r.to_me), '[]'::jsonb),
    'fromMe', coalesce((SELECT jsonb_agg(r.j ORDER BY r.due_date NULLS LAST, r.created_at) FROM rows r WHERE r.from_me AND NOT r.to_me), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.my_assignments() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_assignments() TO authenticated;

-- Security review (L2): the answer and notes a person writes on an assignment are bounded in the
-- database, as the question card's answer is (20,000 characters). NOT VALID: binds new and changed
-- rows without checking the rows already there.
ALTER TABLE public.question_assignments
  ADD CONSTRAINT question_assignments_answer_length CHECK (answer_text IS NULL OR length(answer_text) <= 20000) NOT VALID,
  ADD CONSTRAINT question_assignments_notes_length CHECK (notes IS NULL OR length(notes) <= 2000) NOT VALID;
