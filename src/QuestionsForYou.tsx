/**
 * Sprint 19 (S19-1, U-3): questions for you. Each question assigned to you, as it is now, with what
 * you need to answer it, and three things you can do: approve it (as on the question card), send your
 * answer to the owner, or hand it back with a note. The database decides, as everywhere.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Inbox } from 'lucide-react';
import { supabase } from './lib/supabase';
import {
  approveAssigned, answerProblem, forYouState, handBack, handBackProblem, loadMyAssignments, sendToOwner, startWorking, startingAnswer,
  MAX_ANSWER, type MyAssignment,
} from './lib/myAssignments';
import { openEntry } from './lib/openEntry';
import { openQuestion } from './lib/openQuestion';
import { confidenceBand } from './workspace/confidenceBands';
import { formatConfidence } from './lib/format';
import LanguageLabel from './LanguageLabel';

const VERDICT: Record<string, string> = { yes: 'Yes', partly: 'Partly', no: 'No' };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

export default function QuestionsForYou({ names, onChanged }: { names: Map<string, string>; onChanged?: () => void }) {
  const [items, setItems] = useState<MyAssignment[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setError('');
    try {
      const { toMe } = await loadMyAssignments(supabase);
      if (n === seq.current) setItems(toMe);
    } catch (err) {
      if (n === seq.current) setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = (items ?? []).filter((a) => forYouState(a).open);
  const done = (items ?? []).filter((a) => !forYouState(a).open);
  const current = (items ?? []).find((a) => a.id === selected) ?? open[0] ?? null;

  // Opening an asked question moves it to Working on it.
  useEffect(() => {
    if (!current || current.status !== 'pending') return;
    startWorking(supabase, current).then((moved) => { if (moved) load(); });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return <p role="alert" className="text-sm text-coral-600">{error} <button onClick={load} className="btn-ghost text-xs ml-2">Try again</button></p>;
  }
  if (!items) return <p role="status" className="text-sm text-ink-400">Loading the questions for you…</p>;
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center text-center py-16 gap-3">
        <div className="w-14 h-14 bg-white rounded-2xl shadow-card flex items-center justify-center"><Inbox size={24} className="text-ink-300" /></div>
        <p className="font-bold text-ink-700">No questions for you</p>
        <p className="text-sm text-ink-400">A question appears here when someone assigns it to you from a response.</p>
      </div>
    );
  }

  const row = (a: MyAssignment) => (
    <button key={a.id} onClick={() => { setSelected(a.id); setNotice(null); }} aria-pressed={current?.id === a.id}
      className={`w-full text-left bg-white rounded-2xl border px-4 py-3 transition-colors ${current?.id === a.id ? 'border-ink-900' : 'border-ink-100 hover:border-ink-300'}`}>
      <span className="block text-sm font-bold text-ink-800">{a.question.text}</span>
      <span className="block text-xs text-ink-500 mt-1">{a.response}{a.dueDate ? ` · due ${day(a.dueDate)}` : ''} · {forYouState(a).label}</span>
    </button>
  );

  return (
    <div className="flex flex-wrap gap-6 items-start">
      <section aria-label="Questions" className="flex-[1_1_300px] max-w-md space-y-2">
        {open.length > 0 ? open.map(row) : <p className="text-sm text-ink-500">Nothing waiting for you.</p>}
        {done.length > 0 && (
          <>
            <p className="section-label pt-3">Decided</p>
            {done.map(row)}
          </>
        )}
      </section>
      {current && (
        <div className="flex-[999_1_420px] min-w-0 space-y-3">
          <div aria-live="polite">
            {notice && <p role={notice.tone === 'error' ? 'alert' : undefined} className={`text-sm ${notice.tone === 'error' ? 'text-coral-600' : 'text-emerald-700'}`}>{notice.text}</p>}
          </div>
          <QuestionPanel key={current.id + current.updatedAt + current.question.status} a={current} names={names}
            onDone={(text, tone) => { setNotice({ text, tone }); load(); onChanged?.(); }} />
        </div>
      )}
    </div>
  );
}

function QuestionPanel({ a, names, onDone }: { a: MyAssignment; names: Map<string, string>; onDone: (text: string, tone: 'ok' | 'error') => void }) {
  const q = a.question;
  const state = forYouState(a);
  const [text, setText] = useState(() => startingAnswer(a));
  const [note, setNote] = useState('');
  const [handingBack, setHandingBack] = useState(false);
  const [busy, setBusy] = useState(false);
  const band = confidenceBand(q.confidence);
  const noDraft = q.draftKind === 'insufficient_evidence' || q.draftKind === 'person_required';

  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await fn();
      onDone(done, 'ok');
    } catch (err) {
      onDone((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside aria-label="The question" className="card p-6 space-y-4 border-2 border-ink-900">
      <div className="space-y-1">
        <p className="text-xs font-bold text-ink-500 flex flex-wrap items-center gap-2">
          {a.response}{a.dueDate ? ` · due ${day(a.dueDate)}` : ''} · asked by {names.get(a.assignedBy) ?? 'a former team member'} <LanguageLabel language={q.language} />
        </p>
        <h2 className="text-lg font-black text-ink-900">{q.text}</h2>
        <p className="text-xs text-ink-500">{state.label}.</p>
        <button onClick={() => openQuestion({ responseId: a.responseId, sessionId: a.sessionId, questionId: q.id })}
          className="text-xs font-bold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1">Open it in the response <ArrowRight size={12} /></button>
      </div>

      <div className="text-xs text-ink-600 space-y-1">
        <p>Confidence: <strong>{band.label}</strong>{q.confidence !== null ? ` (${formatConfidence(q.confidence)})` : ''}
          {q.verdict && <> · Checker: <strong>{VERDICT[q.verdict] ?? q.verdict}</strong>{q.judgeReason ? `, ${q.judgeReason}` : ''}</>}</p>
        {q.gateReason && <p><strong>Held back from bulk approval:</strong> {q.gateReason}</p>}
        {noDraft && <p>{q.draftKind === 'person_required' ? 'A person must answer pricing questions; none is drafted.' : 'The knowledge base does not answer this, so nothing was drafted: write the answer.'}</p>}
        {q.citedRefs.length > 0 && (
          <p>Drawn from: {q.citedRefs.map((r, i) => (
            <span key={r}>{i > 0 ? ', ' : ''}<button className="font-bold underline" onClick={() => openEntry(r)}>{r}</button></span>
          ))}</p>
        )}
        {a.notes && <p className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 text-ink-700">Your notes: {a.notes}</p>}
      </div>

      {state.open ? (
        <>
          <label className="block">
            <span className="text-sm font-bold text-ink-700">Your answer</span>
            <textarea className="input mt-1 text-sm leading-relaxed" rows={8} maxLength={MAX_ANSWER} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={noDraft ? 'Write the answer.' : undefined} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || answerProblem(a, text) !== null} className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => act(() => approveAssigned(supabase, a, text), 'Approved. The owner will see it as decided.')}>Approve</button>
            <button disabled={busy || answerProblem(a, text) !== null} className="btn-ghost text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => act(() => sendToOwner(supabase, a, text), 'Sent to the owner, who decides.')}>Send to the owner</button>
            <button disabled={busy} className="btn-ghost text-xs" onClick={() => setHandingBack(true)}>Hand back</button>
          </div>
          <p className="text-xs text-ink-500">
            <strong>Approve</strong> decides the question with your answer, as the owner could. <strong>Send to the owner</strong> leaves the decision to them. Either way a person has approved every answer before it is sent.
          </p>
          {handingBack && (
            <form className="space-y-2 rounded-2xl border border-ink-200 p-4" onSubmit={(e) => { e.preventDefault(); act(() => handBack(supabase, a, note), 'Handed back to the owner, with your note.'); }}>
              <label className="block text-sm font-bold text-ink-700">Why is this not for you?
                <textarea className="input mt-1 text-sm" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="For example: ask the legal team." />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || handBackProblem(note) !== null} className="btn-primary text-xs disabled:opacity-40 disabled:cursor-not-allowed">Hand it back</button>
                <button type="button" onClick={() => setHandingBack(false)} className="btn-ghost text-xs">Cancel</button>
              </div>
            </form>
          )}
        </>
      ) : (
        <div className="text-sm text-ink-700 bg-ink-50 rounded-2xl p-4 whitespace-pre-wrap">{q.finalAnswer || 'Left unanswered.'}</div>
      )}
    </aside>
  );
}
