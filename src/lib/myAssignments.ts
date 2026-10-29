/**
 * Sprint 19 (S19-1, U-3): questions for you. `my_assignments()` returns the caller's open assignments,
 * each with its question as it is now. Every action here is an existing write under the existing
 * rules (decision 0003): an assignee may approve the question they were assigned, as on the question
 * card, and may change their own assignment's answer, notes and stage.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { needsWrittenAnswer } from './format';

export interface MyAssignment {
  id: string;
  status: 'pending' | 'in_review' | 'answered' | 'approved' | 'closed';
  notes: string | null;
  answerText: string | null;
  assignedTo: string;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
  responseId: string;
  response: string;
  dueDate: string | null;
  ownerId: string;
  sessionId: string;
  question: {
    id: string; text: string; position: number; status: 'pending' | 'accepted' | 'skipped';
    generatedAnswer: string | null; finalAnswer: string | null;
    draftKind: 'generated' | 'assembled' | 'insufficient_evidence' | 'person_required' | null;
    confidence: number | null; verdict: 'yes' | 'partly' | 'no' | null; judgeReason: string | null;
    gate: string | null; gateReason: string | null; language: 'en' | 'ja' | null;
    citedRefs: string[]; sources: { id: string; score: number }[];
  };
}

export async function loadMyAssignments(client: SupabaseClient): Promise<{ toMe: MyAssignment[]; fromMe: MyAssignment[] }> {
  const { data, error } = await client.rpc('my_assignments');
  if (error) {
    console.error('my_assignments failed', error);
    throw new Error('Your assignments could not be loaded. Check your connection and try again.');
  }
  const d = (data ?? {}) as { toMe?: MyAssignment[]; fromMe?: MyAssignment[] };
  return { toMe: d.toMe ?? [], fromMe: d.fromMe ?? [] };
}

/** Handed back: answered, with no answer (Rory, Q2: no new stage). */
export const isHandedBack = (a: Pick<MyAssignment, 'status' | 'answerText'>) => a.status === 'answered' && !(a.answerText ?? '').trim();

/** Where a question stands for the person assigned it, in words, and whether they can still act on it. */
export function forYouState(a: MyAssignment): { label: string; open: boolean } {
  if (a.question.status === 'accepted') return { label: 'Approved; nothing more is needed from you', open: false };
  if (a.question.status === 'skipped') return { label: 'Left unanswered by the owner; nothing more is needed from you', open: false };
  if (a.status === 'approved') return { label: 'You approved it, but it has been reopened since; it is to do again', open: true };
  if (isHandedBack(a)) return { label: 'You handed this back; the owner decides', open: true };
  if (a.status === 'answered') return { label: 'You sent your answer to the owner; you can still change it or approve it', open: true };
  if (a.status === 'in_review') return { label: 'Working on it', open: true };
  return { label: 'Asked', open: true };
}

/** The text the answer box starts with: the answer sent, else the current answer, else the draft. */
export function startingAnswer(a: MyAssignment): string {
  if (a.status === 'answered' && (a.answerText ?? '').trim()) return a.answerText!;
  const q = a.question;
  if (q.draftKind === 'insufficient_evidence' || q.draftKind === 'person_required') {
    const written = (q.finalAnswer ?? '').trim();
    return written && written !== (q.generatedAnswer ?? '').trim() ? written : '';
  }
  return q.finalAnswer ?? q.generatedAnswer ?? '';
}

export const MAX_ANSWER = 20000;

export function answerProblem(a: MyAssignment, text: string): string | null {
  if (!text.trim()) return 'Write the answer first.';
  if (text.length > MAX_ANSWER) return `Keep the answer to ${MAX_ANSWER.toLocaleString('en-GB')} characters.`;
  if (needsWrittenAnswer({ draftKind: a.question.draftKind, generatedAnswer: a.question.generatedAnswer, finalAnswer: text })) {
    return 'There is no draft for this question: write the answer.';
  }
  return null;
}

export function handBackProblem(note: string): string | null {
  const n = note.trim();
  if (n.length < 5) return 'Say why, in at least 5 characters, so the owner knows who to ask.';
  if (n.length > 500) return 'Keep the note to 500 characters.';
  return null;
}

type Saved = { data: { id: string }[] | null; error: { message: string } | null };

async function updateAssignment(client: SupabaseClient, id: string, patch: Record<string, unknown>, what: string): Promise<void> {
  const r = (await client.from('question_assignments').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('id')) as unknown as Saved;
  if (r.error || !r.data?.length) throw new Error(`${what} was not saved: ${r.error?.message ?? 'you can no longer change this assignment'}.`);
}

/** Opening a question that was only asked moves it to Working on it. A failure here is not worth an error. */
export async function startWorking(client: SupabaseClient, a: MyAssignment): Promise<boolean> {
  if (a.status !== 'pending') return false;
  try {
    await updateAssignment(client, a.id, { status: 'in_review' }, 'The stage');
    return true;
  } catch {
    return false;
  }
}

export const ALREADY_DECIDED = 'The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.';

/**
 * Approve: the question, with this text (as on the question card), then the assignment. Each write
 * applies only while the question is still to do (security review, M1): a screen opened before the
 * owner decided can no longer reopen and overwrite their decision.
 */
export async function approveAssigned(client: SupabaseClient, a: MyAssignment, text: string): Promise<void> {
  const problem = answerProblem(a, text);
  if (problem) throw new Error(problem);
  for (const [i, patch] of [{ final_answer: text }, { status: 'accepted' }].entries()) {
    const r = (await client.from('rfi_questions').update(patch).eq('id', a.question.id).eq('status', 'pending').select('id')) as unknown as Saved;
    if (r.error) throw new Error(i === 0 ? `Your answer was not saved: ${r.error.message}.` : `Your answer was saved, but it was not approved: ${r.error.message}.`);
    if (!r.data?.length) throw new Error(i === 0 ? ALREADY_DECIDED : 'Your answer was saved, but the question was decided meanwhile, so it was not approved.');
  }
  try {
    await updateAssignment(client, a.id, { status: 'approved', answer_text: text, completed_at: new Date().toISOString() }, 'Your assignment');
  } catch (err) {
    throw new Error(`The question is approved, but ${(err as Error).message.charAt(0).toLowerCase()}${(err as Error).message.slice(1)}`);
  }
}

/** Send to the owner: the answer goes on the assignment; the question stays to do, for the owner. */
export async function sendToOwner(client: SupabaseClient, a: MyAssignment, text: string): Promise<void> {
  const problem = answerProblem(a, text);
  if (problem) throw new Error(problem);
  await updateAssignment(client, a.id, { status: 'answered', answer_text: text }, 'Your answer');
}

/** The notes after handing back: the reason is added to the notes already there, never replacing them (review, M2). */
export function notesAfterHandBack(existing: string | null, note: string): string {
  const reason = `Handed back: ${note.trim()}`;
  return (existing ?? '').trim() ? `${existing!.trim()}\n\n${reason}` : reason;
}

/** Hand back: a note for the owner, and no answer. */
export async function handBack(client: SupabaseClient, a: MyAssignment, note: string): Promise<void> {
  const problem = handBackProblem(note);
  if (problem) throw new Error(problem);
  await updateAssignment(client, a.id, { status: 'answered', answer_text: '', notes: notesAfterHandBack(a.notes, note) }, 'Your note');
}

export const MAX_NOTES = 2000;

/** Notes on the assignment, shared by the person answering and the owner. */
export async function saveNotes(client: SupabaseClient, a: MyAssignment, notes: string): Promise<void> {
  if (notes.length > MAX_NOTES) throw new Error(`Keep the notes to ${MAX_NOTES.toLocaleString('en-GB')} characters.`);
  await updateAssignment(client, a.id, { notes }, 'Your notes');
}
