/**
 * Sprint 18 (S18-2, K-2): one answer and its history. Where it came from, who checked it and when,
 * where it has been used and with what outcome, what it replaced, its other languages and any change
 * waiting to replace it. An admin can approve it, mark it still correct or correct it here; the
 * database decides (review_entry and the column grants), as under Governance.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { supabase } from '../lib/supabase';
import LanguageLabel from '../LanguageLabel';
import { reviewEntry } from '../lib/entryReview';
import { DETAIL_STATE_LABEL, describeEvent, describeUse, loadEntryDetail, saveEntryEdits, type EntryDetail } from '../lib/entryDetail';
import { describeSource } from '../lib/knowledgeBrowse';

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

interface Props {
  refId: string;
  names: Map<string, string>;
  isAdmin: boolean;
  /** Open another answer (a proposal, a translation, what it replaced). */
  onOpen: (ref: string) => void;
  /** Something changed: the overview and the list reload. */
  onChanged: (message: string) => void;
  /** Shown at the top on a phone, where the answer sits below the list. */
  backToList?: (() => void) | null;
  extraActions?: (d: EntryDetail, reload: () => void) => React.ReactNode;
}

export default function EntryPanel({ refId, names, isAdmin, onOpen, onChanged, backToList, extraActions }: Props) {
  const [detail, setDetail] = useState<EntryDetail | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ question: '', answer: '', tags: '', source: '' });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    setError('');
    try {
      const d = await loadEntryDetail(supabase, refId);
      if (n === seq.current) setDetail(d);
    } catch (err) {
      if (n === seq.current) { setDetail(undefined); setError((err as Error).message); }
    }
  }, [refId]);
  useEffect(() => { setDetail(undefined); setEditing(false); load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError('');
    try {
      const message = await fn();
      setEditing(false);
      await load();
      onChanged(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (detail === undefined) {
    return (
      <div className="space-y-2">
        {backToList && <button onClick={backToList} className="text-xs font-semibold text-ink-500 hover:text-ink-800">Back to the list</button>}
        <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-coral-600' : 'text-ink-400'}`}>
          {error || `Loading ${refId}…`} {error && <button onClick={load} className="btn-ghost text-xs ml-2">Try again</button>}
        </p>
      </div>
    );
  }
  if (detail === null) return <p className="text-sm text-ink-500">No answer {refId} in the knowledge base.</p>;

  const e = detail.entry;
  const current = !['replaced', 'retired', 'proposal'].includes(e.state);
  const asBrowse = { ...e, originRef: null, source: e.source ?? '' };
  const history = [
    { at: e.createdAt, text: `${describeSource(asBrowse as never, names)}` },
    ...detail.history.map((h) => ({ at: h.at, text: describeEvent(h, names), previous: h.action === 'kb.reviewed' ? (h.details?.previous as { question?: string; answer?: string } | null) : null })),
  ];

  return (
    <div className="space-y-5">
      {backToList && <button onClick={backToList} className="text-xs font-semibold text-ink-500 hover:text-ink-800">Back to the list</button>}
      <div className="space-y-3">
        <p className="text-xs font-bold text-ink-500 flex flex-wrap items-center gap-2">
          <BookOpen size={12} /> {e.ref} · {DETAIL_STATE_LABEL[e.state]} <LanguageLabel language={e.language} />
        </p>
        {e.state === 'replaced' && e.replacedBy && (
          <p className="text-sm text-ink-700 bg-ink-50 rounded-xl px-3 py-2">Replaced by <button className="font-bold underline" onClick={() => onOpen(e.replacedBy!)}>{e.replacedBy}</button>; it is no longer used for drafts.</p>
        )}
        {e.state === 'proposal' && e.proposalFor && (
          <p className="text-sm text-ink-700 bg-amber-50 rounded-xl px-3 py-2">A proposed change to <button className="font-bold underline" onClick={() => onOpen(e.proposalFor!)}>{e.proposalFor}</button>, waiting for an admin's review; until then {e.proposalFor} is used as it stands.</p>
        )}
        {editing ? (
          <form className="space-y-3" onSubmit={(ev) => { ev.preventDefault(); act(async () => {
            const r = await saveEntryEdits(supabase, e, form);
            return r.reviewed ? `${e.ref} corrected and reviewed.` : r.changed ? `${e.ref} saved.` : 'Nothing changed.';
          }); }}>
            <label className="block text-sm font-bold text-ink-700">Question
              <textarea className="input mt-1 text-sm" rows={2} value={form.question} onChange={(v) => setForm({ ...form, question: v.target.value })} />
            </label>
            <label className="block text-sm font-bold text-ink-700">Answer
              <textarea className="input mt-1 text-sm" rows={6} value={form.answer} onChange={(v) => setForm({ ...form, answer: v.target.value })} />
            </label>
            <label className="block text-sm font-bold text-ink-700">Topics, separated by commas
              <input className="input mt-1 text-sm" value={form.tags} onChange={(v) => setForm({ ...form, tags: v.target.value })} />
            </label>
            <label className="block text-sm font-bold text-ink-700">Source
              <input className="input mt-1 text-sm" value={form.source} onChange={(v) => setForm({ ...form, source: v.target.value })} />
            </label>
            <p className="text-xs text-ink-500">Changing the question or answer counts as your review. Topics and source change without one.</p>
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className="btn-primary text-xs">{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost text-xs">Cancel</button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="text-lg font-black text-ink-900">{e.question}</h2>
            <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-line">{e.answer}</p>
            {e.tags.length > 0 && <p className="text-xs text-ink-500">Topics: {e.tags.join(', ')}</p>}
            {e.source && <p className="text-xs text-ink-500">Source: {e.source}</p>}
            {current && <p className="text-xs text-ink-500">Next review: {day(e.due)}{e.state === 'overdue' ? ' (overdue)' : ''}</p>}
          </>
        )}
        {isAdmin && current && !editing && (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => act(async () => { await reviewEntry(supabase, e.id); return e.state === 'waiting' || e.state === 'translation' ? `${e.ref} approved.` : `${e.ref} marked as still correct.`; })}
              className="btn-primary text-xs">{e.state === 'waiting' || e.state === 'translation' ? 'Approve' : 'Mark as still correct'}</button>
            <button disabled={busy} onClick={() => { setForm({ question: e.question, answer: e.answer, tags: e.tags.join(', '), source: e.source ?? '' }); setEditing(true); }}
              className="btn-ghost text-xs">Edit</button>
            {extraActions?.(detail, load)}
          </div>
        )}
        {isAdmin && !current && !editing && extraActions?.(detail, load)}
        {error && <p role="alert" className="text-sm text-coral-600">{error}</p>}
      </div>

      {detail.proposal && (
        <section aria-labelledby="proposal" className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4 space-y-2">
          <h3 id="proposal" className="text-sm font-black text-ink-900">A proposed change is waiting</h3>
          <p className="text-sm text-ink-700 whitespace-pre-line">{detail.proposal.answer}</p>
          <p className="text-xs text-ink-500">
            <button className="font-bold underline" onClick={() => onOpen(detail.proposal!.ref)}>{detail.proposal.ref}</button>
            {detail.proposal.source ? ` · ${detail.proposal.source.replace(/^RFI response: /, 'from ')}` : ''} · approved by {names.get(detail.proposal.createdBy ?? '') ?? 'a former team member'}, who is not an admin
          </p>
          {isAdmin && (
            <button disabled={busy} onClick={() => act(async () => { await reviewEntry(supabase, detail.proposal!.id); return `${detail.proposal!.ref} approved; it replaces ${e.ref}.`; })}
              className="btn-primary text-xs">Approve the change</button>
          )}
        </section>
      )}

      <section aria-labelledby="used" className="space-y-2">
        <h3 id="used" className="text-sm font-black text-ink-900">Where it has been used ({detail.usedCount})</h3>
        {detail.usedCount === 0 && <p className="text-xs text-ink-500">No response has cited it yet.</p>}
        <ul className="space-y-2">
          {detail.used.map((u) => (
            <li key={u.questionId} className="text-xs text-ink-600">
              <span className="font-bold text-ink-800">{u.response}</span>: “{u.question}”, {describeUse(u)}.
            </li>
          ))}
        </ul>
        {detail.usedCount > detail.used.length && <p className="text-xs text-ink-500">The latest {detail.used.length} are shown.</p>}
      </section>

      <section aria-labelledby="history" className="space-y-2">
        <h3 id="history" className="text-sm font-black text-ink-900">History</h3>
        <ol className="space-y-2">
          {history.map((h, i) => (
            <li key={i} className="text-xs text-ink-600">
              <span className="text-ink-400">{day(h.at)}</span> · {h.text}
              {'previous' in h && h.previous && (
                <span className="block mt-1 pl-3 border-l-2 border-ink-100 text-ink-500 whitespace-pre-line">Before: {h.previous.answer ?? h.previous.question}</span>
              )}
            </li>
          ))}
          {detail.replaced.map((r) => (
            <li key={r.ref} className="text-xs text-ink-600">Replaced <button className="font-bold underline" onClick={() => onOpen(r.ref)}>{r.ref}</button> (“{r.question}”)</li>
          ))}
        </ol>
      </section>

      {(detail.translations.length > 0 || (e.translatedFrom?.length ?? 0) > 0) && (
        <section aria-labelledby="languages" className="space-y-2">
          <h3 id="languages" className="text-sm font-black text-ink-900">Other languages</h3>
          <ul className="space-y-1">
            {(e.translatedFrom ?? []).map((r) => (
              <li key={r} className="text-xs text-ink-600">Translated from <button className="font-bold underline" onClick={() => onOpen(r)}>{r}</button></li>
            ))}
            {detail.translations.map((t) => (
              <li key={t.ref} className="text-xs text-ink-600">
                <button className="font-bold underline" onClick={() => onOpen(t.ref)}>{t.ref}</button>, {t.language === 'ja' ? 'Japanese' : 'English'} translation{t.reviewed ? ', reviewed' : ', to check'}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
