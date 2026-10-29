/**
 * RFIWorkspace: the end-to-end workflow for one response.
 *
 * Steps: upload, column mapping, processing (server-side from Sprint 2), review, export.
 * Each step is its own component in ./workspace (F-5); this file holds the state that
 * crosses steps and the review list.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, ChevronDown, RefreshCw, Search, Upload, X } from 'lucide-react';
import { parseSpreadsheet, SpreadsheetError, type Row } from './lib/spreadsheet';
import { readWordDocument, WordDocumentError } from './lib/wordDocument';
import { extractFromWord } from './lib/wordExtraction';
import { describeExtraction, fromExtraction, toInsertRows, type Draft } from './lib/questionDrafts';
import PreviewStep from './workspace/PreviewStep';
import { detectQuestionColumn } from './lib/drafting';
import { firstView, loadResponseSession, loadResponseSessions } from './workspace/openResponse';
import { CONF_GROUPS, inGroup, type ConfidenceGroup } from './workspace/confidenceBands';
import { exportReason, workspaceControls } from './workspace/controls';
import { bulkAcceptInDb, describeBulk, exportNotice, insertQuestions, loadExportState, processInBatches, saveQuestionPatch, type ExportState } from './lib/sessions';
import { indexNewEntries } from './lib/knowledgeBase';
import { describeLearning, recordExport } from './lib/responses';
import { supabase } from './lib/supabase';
import type { RFIQuestion, RFISession, UserProfile } from './types';
import RFIQuestionCard from './RFIQuestionCard';
import BulkBar from './workspace/BulkBar';
import ExportPanel from './workspace/ExportPanel';
import MappingStep from './workspace/MappingStep';
import ProcessingStep from './workspace/ProcessingStep';
import ReadyForReviewBanner from './workspace/ReadyForReviewBanner';
import UploadStep from './workspace/UploadStep';
import { bulkEligible, loadQuestions } from './workspace/questionRows';
import { useAssignments } from './workspace/useAssignments';

interface Props {
  opportunityId: string;
  /** Archived responses are read-only (Sprint 3, S3-3). */
  archived: boolean;
  opportunityName: string;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  /** Owner or admin: may assign this response's questions and approve them in bulk (decision 0003). */
  canAssign: boolean;
  /** The owner's name, for the lines that say who can do what (S17-2). */
  ownerName?: string | null;
  /** Sprint 19 (S19-2): open at this question, in its own file, rather than at the newest file. */
  focus?: { sessionId: string; questionId: string } | null;
  /** Called once the focus has been used, so a later visit opens as usual. */
  onFocused?: () => void;
}

// Sprint 16 (S16-1): 'loading' until the response's sessions are read; 'load_error' if they cannot be.
type WorkflowStep    = 'loading' | 'load_error' | 'idle' | 'mapping' | 'preview' | 'processing' | 'review' | 'export';
type FilterTab       = 'all' | 'pending' | 'accepted' | 'skipped';
// Sprint 17 (S17-1): the glossary's words for the stored statuses.
const FILTER_LABEL: Record<FilterTab, string> = { all: 'All', pending: 'To do', accepted: 'Approved', skipped: 'Not answered' };



export default function RFIWorkspace({ opportunityId, archived, opportunityName, ownerName = null, currentUser, allUsers, canAssign, focus = null, onFocused }: Props) {
  // Sprint 17 (S17-2): what this person is offered, and why when it is less.
  const controls = workspaceControls({ canManage: canAssign, archived, ownerName });
  const [step, setStep]                   = useState<WorkflowStep>('loading');
  const [loadError, setLoadError]         = useState('');
  // The latest load; an older one that finishes late is ignored.
  const loadSeq = useRef(0);
  const loadMessage = useRef<HTMLParagraphElement>(null);
  // Keeps focus on the message when Try again replaces the button (security review, L7).
  useEffect(() => { if ((step === 'loading' || step === 'load_error') && document.activeElement === document.body) loadMessage.current?.focus(); }, [step]);
  const [fileName, setFileName]           = useState('');
  const [headers, setHeaders]             = useState<string[]>([]);
  const [questionCol, setQuestionCol]     = useState('');
  const [questions, setQuestions]         = useState<RFIQuestion[]>([]);
  const [progress, setProgress]           = useState(0);
  const [processMsg, setProcessMsg]       = useState('');
  const [filter, setFilter]               = useState<FilterTab>('all');
  const [confGroup, setConfGroup]         = useState<ConfidenceGroup>('all');
  const [search, setSearch]               = useState('');
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [pastSessions, setPastSessions]   = useState<RFISession[]>([]);
  const [learning, setLearning]           = useState('');
  const [uploadError, setUploadError]     = useState('');
  const [notice, setNotice]               = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  // Sprint 11 (S11-1): the open session's export, and whether answers changed since.
  const [exportState, setExportState]     = useState<ExportState>({ exportedAt: null, changedSinceExportAt: null });
  const rawRows                           = useRef<Row[]>([]);
  // Sprint 5 (S5-3): questions found in a Word document, while the person checks them.
  const [drafts, setDrafts]               = useState<Draft[]>([]);
  const [extraction, setExtraction]       = useState<{ summary: string; ruleBased: boolean }>({ summary: '', ruleBased: false });

  const { assignments, handleAssign, handleUnassign } = useAssignments({ sessionId, opportunityId, questions, currentUser, allUsers, onError: setUploadError });

  /** Returns false if the questions could not be read; the caller decides what to show. */
  const openSession = useCallback(async (session: RFISession, given?: number): Promise<boolean> => {
    // Opened by hand (no sequence given), it is the newest load: an earlier one finishing late is ignored (security review, M3).
    const seq = given ?? ++loadSeq.current;
    let loaded: RFIQuestion[];
    try {
      loaded = await loadQuestions(supabase, session.id);
    } catch (err) {
      // On the automatic path the caller shows its own error (security review, L6).
      if (seq === loadSeq.current && given === undefined) setUploadError((err as Error).message);
      return false;
    }
    const exported = await loadExportState(supabase, session.id);
    if (seq !== loadSeq.current) return true;
    setUploadError('');
    setQuestions(loaded);
    setFileName(session.fileName);
    setSessionId(session.id);
    setExportState(exported);
    setStep(session.status === 'completed' ? 'export' : 'review');
    setLearning('');
    setListCollapsed(session.status === 'completed');
    setFilter('all'); setSearch(''); setExpandedId(null); setNotice('');
    return true;
  }, []);

  const loadPastSessions = useCallback(async (autoResume = false) => {
    const seq = ++loadSeq.current;
    if (autoResume) { setStep('loading'); setLoadError(''); }
    try {
      const { linked } = await loadResponseSessions(supabase, opportunityId);
      if (seq !== loadSeq.current) return;
      setPastSessions(linked);
      if (!autoResume) return;
      let wanted = focus ? linked.find((x) => x.id === focus.sessionId) ?? null : null;
      // A file older than the ten read first is read on its own.
      if (focus && !wanted) wanted = await loadResponseSession(supabase, opportunityId, focus.sessionId);
      if (seq !== loadSeq.current) return;
      const view = firstView(wanted && !linked.includes(wanted) ? [wanted, ...linked] : linked, focus?.sessionId ?? null);
      if (view === 'upload') { setStep('idle'); return; }
      if (focus) setPendingFocus({ ...focus, missing: view.missing === true });
      if (!(await openSession(view.open, seq)) && seq === loadSeq.current) {
        setLoadError('The questions in this response could not be loaded. Check your connection and try again.');
        setStep('load_error');
      }
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (autoResume) { setLoadError((err as Error).message); setStep('load_error'); }
      else setUploadError((err as Error).message);
    }
  }, [opportunityId, openSession, focus]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPastSessions(true); }, [opportunityId]);

  // Sprint 19 (S19-2): once the focused file's questions are on screen, open the question and go to it.
  const [pendingFocus, setPendingFocus] = useState<{ sessionId: string; questionId: string; missing: boolean } | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    if (!pendingFocus.missing && sessionId !== pendingFocus.sessionId) return;
    const found = !pendingFocus.missing && questions.some((q) => q.id === pendingFocus.questionId);
    if (found) {
      setFilter('all'); setSearch(''); setListCollapsed(false); setExpandedId(pendingFocus.questionId);
      setTimeout(() => document.getElementById(`question-${pendingFocus.questionId}`)?.scrollIntoView({ block: 'center' }), 100);
    } else if (sessionId) {
      setNotice(pendingFocus.missing
        ? 'That question could not be found: its file is no longer in this response. The newest file is shown.'
        : 'That question is no longer in this file; it may have been removed.');
    } else {
      return;
    }
    setPendingFocus(null);
    onFocused?.();
  }, [pendingFocus, sessionId, questions, onFocused]);

  // ── File parsing ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setUploadError('');
    if (/\.(docx|docm|doc)$/i.test(file.name)) {
      // Word: read in the browser, find the questions on the server, then let the person check them.
      try {
        const { blocks } = await readWordDocument(file);
        setFileName(file.name);
        setStep('processing');
        setProgress(30);
        setProcessMsg('Finding the questions in the document');
        const result = await extractFromWord(supabase, blocks);
        setDrafts(fromExtraction(result));
        setExtraction({ summary: describeExtraction(result), ruleBased: result.method === 'rules' });
        setStep('preview');
      } catch (err) {
        setStep('idle');
        setUploadError(err instanceof WordDocumentError || err instanceof Error ? err.message : 'The file could not be read.');
      }
      return;
    }
    try {
      const { headers: hdrs, rows } = await parseSpreadsheet(file);
      rawRows.current = rows;
      setFileName(file.name);
      setHeaders(hdrs);
      setQuestionCol(detectQuestionColumn(hdrs));
      setStep('mapping');
    } catch (err) {
      setUploadError(err instanceof SpreadsheetError ? err.message : 'The file could not be read.');
    }
  }, []);

  // ── Processing (server-side, S2-2a) ──────────────────────────────────────

  /** Ask the server to process these questions, then show the session as saved. */
  const processAndReload = useCallback(async (sid: string, ids: string[]) => {
    setStep('processing');
    setProgress(0);
    setProcessMsg(`Matching, checking and drafting 0 / ${ids.length}`);
    const { failed, reasons } = await processInBatches(supabase, sid, ids, (done, total) => {
      setProcessMsg(`Matching, checking and drafting ${done} / ${total}`);
      setProgress(Math.round((done / total) * 100));
    });
    if (failed.length) setUploadError(`${failed.length} question${failed.length !== 1 ? 's' : ''} could not be processed${reasons.length ? ` (${reasons.join('; ')})` : ''}.`);
    try {
      setQuestions(await loadQuestions(supabase, sid));
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setStep('review');
  }, []);

  const runProcessing = useCallback(async () => {
    if (!questionCol) return;
    setUploadError(''); setNotice('');
    const asked = rawRows.current
      .map((r, position) => ({ question: String(r[questionCol] ?? '').trim(), position }))
      .filter((x) => x.question);
    const { data: session, error } = await supabase
      .from('rfi_sessions')
      .insert({ file_name: fileName, question_count: asked.length, opportunity_id: opportunityId })
      .select().maybeSingle();
    if (error || !session) {
      setUploadError(`The file could not be added: ${error?.message ?? 'no response'}`);
      return;
    }
    setSessionId(session.id);
    let ids: string[];
    try {
      ids = await insertQuestions(supabase, session.id, asked);
    } catch (err) {
      setUploadError((err as Error).message);
      return;
    }
    await processAndReload(session.id, ids);
  }, [questionCol, fileName, opportunityId, processAndReload]);

  /** S5-3: save the checked list from a Word document, then process it like a spreadsheet's. */
  const saveDrafts = useCallback(async () => {
    setUploadError(''); setNotice('');
    const rows = toInsertRows(drafts);
    const { data: session, error } = await supabase
      .from('rfi_sessions')
      .insert({ file_name: fileName, question_count: rows.length, opportunity_id: opportunityId })
      .select().maybeSingle();
    if (error || !session) {
      setUploadError(`The file could not be added: ${error?.message ?? 'no response'}`);
      return;
    }
    setSessionId(session.id);
    let ids: string[];
    try {
      ids = await insertQuestions(supabase, session.id, rows);
    } catch (err) {
      setUploadError((err as Error).message);
      return;
    }
    setDrafts([]);
    await processAndReload(session.id, ids);
  }, [drafts, fileName, opportunityId, processAndReload]);

  // ── Review actions ────────────────────────────────────────────────────────

  // Show the change at once; if saving fails, put the question back and say why (F-9).
  const updateQuestion = useCallback((id: string, patch: Partial<RFIQuestion>) => {
    let previous: RFIQuestion | undefined;
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== id) return q;
      previous = q;
      return { ...q, ...patch };
    }));
    saveQuestionPatch(supabase, id, { status: patch.status, finalAnswer: patch.finalAnswer }).then(async () => {
      // A change to an exported session reopens its export (S11-1): show the review again, with why.
      if (!sessionId || !exportState.exportedAt) return;
      const next = await loadExportState(supabase, sessionId);
      setExportState(next);
      if (next.changedSinceExportAt) { setStep('review'); setListCollapsed(false); }
    }).catch((err: Error & { partial?: boolean }) => {
      setUploadError(err.message);
      // Part of the change is in the database (the answer, not the decision): show what was saved.
      if (err.partial && sessionId) {
        loadQuestions(supabase, sessionId).then(setQuestions).catch(() => {
          if (previous) setQuestions((prev) => prev.map((q) => (q.id === id ? previous! : q)));
        });
      } else if (previous) {
        setQuestions((prev) => prev.map((q) => (q.id === id ? previous! : q)));
      }
    });
  }, [sessionId, exportState.exportedAt]);

  // The database records the approval (S3-2); show the same record at once rather than after a reload.
  const handleAccept   = useCallback((id: string, ans: string) => updateQuestion(id, {
    status: 'accepted', finalAnswer: ans,
    approval: { by: currentUser.id, at: new Date().toISOString(), kind: 'individual', threshold: null },
  }), [updateQuestion, currentUser.id]);
  const handleSkip     = useCallback((id: string) => updateQuestion(id, { status: 'skipped', approval: null }), [updateQuestion]);
  const handleUndoSkip = useCallback((id: string) => updateQuestion(id, { status: 'pending', approval: null }), [updateQuestion]);

  // The database decides what bulk approval includes; the screen then shows what was saved.
  const runBulkAccept = async (threshold: number) => {
    if (!sessionId) return;
    setUploadError(''); setNotice('');
    try {
      const result = await bulkAcceptInDb(supabase, sessionId, threshold);
      setQuestions(await loadQuestions(supabase, sessionId));
      setNotice(describeBulk(result, threshold));
    } catch (err) {
      setUploadError((err as Error).message);
    }
  };

  const accepted    = questions.filter((q) => q.status === 'accepted');
  const pending     = questions.filter((q) => q.status === 'pending');
  const skipped     = questions.filter((q) => q.status === 'skipped');
  // Pending questions the server has not processed (a failed batch, or a session from before Sprint 2).
  const unprocessed = questions.filter((q) => !q.processed && q.status === 'pending');

  /**
   * Record the export (S3-2): refused by the database while anything is pending, and the moment
   * the knowledge base learns from this response (S3-4). New entries are then embedded.
   */
  const finishSession = async () => {
    if (!sessionId) return;
    setUploadError(''); setNotice('');
    try {
      const summary = await recordExport(supabase, sessionId);
      setExportState(await loadExportState(supabase, sessionId));
      setLearning(describeLearning(summary));
      setQuestions(await loadQuestions(supabase, sessionId));
      if (summary.added || summary.superseded) {
        const indexed = await indexNewEntries();
        if (!indexed.ok) setNotice(`The new entries are saved but not yet indexed for meaning-based search (${indexed.reason}); they will be indexed on the next sign-in.`);
      }
    } catch (err) {
      setUploadError((err as Error).message);
      return;
    }
    setListCollapsed(true);
    setStep('export');
    loadPastSessions();
  };

  const startNew = () => {
    setStep('idle'); setQuestions([]); setFileName(''); setHeaders([]);
    setQuestionCol(''); setProgress(0); setSessionId(null);
    setLearning(''); setListCollapsed(false); setNotice(''); setExportState({ exportedAt: null, changedSinceExportAt: null });
    setFilter('all'); setConfGroup('all'); setSearch(''); setExpandedId(null);
    loadPastSessions();
  };

  // BUG-31 (Sprint 10 accuracy review): a card's number is its place in the upload, not in the
  // review order (which is sorted by confidence).
  const uploadOrder = new Map([...questions].sort((x, y) => x.position - y.position).map((q, i) => [q.id, i]));
  const visible = questions.filter((q) => {
    if (filter !== 'all' && q.status !== filter) return false;
    if (confGroup !== 'all') {
      const grp = CONF_GROUPS.find((g) => g.key === confGroup)!;
      if (!inGroup(q.confidence, grp)) return false;
    }
    if (search) {
      const s = search.toLowerCase();
      return q.question.toLowerCase().includes(s) || q.finalAnswer.toLowerCase().includes(s);
    }
    return true;
  });

  // Security review (L7): one live region that stays mounted, so the change from loading to an error is announced;
  // focus moves to the message, and the pulse respects reduced motion.
  if (step === 'loading' || step === 'load_error') return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-16 text-center" aria-live="polite">
      {step === 'loading' ? (
        <>
          <div className="w-10 h-10 mx-auto rounded-2xl bg-ink-900 motion-safe:animate-pulse" aria-hidden="true" />
          <p ref={loadMessage} tabIndex={-1} className="mt-4 text-sm font-bold text-ink-800 outline-none">Loading {opportunityName}…</p>
          <p className="text-xs text-ink-400 mt-1">Reading its questions and answers.</p>
        </>
      ) : (
        <>
          <p ref={loadMessage} tabIndex={-1} role="alert" className="text-sm font-bold text-coral-600 outline-none">{loadError}</p>
          <button onClick={() => loadPastSessions(true)} className="btn-primary text-sm mt-4">Try again</button>
        </>
      )}
    </div>
  );

  if (step === 'idle') return (
    <UploadStep
      opportunityName={opportunityName}
      error={uploadError}
      pastSessions={pastSessions}
      onFile={processFile}
      onLoadSession={openSession}
      onRefresh={() => loadPastSessions()}
      uploadNote={controls.upload ? null : controls.uploadNote}
    />
  );

  if (step === 'mapping') return (
    <MappingStep
      fileName={fileName}
      rowCount={rawRows.current.length}
      headers={headers}
      questionCol={questionCol}
      onChange={setQuestionCol}
      onBack={() => setStep('idle')}
      onRun={runProcessing}
    />
  );

  if (step === 'preview') return (
    <>
      {uploadError && <p role="alert" className="max-w-3xl mx-auto px-6 pt-6 text-sm text-coral-600">{uploadError}</p>}
      <PreviewStep
        fileName={fileName}
        summary={extraction.summary}
        ruleBased={extraction.ruleBased}
        drafts={drafts}
        onChange={setDrafts}
        onBack={() => { setStep('idle'); setDrafts([]); }}
        onSave={saveDrafts}
      />
    </>
  );
  if (step === 'processing') return <ProcessingStep message={processMsg} progress={progress} />;

  const pendingCount  = pending.length;
  const acceptedCount = accepted.length;
  const skippedCount  = skipped.length;
  const totalCount    = questions.length;
  const allDone       = pendingCount === 0;
  const assignmentsWithNotes = Object.values(assignments).flat().filter((a) => a.notes && a.notes.trim().length > 0);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      {assignmentsWithNotes.length > 0 && (
        <ReadyForReviewBanner
          items={assignmentsWithNotes}
          questions={questions}
          onFocus={(qId) => {
            setExpandedId(qId); setFilter('all'); setSearch('');
            setTimeout(() => {
              document.getElementById(`question-${qId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
          }}
        />
      )}

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 size={16} className="text-ink-400 flex-shrink-0" />
          <p className="text-sm font-bold text-ink-700 truncate max-w-xs">{fileName}</p>
          {/* F-23: start another upload for this response without finishing this one. */}
          {controls.upload ? (
            <button onClick={startNew} className="btn-ghost text-xs py-1.5 flex-shrink-0">
              <Upload size={12} /> Add a file
            </button>
          ) : pastSessions.length > 1 && (
            <button onClick={startNew} className="btn-ghost text-xs py-1.5 flex-shrink-0">
              <Upload size={12} /> Other files
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {[
            { label: `${totalCount}`, sub: 'total',    cls: 'bg-white border-ink-200 text-ink-700' },
            { label: `${acceptedCount}`, sub: 'approved', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
            { label: `${pendingCount}`, sub: 'to do',  cls: pendingCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-ink-100 text-ink-400' },
            ...(skippedCount > 0 ? [{ label: `${skippedCount}`, sub: 'not answered', cls: 'bg-white border-ink-200 text-ink-500' }] : []),
          ].map((s) => (
            <span key={s.sub} className={`inline-flex items-baseline gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold ${s.cls}`}>
              {s.label} <span className="font-medium opacity-70">{s.sub}</span>
            </span>
          ))}
        </div>
      </div>

      {archived && (
        <div role="status" className="flex items-center gap-2 text-sm text-ink-600 bg-ink-50 border border-ink-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> This response is archived. It is kept as a record and can no longer be changed.
        </div>
      )}

      {!archived && !controls.bulk && controls.bulkNote && (
        <p className="text-xs text-ink-500 font-medium px-1">{controls.bulkNote}</p>
      )}
      {!archived && controls.bulk && (
        <BulkBar
          canApprove={canAssign}
          eligible={questions.filter(bulkEligible).length}
          held={pending.filter((q) => !bulkEligible(q)).length}
          showFinish={step === 'review' && canAssign}
          finishBlockedBy={exportReason(allDone ? 0 : pendingCount)}
          onBulk={runBulkAccept}
          onFinish={finishSession}
        />
      )}

      {exportNotice(exportState, step) && (
        <div role="status" className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 font-medium border ${exportState.changedSinceExportAt ? 'text-amber-800 bg-amber-50 border-amber-200' : 'text-ink-600 bg-ink-50 border-ink-200'}`}>
          <AlertTriangle size={14} className="flex-shrink-0" /> {exportNotice(exportState, step)}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 font-medium">
          <CheckCircle2 size={14} className="flex-shrink-0" /> {notice}
        </div>
      )}
      {unprocessed.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span className="flex-1">
            {unprocessed.length} question{unprocessed.length !== 1 ? 's' : ''} to do {unprocessed.length !== 1 ? 'have' : 'has'} not been checked and drafted by the server
            (a batch failed, or the session was created by an earlier version of the app), so {unprocessed.length !== 1 ? 'they are' : 'it is'} not available for bulk approval.
          </span>
          <button onClick={() => sessionId && processAndReload(sessionId, unprocessed.map((q) => q.id))} className="btn-ghost text-xs py-1.5">
            <RefreshCw size={12} /> Process now
          </button>
        </div>
      )}

      {uploadError && (
        <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> {uploadError}
        </div>
      )}

      {/* Filter + search */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card">
            {(['all', 'pending', 'accepted', 'skipped'] as FilterTab[]).map((t) => {
              const cnt: Record<FilterTab, number> = { all: totalCount, pending: pendingCount, accepted: acceptedCount, skipped: skippedCount };
              return (
                <button key={t} onClick={() => setFilter(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                    filter === t ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
                  }`}>
                  {FILTER_LABEL[t]} <span className="opacity-60">({cnt[t]})</span>
                </button>
              );
            })}
          </div>

          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input type="text" placeholder="Search questions…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 py-2 text-xs" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>

          <span className="text-xs text-ink-400 font-bold flex-shrink-0">{visible.length}/{totalCount}</span>
        </div>

        {/* Confidence filter */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="section-label mr-1">Confidence:</span>
          <button onClick={() => setConfGroup('all')}
            className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
              confGroup === 'all' ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-500 border-ink-200 hover:border-ink-400'
            }`}>
            All <span className="opacity-60">({totalCount})</span>
          </button>
          {CONF_GROUPS.map((g) => {
            const cnt = questions.filter((q) => inGroup(q.confidence, g)).length;
            if (g.key === 'uncalibrated' && cnt === 0) return null;
            return (
              <button key={g.key} onClick={() => setConfGroup(confGroup === g.key ? 'all' : g.key)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all flex items-center gap-1.5 ${
                  confGroup === g.key ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-500 border-ink-200 hover:border-ink-400'
                }`}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${confGroup === g.key ? 'bg-white' : g.dot}`} />
                {g.label} <span className="opacity-60">({cnt})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Low confidence alert */}
      {questions.filter((q) => q.confidence !== null && q.confidence < 0.4 && q.status === 'pending').length > 0 && (
        <div className="flex items-start gap-3 p-4 bg-coral-50 border border-coral-200 rounded-2xl">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-coral-500" />
          <p className="text-sm text-coral-700 font-medium">
            <strong>{questions.filter((q) => q.confidence !== null && q.confidence < 0.4 && q.status === 'pending').length}</strong> questions have very low confidence (below 40%): the knowledge base probably does not answer them.
          </p>
        </div>
      )}

      {/* Question list */}
      <div>
        {step === 'export' && (
          <button
            onClick={() => setListCollapsed((c) => !c)}
            className="flex items-center gap-2 w-full px-4 py-3 bg-white border border-ink-100 rounded-2xl text-xs font-bold text-ink-600 hover:bg-ink-50 transition-colors mb-3 shadow-card"
          >
            <ChevronDown size={14} className={`transition-transform ${listCollapsed ? '' : 'rotate-180'}`} />
            {listCollapsed ? `Show ${visible.length} questions` : 'Collapse question list'}
          </button>
        )}

        {!listCollapsed && (
          <div className="space-y-2">
            {visible.length === 0 ? (
              <div className="text-center py-14 text-ink-400 text-sm font-medium">No questions match your filter.</div>
            ) : visible.map((q) => (
              <div key={q.id} id={`question-${q.id}`}>
                <RFIQuestionCard
                  question={q}
                  index={uploadOrder.get(q.id) ?? 0}
                  isExpanded={expandedId === q.id}
                  onToggleExpand={() => setExpandedId(expandedId === q.id ? null : q.id)}
                  onAccept={(ans) => handleAccept(q.id, ans)}
                  onSkip={() => handleSkip(q.id)}
                  onUndoSkip={() => handleUndoSkip(q.id)}
                  users={allUsers}
                  assignments={assignments[q.id] ?? []}
                  canDecide={!archived && (canAssign || (assignments[q.id] ?? []).some((a) => a.assignedTo === currentUser.id))}
                  onAssign={canAssign && !archived ? handleAssign : undefined}
                  onUnassign={canAssign && !archived ? handleUnassign : undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {step === 'export' && (
        <ExportPanel
          questions={questions}
          fileName={fileName}
          acceptedCount={acceptedCount}
          skippedCount={skippedCount}
          learning={learning}
          names={new Map(allUsers.map((u) => [u.id, u.displayName]))}
          onStartNew={archived ? undefined : startNew}
        />
      )}
    </div>
  );
}
