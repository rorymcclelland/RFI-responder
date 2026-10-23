/** Expert assignments for a session's questions: load, assign and unassign. */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { QuestionAssignment, RFIQuestion, UserProfile } from '../types';

export function useAssignments({ sessionId, opportunityId, questions, currentUser, allUsers, onError }: {
  sessionId: string | null;
  opportunityId: string;
  questions: RFIQuestion[];
  currentUser: UserProfile;
  allUsers: UserProfile[];
  /** Shown to the person; an assignment that fails must not fail silently. */
  onError: (message: string) => void;
}) {
  const [assignments, setAssignments] = useState<Record<string, QuestionAssignment[]>>({});

  const loadAssignments = useCallback(async (sid: string) => {
    const { data } = await supabase
      .from('question_assignments')
      .select('*, assignedToProfile:user_profiles!question_assignments_assigned_to_fkey(id, display_name, job_title, expertise_tags, is_admin, created_at)')
      .eq('session_id', sid);
    if (data) {
      const map: Record<string, QuestionAssignment[]> = {};
      for (const r of data) {
        const a: QuestionAssignment = {
          id: r.id, questionId: r.question_id, sessionId: r.session_id,
          opportunityId: r.opportunity_id, assignedTo: r.assigned_to,
          assignedBy: r.assigned_by, questionText: r.question_text,
          answerText: r.answer_text, status: r.status, notes: r.notes,
          completedAt: r.completed_at ?? null,
          createdAt: r.created_at, updatedAt: r.updated_at,
          assignedToProfile: r.assignedToProfile ? {
            id: r.assignedToProfile.id, displayName: r.assignedToProfile.display_name,
            jobTitle: r.assignedToProfile.job_title ?? '', department: '',
            expertiseTags: r.assignedToProfile.expertise_tags ?? [],
            isAdmin: r.assignedToProfile.is_admin, createdAt: r.assignedToProfile.created_at,
          } : undefined,
        };
        if (!map[r.question_id]) map[r.question_id] = [];
        map[r.question_id].push(a);
      }
      setAssignments(map);
    }
  }, []);

  useEffect(() => {
    if (sessionId) loadAssignments(sessionId);
    else setAssignments({});
  }, [sessionId, loadAssignments]);

  async function handleAssign(questionId: string, userId: string) {
    const q = questions.find((q) => q.id === questionId);
    if (!q || !sessionId) return;
    const existing = assignments[questionId] ?? [];
    if (existing.some((a) => a.assignedTo === userId)) return;
    const { data, error } = await supabase
      .from('question_assignments')
      .insert({
        question_id: questionId, session_id: sessionId, opportunity_id: opportunityId,
        assigned_to: userId, assigned_by: currentUser.id,
        question_text: q.question, answer_text: q.finalAnswer,
      })
      .select().maybeSingle();
    if (error || !data) {
      onError(`The question could not be assigned: ${error?.message ?? 'no response'}`);
      return;
    }
    {
      const profile = allUsers.find((u) => u.id === userId);
      const newA: QuestionAssignment = {
        id: data.id, questionId: data.question_id, sessionId: data.session_id,
        opportunityId: data.opportunity_id, assignedTo: data.assigned_to,
        assignedBy: data.assigned_by, questionText: data.question_text,
        answerText: data.answer_text, status: data.status, notes: data.notes,
        completedAt: data.completed_at ?? null, createdAt: data.created_at, updatedAt: data.updated_at,
        assignedToProfile: profile,
      };
      setAssignments((prev) => ({ ...prev, [questionId]: [...(prev[questionId] ?? []), newA] }));
      if (opportunityId) {
        await supabase.from('opportunity_contributors')
          .upsert({ opportunity_id: opportunityId, user_id: userId }, { onConflict: 'opportunity_id,user_id' });
      }
    }
  }

  async function handleUnassign(questionId: string, assignmentId: string) {
    const { error } = await supabase.from('question_assignments').delete().eq('id', assignmentId);
    if (error) {
      onError(`The assignment could not be removed: ${error.message}`);
      return;
    }
    setAssignments((prev) => {
      const remaining = (prev[questionId] ?? []).filter((a) => a.id !== assignmentId);
      if (remaining.length === 0) { const next = { ...prev }; delete next[questionId]; return next; }
      return { ...prev, [questionId]: remaining };
    });
  }

  return { assignments, handleAssign, handleUnassign };
}
