/**
 * Sprint 17 (S17-3, K-1): the knowledge base as a page of its own, replacing the pop-up. An overview of
 * what the organisation knows, and a full-screen browse with filters and the selected answer beside the
 * list. Since Sprint 18 (S18-2, K-2) the selected answer is its whole page: history, use and actions.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { supabase } from './lib/supabase';
import LanguageLabel from './LanguageLabel';
import AddEntryForm from './knowledge/AddEntryForm';
import EntryPanel from './knowledge/EntryPanel';
import AskBox from './knowledge/AskBox';
import {
  EMPTY_FILTERS, STATE_LABEL, browse, loadBrowseEntries, loadKnowledgeOverview,
  type BrowseEntry, type BrowseFilters, type BrowseSort, type EntryState, type KnowledgeOverview, type OriginGroup,
} from './lib/knowledgeBrowse';

const ORIGIN_LABEL: Record<OriginGroup, string> = { imported: 'Imported', response: 'Learned from responses', manual: 'Added by hand' };
const SORT_LABEL: Record<BrowseSort, string> = { number: 'Number', cited: 'Most cited', review: 'Oldest review first' };
const STATES: EntryState[] = ['reviewed', 'waiting', 'translation', 'overdue', 'retired'];

interface Props {
  names: Map<string, string>;
  isAdmin: boolean;
  /** Changes when entries are added or imported elsewhere, so the page reloads. */
  version: number;
  onImport: () => void;
  onAdded: (message: string) => void;
  onIndexFailed: (message: string) => void;
  onReview: () => void;
  /** Sprint 18 (S18-2): an answer to open, from elsewhere in the app; `n` changes on every request. */
  openRef?: { ref: string; n: number } | null;
  /** Called once openRef has been opened, so a later visit opens the overview (security review, L1). */
  onOpenedRef?: () => void;
  /** After an ask, so the usage banner can refresh. */
  onAsked?: () => void;
  /** Sprint 19 (Home): open browse with these states; `n` changes on every request. */
  openStates?: { states: EntryState[]; n: number } | null;
  onOpenedStates?: () => void;
}

/** True below the width at which the filters, the list and the answer fit side by side. */
function useNarrow(query = '(max-width: 1040px)'): boolean {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

export default function KnowledgePage({ names, isAdmin, version, onImport, onAdded, onIndexFailed, onReview, openRef = null, onOpenedRef, onAsked, openStates = null, onOpenedStates }: Props) {
  const [view, setView] = useState<'overview' | 'browse'>('overview');
  const [overview, setOverview] = useState<KnowledgeOverview | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<BrowseFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Only the newest load may set the page, so an older one arriving last cannot overwrite it
  // (security review, Sprint 17, L2; the same guard as the response screen's).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError('');
    try {
      const [o, e] = await Promise.all([loadKnowledgeOverview(supabase), loadBrowseEntries(supabase)]);
      if (seq !== loadSeq.current) return;
      setOverview(o);
      setEntries(e);
    } catch (err) {
      if (seq === loadSeq.current) setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load, version]);

  const results = useMemo(() => browse(entries, overview?.entries ?? {}, filters), [entries, overview, filters]);
  // The answer shown beside the list: the one chosen (which may be outside the filters, such as a
  // replaced entry or a proposal opened from another answer), else the first result.
  const shownRef = selected ?? results[0]?.ref ?? null;
  const current = results.find((e) => e.ref === shownRef) ?? null;
  const openBrowse = (f: Partial<BrowseFilters>) => { setFilters({ ...EMPTY_FILTERS, ...f }); setSelected(null); setAnswerOnly(false); setView('browse'); };
  // Sprint 18 (S18-2): on a narrow screen the answer's page replaces the list, with Back to the list
  // (Rory's check, Sprint 17 case 5.6: below the list it was out of sight). Wide screens show both.
  const listRef = useRef<HTMLElement>(null);
  const answerRef = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const [answerOnly, setAnswerOnly] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const pick = (ref: string) => { setSelected(ref); setAnswerOnly(true); };
  useEffect(() => {
    if (!(narrow && answerOnly)) return;
    window.scrollTo({ top: 0 });
    answerRef.current?.focus({ preventScroll: true });
  }, [narrow, answerOnly, shownRef]);
  useEffect(() => {
    if (answerOnly || !returnTo) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-ref="${returnTo}"]`);
    item?.scrollIntoView({ block: 'center' });
    item?.focus({ preventScroll: true });
    setReturnTo(null);
  }, [answerOnly, returnTo]);
  const backToList = () => { setReturnTo(shownRef); setAnswerOnly(false); };
  const hideList = narrow && answerOnly;
  const hideAnswer = narrow && !answerOnly;
  useEffect(() => {
    if (!openRef) return;
    setFilters(EMPTY_FILTERS);
    setView('browse');
    pick(openRef.ref);
    onOpenedRef?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRef?.n]);
  const questionOf = useMemo(() => new Map(entries.map((e) => [e.ref, e.question])), [entries]);
  const askBox = <AskBox questionOf={(r) => questionOf.get(r)} onOpen={(r) => { setView('browse'); pick(r); }} onAsked={onAsked} />;
  useEffect(() => {
    if (openStates) { openBrowse({ states: openStates.states }); onOpenedStates?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStates?.n]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const header = (
    <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
      <div className="max-w-2xl">
        {view === 'browse' && (
          <p className="text-xs font-semibold text-ink-500 mb-2">
            <button onClick={() => setView('overview')} className="hover:text-ink-800">Knowledge</button> / All answers{shownRef ? ` / ${shownRef}` : ''}
          </p>
        )}
        <h1 className="text-3xl font-black text-ink-900 tracking-tight">{view === 'overview' ? 'What we know' : 'All answers'}</h1>
        {view === 'overview' && overview && (
          <p className="text-ink-500 mt-1.5 text-sm font-medium">
            {overview.total} answers, {overview.languages.en} in English and {overview.languages.ja} in Japanese, added by {overview.contributors} {overview.contributors === 1 ? 'person' : 'people'}.
            Every one says where it came from. Recording a response's export can add its approved answers.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
        {view === 'overview' && <button onClick={() => openBrowse({})} className="btn-ghost text-sm"><Search size={15} /> Browse all answers</button>}
        <button onClick={() => setAdding(true)} className="btn-ghost text-sm"><Plus size={15} /> Add an answer</button>
        <button onClick={onImport} className="btn-primary text-sm"><Upload size={15} /> Import a spreadsheet</button>
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      {header}
      {error && (
        <div role="alert" className="text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium flex flex-wrap items-center gap-3">
          {error} <button onClick={load} className="btn-ghost text-xs">Try again</button>
        </div>
      )}
      {adding && (
        <AddEntryForm onCancel={() => setAdding(false)} onIndexFailed={onIndexFailed}
          onDone={(m) => { setAdding(false); onAdded(m); load(); }} />
      )}

      {view === 'overview' && overview && (
        <>
          <section aria-label="Health" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ['reviewed', overview.states.reviewed, 'reviewed and current'],
              ['waiting', overview.states.waiting, 'waiting for an admin’s review'],
              ['translation', overview.states.translations, 'machine translations to check'],
              ['overdue', overview.states.overdue, 'overdue for review'],
            ] as [EntryState, number, string][]).map(([state, n, text]) => (
              <button key={state} onClick={() => openBrowse({ states: [state] })}
                className="p-5 rounded-2xl border border-ink-100 text-left bg-white shadow-card hover:shadow-card-hover transition-all">
                <p className={`text-3xl font-black leading-none ${state !== 'reviewed' && n > 0 ? 'text-coral-600' : 'text-ink-900'}`}>{n}</p>
                <p className="text-sm text-ink-600 font-medium mt-2">{text}</p>
              </button>
            ))}
          </section>
          {overview.states.proposals > 0 && (
            <p className="text-sm text-ink-600">
              {overview.states.proposals === 1 ? '1 proposed change to an existing answer is' : `${overview.states.proposals} proposed changes to existing answers are`} waiting for review too; until then the answers they would change stay as they are.
            </p>
          )}
          {isAdmin && (overview.states.waiting + overview.states.translations + overview.states.overdue + overview.states.proposals > 0) && (
            <p className="text-sm text-ink-600">
              Review them one at a time on each answer's page, or as a queue under Governance. <button onClick={onReview} className="font-bold underline decoration-ink-300 hover:decoration-ink-700">Review entries</button>
            </p>
          )}
          {askBox}

          <div className="flex flex-wrap gap-6 items-start">
            <section aria-labelledby="topics" className="card p-6 space-y-4 flex-[999_1_520px] min-w-0">
              <h2 id="topics" className="text-lg font-black text-ink-900">By topic</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {overview.topics.slice(0, 12).map((t) => (
                  <button key={t.tag ?? '(none)'} onClick={() => openBrowse({ topic: t.tag ?? '' })}
                    className="text-left border border-ink-100 rounded-2xl px-4 py-3 hover:border-ink-300 transition-colors">
                    <span className="block font-bold text-ink-800">{t.tag ?? 'No topic'}</span>
                    <span className="block text-xs text-ink-500 mt-0.5">{t.entries} {t.entries === 1 ? 'answer' : 'answers'} · cited {t.citations} {t.citations === 1 ? 'time' : 'times'}</span>
                  </button>
                ))}
              </div>
              {overview.topics.length > 12 && <p className="text-xs text-ink-500">The 12 largest topics are shown; browse to see the rest.</p>}
            </section>

            <section aria-labelledby="learned" className="card p-6 space-y-3 flex-[1_1_320px] min-w-0">
              <h2 id="learned" className="text-lg font-black text-ink-900">Learned recently</h2>
              {overview.learned.length === 0 && <p className="text-sm text-ink-500">Nothing learned from responses yet. Answers are learned when a response's export is recorded.</p>}
              {overview.learned.map((l) => (
                <button key={l.ref} onClick={() => { openBrowse({}); pick(l.replaces ?? l.ref); }}
                  className="block w-full text-left border-b border-ink-50 last:border-0 pb-3">
                  <span className="block text-sm font-bold text-ink-800">{l.question}</span>
                  <span className="block text-xs text-ink-500 mt-0.5">{l.ref}{l.replaces ? `, a proposed change to ${l.replaces}` : ''}{l.from ? ` · from ${l.from}` : ''} · {l.reviewed ? 'reviewed' : 'waiting for review'}</span>
                </button>
              ))}
            </section>
          </div>
        </>
      )}

      {view === 'browse' && (
        <div className="space-y-5">
          {!hideList && askBox}
          <label className={`block ${hideList ? 'hidden' : ''}`}>
            <span className="text-sm font-bold text-ink-700">Search by number or words</span>
            <span className="relative block mt-1">
              <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
              <input type="search" className="input pl-11 py-3 text-base" placeholder="KB-0101, encryption, 暗号化" value={filters.query}
                onChange={(e) => { setFilters((f) => ({ ...f, query: e.target.value })); setSelected(null); }} />
            </span>
          </label>

          <div className="flex flex-wrap gap-6 items-start">
            <aside aria-label="Filters" className={`flex-[1_1_200px] max-w-xs space-y-5 ${hideList ? 'hidden' : ''}`}>
              <fieldset className="space-y-2">
                <legend className="section-label mb-2">State</legend>
                {STATES.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" className="w-4 h-4" checked={filters.states.includes(s)} onChange={() => setFilters((f) => ({ ...f, states: toggle(f.states, s) }))} />
                    {STATE_LABEL[s]} ({overview?.states[s === 'translation' ? 'translations' : s] ?? 0})
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="section-label mb-2">Language</legend>
                {(['en', 'ja'] as const).map((l) => (
                  <label key={l} className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" className="w-4 h-4" checked={filters.languages.includes(l)} onChange={() => setFilters((f) => ({ ...f, languages: toggle(f.languages, l) }))} />
                    {l === 'en' ? 'English' : 'Japanese'} ({overview?.languages[l] ?? 0})
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="section-label mb-2">Came from</legend>
                {(['imported', 'response', 'manual'] as OriginGroup[]).map((o) => (
                  <label key={o} className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="checkbox" className="w-4 h-4" checked={filters.origins.includes(o)} onChange={() => setFilters((f) => ({ ...f, origins: toggle(f.origins, o) }))} />
                    {ORIGIN_LABEL[o]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-2">
                <legend className="section-label mb-2">Sort</legend>
                {(['number', 'cited', 'review'] as BrowseSort[]).map((s) => (
                  <label key={s} className="flex items-center gap-2 text-sm text-ink-700">
                    <input type="radio" name="kb-sort" className="w-4 h-4" checked={filters.sort === s} onChange={() => setFilters((f) => ({ ...f, sort: s }))} />
                    {SORT_LABEL[s]}
                  </label>
                ))}
              </fieldset>
              {filters.topic !== null && (
                <p className="text-sm text-ink-600">Topic: <strong>{filters.topic || 'No topic'}</strong> <button onClick={() => setFilters((f) => ({ ...f, topic: null }))} className="underline">clear</button></p>
              )}
            </aside>

            <section ref={listRef} aria-label="Answers" className={`flex-[999_1_360px] min-w-0 space-y-2 ${hideList ? 'hidden' : ''}`}>
              <p className="text-sm text-ink-500" role="status">{filters.states.includes('retired') ? `${results.length} shown; ${overview?.states.retired ?? 0} retired` : `${results.length} of ${overview?.total ?? entries.length} answers`}</p>
              {results.length === 0 && <p className="text-sm text-ink-400 py-8 text-center">No answers match. Clear a filter or change the search.</p>}
              {results.slice(0, 200).map((e) => {
                const info = overview?.entries[e.ref];
                return (
                  <button key={e.ref} data-ref={e.ref} onClick={() => pick(e.ref)} aria-pressed={current?.ref === e.ref}
                    className={`w-full text-left bg-white rounded-2xl border px-4 py-3 transition-colors ${current?.ref === e.ref ? 'border-ink-900' : 'border-ink-100 hover:border-ink-300'}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-ink-500">{e.ref}</span>
                      <span className="font-bold text-sm text-ink-800 flex-1 min-w-[12rem]">{e.question}</span>
                      {e.language === 'ja' && <LanguageLabel language="ja" />}
                    </span>
                    <span className="block text-xs text-ink-500 mt-1">{info ? STATE_LABEL[info.state] : STATE_LABEL.waiting} · cited {info?.citations ?? 0} {info?.citations === 1 ? 'time' : 'times'}</span>
                  </button>
                );
              })}
              {results.length > 200 && <p className="text-xs text-ink-500">The first 200 are shown; narrow the search to see the rest.</p>}
            </section>

            {shownRef && !hideAnswer && (
              <aside ref={answerRef} tabIndex={-1} aria-label="Selected answer"
                className={`flex-[1_1_360px] max-w-lg card p-6 border-2 border-ink-900 scroll-mt-24 outline-none ${narrow ? 'flex-1 max-w-none' : 'self-start sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto'}`}>
                <EntryPanel refId={shownRef} names={names} isAdmin={isAdmin} onOpen={(r) => pick(r)}
                  onChanged={(m) => { onAdded(m); load(); }} backToList={narrow ? backToList : null} />
              </aside>
            )}
          </div>
        </div>
      )}

      {!overview && !error && <p className="text-sm text-ink-400" role="status">Loading the knowledge base…</p>}
    </div>
  );
}
