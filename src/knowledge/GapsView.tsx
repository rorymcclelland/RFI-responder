/**
 * Sprint 21 (S21-2, K-4): Knowledge, Gaps. What the knowledge base could not answer in responses from
 * the last 90 days, grouped by wording, with where each stands, and one step to act on the open ones:
 * open the question in its response (to write the answer or assign it, as there). Nothing is learned
 * here (rule 7); questions show as text, never as markup.
 */
import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { openQuestion } from '../lib/openQuestion';
import { GAP_EXPLAIN, GAP_LABEL, GAP_STATES, filterGaps, gapCounts, type Gap, type GapState } from '../lib/knowledgeGaps';

const PILL: Record<GapState, string> = {
  open: 'bg-coral-50 text-coral-700 border-coral-200',
  answered: 'bg-sky-50 text-sky-700 border-sky-200',
  learned: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  proposed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  not_learned: 'bg-ink-50 text-ink-600 border-ink-200',
  unanswered: 'bg-ink-50 text-ink-500 border-ink-200',
};

export default function GapsView({ gaps, total, initial = [], onOpenEntry }: {
  gaps: Gap[];
  /** How many groups there are in all; at most 500 are returned (security review, Sprint 21). */
  total: number;
  /** States to show first (the overview's count opens the open ones). */
  initial?: GapState[];
  onOpenEntry: (ref: string) => void;
}) {
  const [states, setStates] = useState<GapState[]>(initial);
  const counts = gapCounts(gaps);
  const shown = filterGaps(gaps, states);
  const toggle = (s: GapState) => setStates((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-600 max-w-3xl">
        Questions from responses in the last 90 days that the knowledge base could not answer. Questions worded the same
        (ignoring case, spaces and punctuation) are one line, with how many responses asked them. Pricing questions are
        never listed. Nothing is learned here: a person&apos;s answer is learned when its response is marked as sent.
      </p>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="section-label mb-2">Show</legend>
        {GAP_STATES.map((s) => (
          <label key={s} className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" className="w-4 h-4" checked={states.includes(s)} onChange={() => toggle(s)} />
            {GAP_LABEL[s]} ({counts[s]})
          </label>
        ))}
      </fieldset>

      <section aria-label="Gaps" className="space-y-2">
        <p className="text-sm text-ink-500" role="status">
          {gaps.length === 0 ? 'No gaps: in responses from the last 90 days, every question but pricing had a draft from the knowledge base.'
            : `${shown.length} of ${gaps.length} ${gaps.length === 1 ? 'question' : 'questions'}${total > gaps.length ? `; the first ${gaps.length} of ${total} are listed, those still to do first` : ''}`}
        </p>
        {gaps.length > 0 && shown.length === 0 && <p className="text-sm text-ink-400 py-6 text-center">None in the states chosen. Tick another state above.</p>}
        {shown.map((g) => (
          <article key={g.questionId} aria-label={g.question} className="bg-white rounded-2xl border border-ink-100 px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-start gap-2">
              <p className="font-bold text-sm text-ink-800 flex-1 min-w-[12rem] break-words">{g.question}</p>
              <span className={`status-pill text-2xs ${PILL[g.state]}`} title={GAP_EXPLAIN[g.state]}>{GAP_LABEL[g.state]}</span>
            </div>
            <p className="text-xs text-ink-500">
              {g.responses === 1 ? 'Asked in 1 response' : `Asked in ${g.responses} responses`}
              {' · '}{g.state === 'learned' ? 'answered in' : g.state === 'open' ? 'to do in' : 'latest in'} {g.response}
            </p>
            <p className="text-xs text-ink-500">{GAP_EXPLAIN[g.state]}</p>
            <div className="flex flex-wrap gap-2">
              {g.state === 'open' && (
                <button className="btn-primary text-xs py-2"
                  onClick={() => openQuestion({ responseId: g.responseId, sessionId: g.sessionId, questionId: g.questionId })}>
                  Open it in the response <ArrowRight size={13} />
                </button>
              )}
              {(g.state === 'learned' || g.state === 'proposed') && g.entryRef && (
                <button className="btn-ghost text-xs py-2" onClick={() => onOpenEntry(g.entryRef!)}>
                  {g.entryRef}
                </button>
              )}
              {g.state !== 'open' && g.state !== 'learned' && g.state !== 'proposed' && (
                <button className="btn-ghost text-xs py-2"
                  onClick={() => openQuestion({ responseId: g.responseId, sessionId: g.sessionId, questionId: g.questionId })}>
                  See it in the response
                </button>
              )}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
