/** Assignments where a team member has added notes, shown above the question list. */
import { useState } from 'react';
import { ArrowRight, ChevronDown, ChevronUp, MessageSquare, User } from 'lucide-react';
import type { QuestionAssignment, RFIQuestion } from '../types';

export default function ReadyForReviewBanner({
  items, questions, onFocus,
}: {
  items: QuestionAssignment[]; questions: RFIQuestion[]; onFocus: (questionId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-3 px-5 py-4 hover:bg-amber-100/50 transition-colors"
      >
        <div className="w-8 h-8 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0">
          <MessageSquare size={16} className="text-white" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold text-amber-900">
            {items.length} assignment{items.length !== 1 ? 's' : ''} with notes to review
          </p>
          <p className="text-xs text-amber-700 font-medium">Team members have added notes</p>
        </div>
        {collapsed
          ? <ChevronDown size={16} className="text-amber-600 flex-shrink-0" />
          : <ChevronUp size={16} className="text-amber-600 flex-shrink-0" />}
      </button>

      {!collapsed && (
        <div className="border-t border-amber-200 divide-y divide-amber-100">
          {items.map((a) => {
            const q = questions.find((q) => q.id === a.questionId);
            return (
              <button
                key={a.id}
                onClick={() => onFocus(a.questionId)}
                className="w-full flex items-start gap-3 px-5 py-3.5 hover:bg-amber-100/50 transition-colors text-left group"
              >
                <div className="w-8 h-8 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center text-xs font-black flex-shrink-0 mt-0.5">
                  {a.assignedToProfile?.displayName.charAt(0).toUpperCase() ?? <User size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-bold text-amber-900">{a.assignedToProfile?.displayName ?? 'Team member'}</span>
                    <span className={`status-pill text-2xs ${
                      a.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      a.status === 'answered' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                      'bg-amber-100 text-amber-700 border-amber-300'
                    }`}>
                      {a.status === 'approved' ? 'Approved' : a.status === 'answered' ? 'Answered' : 'In review'}
                    </span>
                  </div>
                  <p className="text-xs text-amber-800 font-medium line-clamp-1 mb-1">{q?.question ?? a.questionText}</p>
                  <p className="text-xs text-amber-700 bg-white/70 rounded-lg px-2.5 py-1.5 border border-amber-200 line-clamp-2 italic">"{a.notes}"</p>
                </div>
                <ArrowRight size={13} className="text-amber-400 group-hover:text-amber-600 transition-colors flex-shrink-0 mt-1" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
