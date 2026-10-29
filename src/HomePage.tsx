/**
 * Sprint 19 (S19-3, U-4): Home, where everyone lands. What needs you today, your responses in
 * progress, and what the organisation knows, with Ask it a question.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { loadMyAssignments } from './lib/myAssignments';
import { loadOverview } from './lib/responses';
import { loadKnowledgeOverview, type KnowledgeOverview } from './lib/knowledgeBrowse';
import { needsYou, yourResponses, type NeedItem } from './lib/home';
import { openQuestion } from './lib/openQuestion';
import { openEntry } from './lib/openEntry';
import type { Opportunity, UserProfile } from './types';
import AskBox from './knowledge/AskBox';

const GROUP_TITLE: Record<NeedItem['group'], string> = {
  for_you: 'Questions for you', answered: 'Answered by colleagues', responses: 'Your responses at risk or overdue', review: 'For admins',
};
const STAGE_LABEL: Record<string, string> = {
  new: 'No questions yet', in_review: 'In progress', ready: 'Ready to send', exported: 'Exported', changed: 'Changed since export', archived: 'Archived',
};
const day = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null);

interface Props {
  currentUser: UserProfile;
  names: Map<string, string>;
  onOpenForYou: (assignmentId: string) => void;
  onOpenResponse: (r: Opportunity) => void;
  onReview: () => void;
  onKnowledge: () => void;
  onAsked?: () => void;
}

export default function HomePage({ currentUser, names, onOpenForYou, onOpenResponse, onReview, onKnowledge, onAsked }: Props) {
  const [data, setData] = useState<{ items: NeedItem[]; responses: Opportunity[]; all: Opportunity[]; knowledge: KnowledgeOverview | null } | null>(null);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setError('');
    try {
      const [mine, all, knowledge] = await Promise.all([
        loadMyAssignments(supabase), loadOverview(supabase), loadKnowledgeOverview(supabase).catch(() => null),
      ]);
      if (n !== seq.current) return;
      setData({
        items: needsYou({ me: currentUser.id, isAdmin: currentUser.isAdmin, toMe: mine.toMe, fromMe: mine.fromMe, responses: all, knowledge, names }),
        responses: yourResponses(all, currentUser.id), all, knowledge,
      });
    } catch (err) {
      if (n === seq.current) setError((err as Error).message);
    }
  }, [currentUser.id, currentUser.isAdmin, names]);
  useEffect(() => { load(); }, [load]);

  const go = (i: NeedItem) => {
    const a = i.action;
    if (a.kind === 'for_you') onOpenForYou(a.assignmentId);
    else if (a.kind === 'question') openQuestion(a.target);
    else if (a.kind === 'review') onReview();
    else {
      const r = data?.all.find((x) => x.id === a.responseId);
      if (r) onOpenResponse(r);
    }
  };

  const first = currentUser.displayName.split(' ')[0];
  const groups = (['for_you', 'answered', 'responses', 'review'] as NeedItem['group'][])
    .map((g) => ({ g, items: data?.items.filter((i) => i.group === g) ?? [] })).filter((x) => x.items.length > 0);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-black text-ink-900 tracking-tight">Hello, {first}</h1>
        <p className="text-ink-500 mt-1.5 text-sm font-medium">What needs you today, your responses, and what the organisation knows.</p>
      </div>
      {error && <p role="alert" className="text-sm text-coral-600">{error} <button onClick={load} className="btn-ghost text-xs ml-2">Try again</button></p>}
      {!data && !error && <p role="status" className="text-sm text-ink-400">Loading…</p>}

      {data && (
        <div className="flex flex-wrap gap-6 items-start">
          <div className="flex-[999_1_480px] min-w-0 space-y-6">
            <section aria-labelledby="needs" className="card p-6 space-y-5">
              <h2 id="needs" className="text-lg font-black text-ink-900">Needs you</h2>
              {groups.length === 0 && (
                <p className="text-sm text-ink-600 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" /> Nothing needs you right now.</p>
              )}
              {groups.map(({ g, items }) => (
                <div key={g} className="space-y-2">
                  <p className="section-label">{GROUP_TITLE[g]} ({items.length})</p>
                  <ul className="space-y-2">
                    {items.map((i) => (
                      <li key={i.key}>
                        <button onClick={() => go(i)} className="w-full text-left rounded-2xl border border-ink-100 hover:border-ink-300 bg-white px-4 py-3 flex items-start gap-3">
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-bold text-ink-800">{i.title}</span>
                            <span className="block text-xs text-ink-500 mt-0.5">{i.detail}</span>
                          </span>
                          <ArrowRight size={14} className="text-ink-400 mt-1 flex-shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            <section aria-labelledby="yours" className="card p-6 space-y-3">
              <h2 id="yours" className="text-lg font-black text-ink-900">Your responses</h2>
              {data.responses.length === 0 && <p className="text-sm text-ink-500">You own no response in progress.</p>}
              <ul className="space-y-2">
                {data.responses.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => onOpenResponse(r)} className="w-full text-left rounded-2xl border border-ink-100 hover:border-ink-300 bg-white px-4 py-3">
                      <span className="block text-sm font-bold text-ink-800">{r.name}</span>
                      <span className="block text-xs text-ink-500 mt-0.5">
                        {STAGE_LABEL[r.stage] ?? r.stage}{r.dueDate ? ` · due ${day(r.dueDate)}` : ''} · {r.decided} of {r.total} decided
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside aria-label="What we know" className="flex-[1_1_340px] min-w-0 space-y-4">
            {data.knowledge && (
              <section className="card p-6 space-y-2">
                <h2 className="text-lg font-black text-ink-900">What we know</h2>
                <p className="text-sm text-ink-600">
                  {data.knowledge.total} answers, {data.knowledge.languages.en} in English and {data.knowledge.languages.ja} in Japanese.
                  {' '}{data.knowledge.states.reviewed} reviewed and current, {data.knowledge.states.waiting} waiting for review and {data.knowledge.states.translations} translations to check.
                </p>
                <button onClick={onKnowledge} className="text-xs font-bold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1">Open Knowledge <ArrowRight size={12} /></button>
              </section>
            )}
            <AskBox questionOf={() => undefined} onOpen={(r) => openEntry(r)} onAsked={onAsked} />
          </aside>
        </div>
      )}
    </div>
  );
}
