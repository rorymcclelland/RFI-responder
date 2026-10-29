/**
 * Sprint 19 (S19-3, U-4): Home. What needs the signed-in person today, across responses, assignments
 * and the knowledge base, built from what the app already reads (my_assignments, the responses
 * overview and the knowledge overview). Pure and tested; the page only draws it.
 */
import type { Opportunity } from '../types';
import type { KnowledgeOverview } from './knowledgeBrowse';
import { forYouState, isHandedBack, type MyAssignment } from './myAssignments';
import type { QuestionTarget } from './openQuestion';

export type NeedAction =
  | { kind: 'for_you'; assignmentId: string }
  | { kind: 'question'; target: QuestionTarget }
  | { kind: 'response'; responseId: string }
  | { kind: 'review' };

export interface NeedItem {
  key: string;
  group: 'for_you' | 'answered' | 'responses' | 'review';
  title: string;
  detail: string;
  action: NeedAction;
}

const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);
const byDue = (a: { dueDate: string | null; createdAt?: string }, b: { dueDate: string | null; createdAt?: string }) =>
  (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

export function needsYou(o: {
  me: string;
  isAdmin: boolean;
  toMe: MyAssignment[];
  fromMe: MyAssignment[];
  responses: Opportunity[];
  knowledge: KnowledgeOverview | null;
  names: Map<string, string>;
}): NeedItem[] {
  const who = (id: string) => o.names.get(id) ?? 'A former team member';
  const items: NeedItem[] = [];

  // 1. Questions for you: assigned to you, still to do, not yet answered by you.
  for (const a of [...o.toMe].sort(byDue)) {
    if (!forYouState(a).open || a.status === 'answered') continue;
    items.push({
      key: `for-you-${a.id}`, group: 'for_you', title: a.question.text,
      detail: `${who(a.assignedBy)} asked you · ${a.response}${a.dueDate ? ` · due ${day(a.dueDate)}` : ''}`,
      action: { kind: 'for_you', assignmentId: a.id },
    });
  }

  // 2. Answered by colleagues, or handed back: on your responses or ones you assigned, not yet decided.
  for (const a of [...o.fromMe].sort(byDue)) {
    if (a.status !== 'answered' || a.question.status !== 'pending') continue;
    const back = isHandedBack(a);
    items.push({
      key: `answered-${a.id}`, group: 'answered', title: a.question.text,
      detail: back ? `${who(a.assignedTo)} handed this back: ${(a.notes ?? '').trim() || 'no note'} · ${a.response}` : `${who(a.assignedTo)} answered · ${a.response}`,
      action: { kind: 'question', target: { responseId: a.responseId, sessionId: a.sessionId, questionId: a.question.id } },
    });
  }

  // 3. Your responses at risk or overdue, with the reason.
  for (const r of o.responses.filter((x) => x.ownerId === o.me && !x.archivedAt && (x.overdue || x.atRisk)).sort((a, b) => byDue(a, b))) {
    const left = r.total === 0 ? 'no questions added yet' : `${r.pending} ${r.pending === 1 ? 'question' : 'questions'} still to do`;
    items.push({
      key: `response-${r.id}`, group: 'responses', title: r.name,
      detail: r.overdue ? `Overdue: it was due ${day(r.dueDate)}, with ${left}` : `At risk: due ${day(r.dueDate)}, with ${left}`,
      action: { kind: 'response', responseId: r.id },
    });
  }

  // 4. For admins: what waits for review in the knowledge base, as one line.
  if (o.isAdmin && o.knowledge) {
    const s = o.knowledge.states;
    const parts = [
      s.waiting && `${s.waiting} waiting for review`,
      s.translations && `${s.translations} ${s.translations === 1 ? 'translation' : 'translations'} to check`,
      s.proposals && `${s.proposals} proposed ${s.proposals === 1 ? 'change' : 'changes'}`,
      s.overdue && `${s.overdue} overdue for review`,
    ].filter(Boolean) as string[];
    if (parts.length) {
      items.push({ key: 'review', group: 'review', title: 'Answers to review', detail: parts.join(', '), action: { kind: 'review' } });
    }
  }
  return items;
}

/** Your responses in progress (not exported, not archived), soonest due first. */
export function yourResponses(responses: Opportunity[], me: string): Opportunity[] {
  return responses.filter((r) => r.ownerId === me && !r.archivedAt && !r.exportedAt).sort((a, b) => byDue(a, b));
}
