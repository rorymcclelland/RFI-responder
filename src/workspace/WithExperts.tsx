/**
 * Sprint 22 (S22-1, U-5): With experts, every question of the open file asked of a colleague: who,
 * where it stands and their note, an answer to look at first. Choosing one opens it at its question.
 * Replaces the banner of notes to review (Sprint 3). Text shows as text, never as markup.
 */
import { ArrowRight, MessageSquare } from 'lucide-react';
import type { QuestionAssignment, RFIQuestion, UserProfile } from '../types';
import { ASSIGNMENT_WORD, expertItems } from './journey';

const PILL: Record<string, string> = {
  pending: 'bg-ink-50 text-ink-600 border-ink-200',
  in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  answered: 'bg-sky-50 text-sky-700 border-sky-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-ink-50 text-ink-400 border-ink-200',
};

export default function WithExperts({ questions, assignments, users, onOpen }: {
  questions: RFIQuestion[];
  assignments: Record<string, QuestionAssignment[]>;
  users: UserProfile[];
  onOpen: (questionId: string) => void;
}) {
  const items = expertItems(questions, assignments);
  const name = (a: QuestionAssignment) => a.assignedToProfile?.displayName ?? users.find((u) => u.id === a.assignedTo)?.displayName ?? 'A colleague';
  const answered = items.filter((i) => i.assignment.status === 'answered').length;

  return (
    <section id="stage-experts" aria-labelledby="stage-experts-heading" className="space-y-3 scroll-mt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="stage-experts-heading" className="text-lg font-black text-ink-900">With experts</h2>
        <p className="text-xs text-ink-500">
          {items.length === 0
            ? 'No question in this response has been asked of a colleague. Open a question to assign it.'
            : `${items.length} ${items.length === 1 ? 'question asked' : 'questions asked'} of colleagues${answered ? `; ${answered} answered, for you to look at` : ''}.`}
        </p>
      </div>
      {items.length > 0 && (
        <ul aria-label="With experts" className="bg-white rounded-2xl border border-ink-100 shadow-card divide-y divide-ink-100">
          {items.map(({ assignment: a, question }) => (
            <li key={a.id}>
              <button onClick={() => onOpen(a.questionId)} className="w-full flex items-start gap-3 px-4 sm:px-5 py-3 text-left hover:bg-ink-50 transition-colors group">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-ink-800 break-words">{question?.question ?? a.questionText}</p>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    <span className="font-bold text-ink-700">{name(a)}</span>
                    <span className={`status-pill text-2xs ${PILL[a.status] ?? PILL.pending}`}>{ASSIGNMENT_WORD[a.status] ?? a.status}</span>
                  </p>
                  {a.notes.trim() && (
                    <p className="flex items-start gap-1.5 text-xs text-ink-600 italic break-words">
                      <MessageSquare size={12} className="flex-shrink-0 mt-0.5 text-ink-400" aria-hidden="true" />
                      <span>&ldquo;{a.notes}&rdquo;</span>
                    </p>
                  )}
                </div>
                <span className="flex items-center gap-1 text-xs font-bold text-ink-500 group-hover:text-ink-800 flex-shrink-0 mt-0.5">
                  {a.status === 'answered' ? 'Look at the answer' : 'Open'} <ArrowRight size={12} aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
