/**
 * RFIWorkspace: the end-to-end workflow for one response.
 *
 * Since Sprint 24 (S24-1, U-11) the page holds every file of the response at once: one list of their
 * questions (filtered by file if wished), bulk approval across them all, and one Mark as sent for the
 * whole response once every question in every file is decided (Rory, Q1 and Q3). Downloads stay one
 * per file (Q2), and no file is added once the response is sent (Q4).
 *
 * Steps: upload, column mapping, processing (server-side from Sprint 2), review, export.
 * Each step is its own component in ./workspace (F-5); this file holds the state that
 * crosses steps and the review list.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, Search, X } from 'lucide-react';
import { parseSpreadsheet, SpreadsheetError, type Row } from './lib/spreadsheet';
import { readWordDocument, WordDocumentError } from './lib/wordDocument';
import { extractFromWord } from './lib/wordExtraction';
import { describeExtraction, fromExtraction, toInsertRows, type Draft } from './lib/questionDrafts';
import PreviewStep from './workspace/PreviewStep';
import { detectQuestionColumn } from './lib/drafting';
import { firstView, loadResponseSession, loadResponseSessions } from './workspace/openResponse';
import { exportReason, workspaceControls } from './workspace/controls';
import { bulkAcceptResponse, describeBulk, exportNotice, insertQuestions, loadResponseExportState, processInBatches, saveQuestionPatch, type ExportState } from './lib/sessions';
import { indexNewEntries } from './lib/knowledgeBase';
import { describeLearning, learnedFrom, loadResponse, recordResponseExport, sendPreview } from './lib/responses';
import { answerSource } from './lib/answerLabel';
import { supabase } from './lib/supabase';
import type { Opportunity, RFIQuestion, RFISession, UserProfile } from './types';
import RFIQuestionCard from './RFIQuestionCard';
import BulkBar from './workspace/BulkBar';
import ExportPanel from './workspace/ExportPanel';
import MappingStep from './workspace/MappingStep';
import ProcessingStep from './workspace/ProcessingStep';
import ResponseHeader, { type StageSummary } from './workspace/ResponseHeader';
import WithExperts from './workspace/WithExperts';
import { expertItems, groupQuestions } from './workspace/journey';
import UploadStep from './workspace/UploadStep';
import { loadQuestions } from './workspace/questionRows';
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
  // Sprint 22 (S22-1): the folded groups the person has opened.
  const [openGroups, setOpenGroups]       = useState<Set<'approved' | 'unanswered'>>(new Set());
  // The overview's row for this response, for the header (all its files).
  const [summary, setSummary]             = useState<Opportunity | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);
  const [search, setSearch]               = useState('');
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  // The file being added or drafted, and the newest file once the response is open; the list is every file's.
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [pastSessions, setPastSessions]   = useState<RFISession[]>([]);
  // Sprint 24 (S24-1, Q1): the list shows every file's questions, or one file's when chosen.
  const [fileFilter, setFileFilter]       = useState<string | null>(null);
  const [learning, setLearning]           = useState('');
  const [uploadError, setUploadError]     = useState('');
  const [notice, setNotice]               = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  // Sprint 11 (S11-1): the export, and whether answers changed since; since Sprint 24 the whole response's.
  const [exportState, setExportState]     = useState<ExportState>({ exportedAt: null, changedSinceExportAt: null });
  const rawRows                           = useRef<Row[]>([]);
  // Sprint 5 (S5-3): questions found in a Word document, while the person checks them.
  const [drafts, setDrafts]               = useState<Draft[]>([]);
  const [extraction, setExtraction]       = useState<{ summary: string; ruleBased: boolean }>({ summary: '', ruleBased: false });

  const fileIds = pastSessions.map((f) => f.id);
  const { assignments, handleAssign, handleUnassign, loadAssignments } = useAssignments({ sessionIds: fileIds, opportunityId, questions, currentUser, allUsers, onError: setUploadError });

  /**
   * Opens the response: every file's questions and the whole response's export (S24-1). `focusFile`
   * is the file whose name and id the page keeps as the newest (or the one a link asked for).
   * Returns false if the questions could not be read; the caller decides what to show.
   */
  const openFiles = useCallback(async (files: RFISession[], focusFile: RFISession, given?: number): Promise<boolean> => {
    // Opened by hand (no sequence given), it is the newest load: an earlier one finishing late is ignored (security review, M3).
    const seq = given ?? ++loadSeq.current;
    let loaded: RFIQuestion[];
    try {
      loaded = await loadQuestions(supabase, files.map((f) => f.id));
    } catch (err) {
      // On the automatic path the caller shows its own error (security review, L6).
      if (seq === loadSeq.current && given === undefined) setUploadError((err as Error).message);
      return false;
    }
    const exported = await loadResponseExportState(supabase, opportunityId);
    if (seq !== loadSeq.current) return true;
    const sent = Boolean(exported.exportedAt) && !exported.changedSinceExportAt;
    setUploadError('');
    setPastSessions(files);
    setQuestions(loaded);
    setFileName(focusFile.fileName);
    setSessionId(focusFile.id);
    setExportState(exported);
    setStep(sent ? 'export' : 'review');
    setLearning('');
    setListCollapsed(sent);
    setSearch(''); setExpandedId(null); setNotice(''); setOpenGroups(new Set()); setFileFilter(null);
    return true;
  }, [opportunityId]);

  /** Reads the response's files, questions and export again, keeping what the person is looking at. */
  const reloadAll = useCallback(async () => {
    const { linked } = await loadResponseSessions(supabase, opportunityId);
    setPastSessions(linked);
    setQuestions(await loadQuestions(supabase, linked.map((f) => f.id)));
    setExportState(await loadResponseExportState(supabase, opportunityId));
    return linked;
  }, [opportunityId]);

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
      const files = linked.includes(view.open) ? linked : [view.open, ...linked];
      if (!(await openFiles(files, view.open, seq)) && seq === loadSeq.current) {
        setLoadError('The questions in this response could not be loaded. Check your connection and try again.');
        setStep('load_error');
      }
    } catch (err) {
      if (seq !== loadSeq.current) return;
      if (autoResume) { setLoadError((err as Error).message); setStep('load_error'); }
      else setUploadError((err as Error).message);
    }
  }, [opportunityId, openFiles, focus]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPastSessions(true); }, [opportunityId]);

  // Sprint 19 (S19-2): once the focused file's questions are on screen, open the question and go to it.
  const [pendingFocus, setPendingFocus] = useState<{ sessionId: string; questionId: string; missing: boolean } | null>(null);
  useEffect(() => {
    if (!pendingFocus) return;
    if (!pendingFocus.missing && sessionId !== pendingFocus.sessionId) return;
    const found = !pendingFocus.missing && questions.some((q) => q.id === pendingFocus.questionId);
    if (found) {
      setSearch(''); setListCollapsed(false); setExpandedId(pendingFocus.questionId);
      setTimeout(() => document.getElementById(`question-${pendingFocus.questionId}`)?.scrollIntoView({ block: 'center' }), 100);
    } else if (sessionId) {
      setNotice(pendingFocus.missing
        ? 'That question could not be found: its file is no longer in this response.'
        : 'That question is no longer in this response; it may have been removed.');
    } else {
      return;
    }
    setPendingFocus(null);
    onFocused?.();
  }, [pendingFocus, sessionId, questions, onFocused]);

  /** Sprint 22 (S22-1): open a question where it is: its group unfolded, the card open, in view. */
  const openAt = useCallback((qId: string) => {
    setSearch(''); setListCollapsed(false); setExpandedId(qId);
    setTimeout(() => document.getElementById(`question-${qId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, []);

  // The group of the open question stays unfolded, so a card just decided stays in view (S22-1).
  useEffect(() => {
    const q = expandedId ? questions.find((x) => x.id === expandedId) : null;
    const key = q?.status === 'accepted' ? 'approved' : q?.status === 'skipped' ? 'unanswered' : null;
    if (key) setOpenGroups((g) => (g.has(key) ? g : new Set(g).add(key)));
  }, [expandedId, questions]);

  // The header's figures are the whole response's, from the database's overview: read again once
  // no decision is being saved, so they match its card on Responses (S22-1, case 1).
  // Only the latest read is shown: an earlier one that answers late (say, from before the questions
  // were added) would otherwise put old figures back (found on staging, Sprint 23: "0 of 0 decided").
  const summaryRead = useRef(0);
  const refreshSummary = useCallback(() => {
    const n = ++summaryRead.current;
    loadResponse(supabase, opportunityId)
      .then((r) => { if (n !== summaryRead.current) return; setSummary(r); setSummaryFailed(r === null); })
      .catch((err) => { if (n !== summaryRead.current) return; console.error('response overview read failed', err); setSummaryFailed(true); });
  }, [opportunityId]);

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

  /**
   * Ask the server to process these questions (each file's in turn), then show the response as saved:
   * every file, so a file just added is listed and its questions join the list (S22-1 7, S24-1).
   */
  const processAndReload = useCallback(async (work: { sid: string; ids: string[] }[]) => {
    const all = work.reduce((n, w) => n + w.ids.length, 0);
    setStep('processing');
    setProgress(0);
    setProcessMsg(`Matching, checking and drafting 0 / ${all}`);
    let before = 0;
    const failed: string[] = [];
    const reasons = new Set<string>();
    for (const w of work) {
      const r = await processInBatches(supabase, w.sid, w.ids, (done) => {
        setProcessMsg(`Matching, checking and drafting ${before + done} / ${all}`);
        setProgress(Math.round(((before + done) / all) * 100));
      });
      failed.push(...r.failed);
      r.reasons.forEach((x) => reasons.add(x));
      before += w.ids.length;
    }
    if (failed.length) setUploadError(`${failed.length} question${failed.length !== 1 ? 's' : ''} could not be processed${reasons.size ? ` (${[...reasons].join('; ')})` : ''}.`);
    try {
      await reloadAll();
    } catch (err) {
      setUploadError((err as Error).message);
    }
    setStep('review');
  }, [reloadAll]);

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
    await processAndReload([{ sid: session.id, ids }]);
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
    await processAndReload([{ sid: session.id, ids }]);
  }, [drafts, fileName, opportunityId, processAndReload]);

  // Sprint 23 (S23-1): a try's questions are drafted when it is first opened, as an upload's are
  // (once per file; Process now remains if a batch fails).
  const drafted = useRef(new Set<string>());
  useEffect(() => {
    // Only for the try's own visitor: an admin opening someone's try never spends their own quota on it (reviews).
    if (!summary?.trial || summary.ownerId !== currentUser.id || archived || step !== 'review' || !sessionId || drafted.current.has(sessionId)) return;
    const own = questions.filter((q) => q.sessionId === sessionId);
    if (own.length === 0 || own.some((q) => q.processed)) return;
    drafted.current.add(sessionId);
    processAndReload([{ sid: sessionId, ids: own.map((q) => q.id) }]);
  }, [summary?.trial, summary?.ownerId, currentUser.id, archived, step, sessionId, questions, processAndReload]);

  // ── Review actions ────────────────────────────────────────────────────────

  // Show the change at once; if saving fails, put the question back and say why (F-9).
  // Decisions being saved: downloads wait for them (security review, Sprint 21: rule 4).
  const [saving, setSaving] = useState(0);
  useEffect(() => { if (saving === 0) refreshSummary(); }, [saving, questions, exportState, refreshSummary]);
  // Leaving the page while a decision is saving would cut the save off: the browser asks first.
  useEffect(() => {
    if (!saving) return;
    const stay = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', stay);
    return () => window.removeEventListener('beforeunload', stay);
  }, [saving]);
  const updateQuestion = useCallback((id: string, patch: Partial<RFIQuestion>) => {
    let previous: RFIQuestion | undefined;
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== id) return q;
      previous = q;
      // As the database's trigger does (Sprint 11): a changed answer is considered again when the
      // response is next marked as sent, so the confirmation counts it (S21-1).
      return { ...q, ...patch, learnedAt: null };
    }));
    setSaving((n) => n + 1);
    saveQuestionPatch(supabase, id, { status: patch.status, finalAnswer: patch.finalAnswer }).then(async () => {
      // A change to a sent response reopens its export (S11-1): show the review again, with why.
      if (!exportState.exportedAt) return;
      const next = await loadResponseExportState(supabase, opportunityId);
      setExportState(next);
      if (next.changedSinceExportAt) { setStep('review'); setListCollapsed(false); }
    }).catch((err: Error & { partial?: boolean }) => {
      setUploadError(err.message);
      // Part of the change is in the database (the answer, not the decision): show what was saved.
      if (err.partial) {
        loadQuestions(supabase, fileIds).then(setQuestions).catch(() => {
          if (previous) setQuestions((prev) => prev.map((q) => (q.id === id ? previous! : q)));
        });
      } else if (previous) {
        setQuestions((prev) => prev.map((q) => (q.id === id ? previous! : q)));
      }
    }).finally(() => setSaving((n) => n - 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId, exportState.exportedAt, fileIds.join(',')]);

  // The database records the approval (S3-2); show the same record at once rather than after a reload.
  const handleAccept   = useCallback((id: string, ans: string) => updateQuestion(id, {
    status: 'accepted', finalAnswer: ans,
    approval: { by: currentUser.id, at: new Date().toISOString(), kind: 'individual', threshold: null },
  }), [updateQuestion, currentUser.id]);
  const handleSkip     = useCallback((id: string) => updateQuestion(id, { status: 'skipped', approval: null }), [updateQuestion]);
  const handleUndoSkip = useCallback((id: string) => updateQuestion(id, { status: 'pending', approval: null }), [updateQuestion]);

  // The database decides what bulk approval includes, across every file (S24-1); the screen then shows what was saved.
  const runBulkAccept = async (threshold: number) => {
    setUploadError(''); setNotice('');
    try {
      const result = await bulkAcceptResponse(supabase, opportunityId, threshold);
      setQuestions(await loadQuestions(supabase, fileIds));
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
   * Record the export (S3-2): refused by the database while anything in any file is to do, and the
   * moment the knowledge base learns from this response (S3-4). New entries are then embedded. Since
   * Sprint 24 (S24-1, Q3) it is the whole response, every file in one transaction.
   */
  const finishSession = async () => {
    setUploadError(''); setNotice('');
    try {
      // Mark as sent (S21-1): the database records it, learns and closes the assignments.
      const summary = await recordResponseExport(supabase, opportunityId);
      setLearning(describeLearning(summary));
      const files = await reloadAll();
      // The database closed the open assignments: show it (QA review, Sprint 21).
      await loadAssignments(files.map((f) => f.id));
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
  };

  const startNew = () => {
    setStep('idle'); setQuestions([]); setFileName(''); setHeaders([]);
    setQuestionCol(''); setProgress(0); setSessionId(null);
    setLearning(''); setListCollapsed(false); setNotice(''); setExportState({ exportedAt: null, changedSinceExportAt: null });
    setSearch(''); setExpandedId(null); setOpenGroups(new Set()); setFileFilter(null);
    loadPastSessions();
  };

  // BUG-31 (Sprint 10 accuracy review): a card's number is its place in its file, not in the
  // review order (which is sorted by confidence).
  const uploadOrder = new Map<string, number>();
  for (const f of new Set(questions.map((q) => q.sessionId))) {
    questions.filter((q) => q.sessionId === f).sort((x, y) => x.position - y.position).forEach((q, i) => uploadOrder.set(q.id, i));
  }
  const fileNames = new Map(pastSessions.map((f) => [f.id, f.fileName]));
  const manyFiles = new Set(questions.map((q) => q.sessionId)).size > 1 || pastSessions.length > 1;
  const visible = questions.filter((q) => {
    if (fileFilter && q.sessionId !== fileFilter) return false;
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
      onLoadSession={(f) => { openFiles(pastSessions.some((x) => x.id === f.id) ? pastSessions : [f, ...pastSessions], f); }}
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
  const groups = groupQuestions(visible);
  const allGroups = groupQuestions(questions);
  const experts = expertItems(questions, assignments);
  const expertsAnswered = experts.filter((i) => i.assignment.status === 'answered').length;
  const sentWhen = exportState.exportedAt ? new Date(exportState.exportedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const stages: StageSummary = {
    questions: allDone ? `All ${totalCount} decided` : `${allGroups.needs.length} need a person · ${allGroups.ready.length} ready to approve`,
    experts: experts.length === 0 ? 'None asked' : `${experts.length} asked${expertsAnswered ? `, ${expertsAnswered} answered` : ''}`,
    send: exportState.changedSinceExportAt ? 'Changed since sent' : exportState.exportedAt ? `Sent on ${sentWhen}` : allDone ? 'Ready to send' : 'When every question is decided',
  };
  // Approved and Not answered are folded while anything is still to do; a group opens for the
  // question open in it, and stays open (Sprint 22, S22-1).
  const folded = (key: 'approved' | 'unanswered') => !allDone && !openGroups.has(key);

  const cardFor = (q: RFIQuestion) => (
    <div key={q.id} id={`question-${q.id}`} className="scroll-mt-4">
      <RFIQuestionCard
        question={q}
        fileName={manyFiles ? fileNames.get(q.sessionId) ?? 'another file' : undefined}
        index={uploadOrder.get(q.id) ?? 0}
        isExpanded={expandedId === q.id}
        onToggleExpand={() => setExpandedId(expandedId === q.id ? null : q.id)}
        onAccept={(ans) => handleAccept(q.id, ans)}
        onSkip={() => handleSkip(q.id)}
        onUndoSkip={() => handleUndoSkip(q.id)}
        users={allUsers}
        assignments={assignments[q.id] ?? []}
        canDecide={!archived && (canAssign || (assignments[q.id] ?? []).some((a) => a.assignedTo === currentUser.id))}
        onAssign={canAssign && !archived && !summary?.trial ? handleAssign : undefined}
        onUnassign={canAssign && !archived ? handleUnassign : undefined}
      />
    </div>
  );
  const group = (key: 'needs' | 'ready' | 'approved' | 'unanswered', title: string, explain: string, list: RFIQuestion[], extra?: ReactNode) => {
    const foldable = key === 'approved' || key === 'unanswered';
    const isFolded = foldable && folded(key);
    if (list.length === 0 && !extra) return null;
    return (
      <section aria-labelledby={`group-${key}`} className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {foldable && !allDone ? (
            <h3 id={`group-${key}`} className="text-sm font-black text-ink-800">
              <button aria-expanded={!isFolded} onClick={() => setOpenGroups((g) => { const n = new Set(g); if (n.has(key)) n.delete(key); else n.add(key); return n; })}
                className="inline-flex items-center gap-1.5 hover:text-ink-600">
                <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${isFolded ? '-rotate-90' : ''}`} /> {title} ({list.length})
              </button>
            </h3>
          ) : (
            <h3 id={`group-${key}`} className="text-sm font-black text-ink-800">{title} ({list.length})</h3>
          )}
          <p className="text-xs text-ink-500">{explain}</p>
        </div>
        {extra}
        {!isFolded && list.map(cardFor)}
      </section>
    );
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <ResponseHeader
        name={opportunityName}
        response={summary}
        readFailed={summaryFailed}
        ownerName={ownerName}
        files={pastSessions}
        filter={fileFilter}
        onFilter={(id) => { setFileFilter(id); setSearch(''); setListCollapsed(false); }}
        // Q4: a sent response takes no new file; a later questionnaire is a new response.
        onAddFile={controls.upload && !exportState.exportedAt ? startNew : undefined}
        addFileNote={controls.upload && exportState.exportedAt ? 'Marked as sent, so no file can be added: a later questionnaire is a new response.' : null}
        stages={stages}
      />

      {archived && (
        <div role="status" className="flex items-center gap-2 text-sm text-ink-600 bg-ink-50 border border-ink-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> This response is archived. It is kept as a record and can no longer be changed.
        </div>
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
            (a batch failed, or the file was added by an earlier version of the app), so {unprocessed.length !== 1 ? 'they are' : 'it is'} not available for bulk approval.
          </span>
          {canAssign && !archived && (
            <button onClick={() => processAndReload([...new Set(unprocessed.map((q) => q.sessionId))].map((sid) => ({ sid, ids: unprocessed.filter((q) => q.sessionId === sid).map((q) => q.id) })))} className="btn-ghost text-xs py-1.5">
              <RefreshCw size={12} /> Process now
            </button>
          )}
        </div>
      )}

      {uploadError && (
        <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> {uploadError}
        </div>
      )}

      {/* ── Questions ─────────────────────────────────────────────────────────── */}
      <section id="stage-questions" aria-labelledby="stage-questions-heading" className="space-y-4 scroll-mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id="stage-questions-heading" className="text-lg font-black text-ink-900">Questions</h2>
          <p className="text-xs text-ink-500 flex-1 min-w-[12rem]">
            {totalCount} in this response{manyFiles ? `, across ${pastSessions.length} files` : ''}: {pendingCount} to do, {acceptedCount} approved{skippedCount ? `, ${skippedCount} not answered` : ''}.
            {fileFilter && <> Showing the {visible.length} in {fileNames.get(fileFilter) ?? 'one file'} only.</>}
          </p>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" aria-hidden="true" />
            <input type="text" aria-label="Search questions" placeholder="Search questions…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9 py-2 text-xs" />
            {search && (
              <button aria-label="Clear the search" onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {!archived && !controls.bulk && controls.bulkNote && (
          <p className="text-xs text-ink-500 font-medium">{controls.bulkNote}</p>
        )}

        {step === 'export' && (
          <button
            onClick={() => setListCollapsed((c) => !c)}
            className="flex items-center gap-2 w-full px-4 py-3 bg-white border border-ink-100 rounded-2xl text-xs font-bold text-ink-600 hover:bg-ink-50 transition-colors shadow-card"
          >
            <ChevronDown size={14} className={`transition-transform ${listCollapsed ? '' : 'rotate-180'}`} />
            {listCollapsed ? `Show ${visible.length} questions` : 'Collapse question list'}
          </button>
        )}

        {!listCollapsed && (
          <div className="space-y-6">
            {search && visible.length === 0 && <p className="text-center py-10 text-ink-400 text-sm font-medium">No question matches your search.</p>}
            {group('needs', 'Needs a person', 'Held from bulk approval. Each says why; open it to answer, approve or assign it.', groups.needs)}
            {group('ready', 'Ready to approve', 'Nothing holds these from bulk approval, the most confident first. Bulk approval checks each again when you use it.', groups.ready,
              !archived && controls.bulk && allGroups.ready.length > 0 ? (
                <BulkBar
                  canApprove={canAssign}
                  eligible={allGroups.ready.length}
                  held={allGroups.needs.length}
                  showFinish={false}
                  finishBlockedBy={null}
                  onBulk={runBulkAccept}
                />
              ) : undefined)}
            {group('approved', 'Approved', 'Decided: each with who approved it and when.', groups.approved)}
            {group('unanswered', 'Not answered', 'Left unanswered by the owner; nothing is sent for these.', groups.unanswered)}
          </div>
        )}
      </section>

      {/* ── With experts ──────────────────────────────────────────────────────── */}
      <WithExperts questions={questions} assignments={assignments} users={allUsers} onOpen={openAt} />

      {/* ── Send ───────────────────────────────────────────────────────────────── */}
      <section id="stage-send" aria-labelledby="stage-send-heading" className="space-y-3 scroll-mt-4">
        <h2 id="stage-send-heading" className="text-lg font-black text-ink-900">Send</h2>
        {/* Sprint 21 (S21-1, U-6): download once every question is decided; marking as sent is separate. */}
        {canAssign && totalCount > 0 && allDone ? (
          <ExportPanel
            files={pastSessions.map((f) => ({ id: f.id, fileName: f.fileName, questions: questions.filter((q) => q.sessionId === f.id) })).filter((f) => f.questions.length > 0)}
            acceptedCount={acceptedCount}
            skippedCount={skippedCount}
            // S24-2 (F-71): what was learned, from what the database stored when it was sent, once the page's own report is gone.
            learning={learning || (exportState.exportedAt ? describeLearning(learnedFrom(questions)) : '')}
            names={new Map(allUsers.map((u) => [u.id, u.displayName]))}
            sentAt={exportState.exportedAt}
            changed={exportState.changedSinceExportAt !== null}
            saving={saving > 0}
            preview={sendPreview(questions, questions.flatMap((q) => assignments[q.id] ?? []), answerSource)}
            trial={summary?.trial ?? false}
            onMarkSent={archived ? undefined : finishSession}
          />
        ) : (
          <p className="text-sm text-ink-500">
            {!canAssign
              ? `Only the response owner${ownerName ? `, ${ownerName},` : ''} or an admin downloads the answers and marks the response as sent.`
              : exportReason(pendingCount) ?? 'Nothing to download yet: this response has no questions.'}
          </p>
        )}
      </section>
    </div>
  );
}
