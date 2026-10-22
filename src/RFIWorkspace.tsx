/**
 * RFIWorkspace — primary end-to-end workflow.
 *
 * Steps:
 *   1. idle       — upload dropzone, recent sessions
 *   2. mapping    — column picker after file parse
 *   3. processing — running KB lookups, progress bar
 *   4. review     — question-by-question review
 *   5. export     — download results, add to KB
 */

import { useState, useRef, useCallback, useEffect, DragEvent, ChangeEvent } from 'react';
import { parseSpreadsheet, SpreadsheetError, type Row } from './lib/spreadsheet';
import {
  Upload, FileSpreadsheet, ChevronDown, Sparkles, Loader2,
  CheckCircle2, BarChart3, Download, Plus,
  FileDown, FileText, Sheet, RefreshCw, Clock, AlertTriangle,
  Search, X, MessageSquare, ChevronUp, User, ArrowRight,
} from 'lucide-react';
import { KnowledgeEntry, RFIQuestion, RFISession, RFIStatus, UserProfile, QuestionAssignment } from './types';
import { draftAnswer, detectQuestionColumn, NO_CONFIDENT_MATCH_TEXT } from './lib/drafting';
import { embedQuestions, matchQuestion, selectDraftSources } from './lib/retrievalClient';
import { calibratedConfidence, NO_MATCH_FLOOR } from './lib/calibration';
import { CALIBRATION_TABLES } from './lib/calibrationTables';
import { bulkAcceptInDb, saveQuestionPatch, insertQuestions } from './lib/sessions';
import { supabase } from './lib/supabase';
import { exportCSV, exportExcel, exportWord } from './exportUtils';
import RFIQuestionCard from './RFIQuestionCard';

// ─── Ready-for-review banner ──────────────────────────────────────────────────

function ReadyForReviewBanner({
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
            {items.length} response{items.length !== 1 ? 's' : ''} ready for review
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

// ─── Session row ─────────────────────────────────────────────────────────────

function SessionRow({ session: s, onLoad }: { session: RFISession; onLoad: (s: RFISession) => void }) {
  return (
    <div className="flex items-center gap-4 p-4 bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover transition-all">
      <div className="w-10 h-10 rounded-xl bg-ink-50 flex items-center justify-center flex-shrink-0">
        <FileSpreadsheet size={18} className="text-ink-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-ink-800 truncate">{s.fileName}</p>
        <p className="text-xs text-ink-400 font-medium">
          {new Date(s.createdAt).toLocaleDateString()} · {s.questionCount} questions
          {s.status === 'completed' && ` · ${s.acceptedCount} accepted`}
        </p>
      </div>
      <span className={`status-pill flex-shrink-0 ${
        s.status === 'completed'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}>
        {s.status === 'completed' ? 'Done' : 'In progress'}
      </span>
      <button onClick={() => onLoad(s)} className="btn-ghost text-xs py-2 flex-shrink-0">
        {s.status === 'completed' ? 'View' : 'Resume'} <ArrowRight size={12} />
      </button>
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────

function ColSelect({ label, value, options, onChange, required }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">
        {label}{required && <span className="text-coral-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="input appearance-none pr-9">
          <option value="">— not mapped —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onAddToKB: (entries: Omit<KnowledgeEntry, 'id'>[], origin: 'response', originRef: string) => Promise<boolean>;
  opportunityId: string;
  opportunityName: string;
  currentUser: UserProfile;
  allUsers: UserProfile[];
  /** Owner or admin: may assign this response's questions (decision 0003). */
  canAssign: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

type WorkflowStep    = 'idle' | 'mapping' | 'processing' | 'review' | 'export';
type FilterTab       = 'all' | 'pending' | 'accepted' | 'skipped';
type ConfidenceGroup = 'all' | 'high' | 'medium' | 'low' | 'uncalibrated';

const CONF_GROUPS: { key: ConfidenceGroup; label: string; min: number; max: number; dot: string }[] = [
  { key: 'high',   label: 'High ≥80%',    min: 0.80, max: 1.01, dot: 'bg-emerald-500' },
  { key: 'medium', label: 'Medium 40–80%', min: 0.40, max: 0.80, dot: 'bg-amber-400' },
  { key: 'low',    label: 'Low <40%',      min: 0,    max: 0.40, dot: 'bg-coral-500' },
  { key: 'uncalibrated', label: 'Not calibrated', min: NaN, max: NaN, dot: 'bg-ink-300' },
];

function inGroup(confidence: number | null, g: { key: ConfidenceGroup; min: number; max: number }): boolean {
  if (g.key === 'uncalibrated') return confidence === null;
  return confidence !== null && confidence >= g.min && confidence < g.max;
}

export default function RFIWorkspace({ onAddToKB, opportunityId, opportunityName, currentUser, allUsers, canAssign }: Props) {
  const [step, setStep]                   = useState<WorkflowStep>('idle');
  const [dragOver, setDragOver]           = useState(false);
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
  const [orphanSessions, setOrphanSessions] = useState<RFISession[]>([]);
  const [kbAdded, setKbAdded]             = useState(false);
  const [uploadError, setUploadError]     = useState('');
  const [retrievalNote, setRetrievalNote] = useState('');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [assignments, setAssignments]     = useState<Record<string, QuestionAssignment[]>>({});
  const fileInput                         = useRef<HTMLInputElement>(null);
  const rawRows                           = useRef<Row[]>([]);

  // Reload when the opportunity changes. loadPastSessions reads opportunityId from the
  // render that triggered this effect, so it is never stale. (Sprint 2 splits this component.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadPastSessions(true); }, [opportunityId]);
  useEffect(() => { if (sessionId) loadAssignments(sessionId); }, [sessionId]);

  async function loadAssignments(sid: string) {
    const { data } = await supabase
      .from('question_assignments')
      .select('*, assignedToProfile:user_profiles!question_assignments_assigned_to_fkey(id, display_name, job_title, expertise_tags, is_admin, created_at)')
      .eq('session_id', sid);
    if (data) {
      const map: Record<string, QuestionAssignment[]> = {};
      for (const r of data) {
        const a: QuestionAssignment = {
          id: r.id, questionId: r.question_id, sessionId: r.session_id,
          opportunityId: r.opportunity_id, assignedTo: r.assigned_to,
          assignedBy: r.assigned_by, questionText: r.question_text,
          answerText: r.answer_text, status: r.status, notes: r.notes,
          completedAt: r.completed_at ?? null,
          createdAt: r.created_at, updatedAt: r.updated_at,
          assignedToProfile: r.assignedToProfile ? {
            id: r.assignedToProfile.id, displayName: r.assignedToProfile.display_name,
            jobTitle: r.assignedToProfile.job_title ?? '', department: '',
            expertiseTags: r.assignedToProfile.expertise_tags ?? [],
            isAdmin: r.assignedToProfile.is_admin, createdAt: r.assignedToProfile.created_at,
          } : undefined,
        };
        if (!map[r.question_id]) map[r.question_id] = [];
        map[r.question_id].push(a);
      }
      setAssignments(map);
    }
  }

  async function handleAssign(questionId: string, userId: string) {
    const q = questions.find((q) => q.id === questionId);
    if (!q || !sessionId) return;
    const existing = assignments[questionId] ?? [];
    if (existing.some((a) => a.assignedTo === userId)) return;
    const { data } = await supabase
      .from('question_assignments')
      .insert({
        question_id: questionId, session_id: sessionId, opportunity_id: opportunityId,
        assigned_to: userId, assigned_by: currentUser.id,
        question_text: q.question, answer_text: q.finalAnswer,
      })
      .select().maybeSingle();
    if (data) {
      const profile = allUsers.find((u) => u.id === userId);
      const newA: QuestionAssignment = {
        id: data.id, questionId: data.question_id, sessionId: data.session_id,
        opportunityId: data.opportunity_id, assignedTo: data.assigned_to,
        assignedBy: data.assigned_by, questionText: data.question_text,
        answerText: data.answer_text, status: data.status, notes: data.notes,
        completedAt: data.completed_at ?? null, createdAt: data.created_at, updatedAt: data.updated_at,
        assignedToProfile: profile,
      };
      setAssignments((prev) => ({ ...prev, [questionId]: [...(prev[questionId] ?? []), newA] }));
      if (opportunityId) {
        await supabase.from('opportunity_contributors')
          .upsert({ opportunity_id: opportunityId, user_id: userId }, { onConflict: 'opportunity_id,user_id' });
      }
    }
  }

  async function handleUnassign(questionId: string, assignmentId: string) {
    await supabase.from('question_assignments').delete().eq('id', assignmentId);
    setAssignments((prev) => {
      const remaining = (prev[questionId] ?? []).filter((a) => a.id !== assignmentId);
      if (remaining.length === 0) { const next = { ...prev }; delete next[questionId]; return next; }
      return { ...prev, [questionId]: remaining };
    });
  }

  async function loadPastSessions(autoResume = false) {
    const [{ data: linked }, { data: orphans }] = await Promise.all([
      supabase.from('rfi_sessions').select('*').eq('opportunity_id', opportunityId)
        .order('created_at', { ascending: false }).limit(10),
      supabase.from('rfi_sessions').select('*').is('opportunity_id', null)
        .order('created_at', { ascending: false }).limit(10),
    ]);

    const toSession = (r: Record<string, unknown>): RFISession => ({
      id: r.id as string, opportunityId: r.opportunity_id as string | null,
      fileName: r.file_name as string,
      // The database allows only these two values; anything else is treated as unfinished.
      status: r.status === 'completed' ? 'completed' : 'in_progress',
      questionCount: r.question_count as number, acceptedCount: r.accepted_count as number,
      createdAt: r.created_at as string,
    });

    const linkedSessions = linked ? linked.map(toSession) : [];
    const orphanList = orphans ? orphans.map(toSession) : [];

    setPastSessions(linkedSessions);
    setOrphanSessions(orphanList);

    if (autoResume && linkedSessions.length > 0) {
      await loadSessionQuestions(linkedSessions[0]);
    }
  }

  async function loadSessionQuestions(session: RFISession) {
    const { data, error } = await supabase.from('rfi_questions').select('*')
      .eq('session_id', session.id).order('position', { ascending: true });
    const rows = (!error && Array.isArray(data)) ? data : [];
    const loaded: RFIQuestion[] = rows.map((r) => ({
      id: r.id, sessionId: r.session_id, position: r.position, question: r.question,
      generatedAnswer: r.generated_answer ?? '', finalAnswer: r.final_answer ?? '',
      confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence), retrievalScore: Number(r.retrieval_score ?? 0),
      sources: [], status: r.status as RFIStatus,
    }));
    setFileName(session.fileName);
    setSessionId(session.id);
    setQuestions(loaded);
    setStep(session.status === 'completed' ? 'export' : 'review');
    setKbAdded(false);
    setListCollapsed(session.status === 'completed');
    setFilter('all'); setSearch(''); setExpandedId(null);
  }

  // ── File parsing ─────────────────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    setUploadError('');
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

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  // ── Run KB lookup ─────────────────────────────────────────────────────────

  const runProcessing = useCallback(async () => {
    if (!questionCol) return;
    setStep('processing'); setProgress(0);
    const rows = rawRows.current;
    const { data: session } = await supabase
      .from('rfi_sessions')
      .insert({ file_name: fileName, status: 'in_progress', question_count: rows.length, opportunity_id: opportunityId })
      .select().maybeSingle();
    const sid = session?.id as string | undefined;
    if (sid) setSessionId(sid);

    const asked = rows
      .map((r, position) => ({ text: String(r[questionCol] ?? '').trim(), position }))
      .filter((x) => x.text);

    // 1. Embed every question in one go (server-side; the provider key never reaches the browser).
    setProcessMsg('Understanding the questions…');
    const embedded = await embedQuestions(supabase, asked.map((x) => x.text));
    setRetrievalNote(embedded.ok ? '' : `Keyword match only: ${embedded.reason}. Confidence is not calibrated.`);

    // 2. Match each question in the database, a few at a time.
    const built: RFIQuestion[] = [];
    const CONCURRENCY = 5;
    try {
      for (let i = 0; i < asked.length; i += CONCURRENCY) {
        const chunk = asked.slice(i, i + CONCURRENCY);
        const matched = await Promise.all(chunk.map((x, j) =>
          matchQuestion(supabase, x.text, embedded.ok ? embedded.vectors[i + j] : null, embedded.ok ? embedded.model : null)));
        chunk.forEach((x, j) => {
          const rows = matched[j];
          const sources = selectDraftSources(rows);
          const similarities = rows.map((r) => r.similarity).filter((v): v is number => v !== null);
          const topSimilarity = similarities.length ? Math.max(...similarities) : null;
          const confidence = calibratedConfidence(topSimilarity, embedded.ok ? embedded.model : null, CALIBRATION_TABLES);
          // Below the floor there is no confident match: a person writes the answer (S1-6).
          const generatedAnswer = confidence !== null && confidence < NO_MATCH_FLOOR ? NO_CONFIDENT_MATCH_TEXT : draftAnswer(sources);
          built.push({
            id: crypto.randomUUID(), sessionId: sid ?? '', position: x.position, question: x.text,
            generatedAnswer, finalAnswer: generatedAnswer,
            confidence,
            retrievalScore: topSimilarity ?? rows[0]?.fused_score ?? 0,
            sources, status: 'pending',
          });
        });
        setProcessMsg(`Matched ${Math.min(i + CONCURRENCY, asked.length)} / ${asked.length}…`);
        setProgress(Math.round((Math.min(i + CONCURRENCY, asked.length) / asked.length) * 100));
      }
    } catch (err) {
      setUploadError((err as Error).message);
      setStep('mapping');
      return;
    }
    // Least confident first; questions without a calibrated confidence come before all others.
    built.sort((a, b) => (a.confidence ?? -1) - (b.confidence ?? -1));
    setQuestions(built);
    setProgress(100);

    if (sid) {
      const dbRows = built.map((q) => ({
        id: q.id, session_id: sid, position: q.position, question: q.question,
        generated_answer: q.generatedAnswer, final_answer: q.finalAnswer,
        confidence: q.confidence === null ? null : Math.round(q.confidence * 1e3) / 1e3,
        retrieval_score: Math.round(q.retrievalScore * 1e6) / 1e6,
        status: q.status,
        sources_json: q.sources.map((s) => ({ id: s.entry.id, score: s.score })),
      }));
      try {
        await insertQuestions(supabase, dbRows);
      } catch (err) {
        setUploadError(`${(err as Error).message}. The drafts are shown, but reopening this session will not show all of them.`);
      }
    }
    setTimeout(() => setStep('review'), 400);
  }, [questionCol, fileName, opportunityId]);

  // ── Review actions ────────────────────────────────────────────────────────

  // Show the change at once; if saving fails, put the question back and say why (F-9).
  const updateQuestion = useCallback((id: string, patch: Partial<RFIQuestion>) => {
    let previous: RFIQuestion | undefined;
    setQuestions((prev) => prev.map((q) => {
      if (q.id !== id) return q;
      previous = q;
      return { ...q, ...patch };
    }));
    saveQuestionPatch(supabase, id, { status: patch.status, finalAnswer: patch.finalAnswer }).catch((err: Error) => {
      if (previous) setQuestions((prev) => prev.map((q) => (q.id === id ? previous! : q)));
      setUploadError(err.message);
    });
  }, []);

  const handleAccept    = useCallback((id: string, ans: string) => updateQuestion(id, { status: 'accepted', finalAnswer: ans }), [updateQuestion]);
  const handleSkip      = useCallback((id: string) => updateQuestion(id, { status: 'skipped' }), [updateQuestion]);
  const handleUndoSkip  = useCallback((id: string) => updateQuestion(id, { status: 'pending' }), [updateQuestion]);

  // Saved to the database first, then shown; previously the screen changed but nothing was saved.
  const runBulkAccept = async (minConf: number | null) => {
    if (!sessionId) return;
    try {
      await bulkAcceptInDb(supabase, sessionId, minConf);
      setQuestions((prev) => prev.map((q) =>
        q.status === 'pending' && (minConf === null || (q.confidence !== null && q.confidence >= minConf)) ? { ...q, status: 'accepted' } : q
      ));
    } catch (err) {
      setUploadError((err as Error).message);
    }
  };
  const bulkAccept = (minConf: number) => runBulkAccept(minConf);
  const bulkAcceptAll = () => runBulkAccept(null);

  // ── Export ────────────────────────────────────────────────────────────────

  const accepted = questions.filter((q) => q.status === 'accepted');
  /** Threshold bulk accept needs calibrated confidence (rule 4); "All" stays available as an explicit choice. */
  const anyCalibrated = questions.some((q) => q.confidence !== null);
  const pending  = questions.filter((q) => q.status === 'pending');
  const skipped  = questions.filter((q) => q.status === 'skipped');

  const finishSession = async () => {
    if (sessionId) {
      await supabase.from('rfi_sessions').update({ status: 'completed', accepted_count: accepted.length }).eq('id', sessionId);
    }
    setListCollapsed(true);
    setStep('export');
    loadPastSessions();
  };

  const handleAddToKB = async () => {
    const entries = accepted.map((q) => ({
      question: q.question, answer: q.finalAnswer,
      tags: q.sources.flatMap((s) => s.entry.tags).slice(0, 4),
      source: `RFI: ${fileName}`,
    }));
    // Sprint 3 replaces this button with learning at export, with full provenance.
    if (await onAddToKB(entries, 'response', fileName)) setKbAdded(true);
  };

  const startNew = () => {
    setStep('idle'); setQuestions([]); setFileName(''); setHeaders([]);
    setQuestionCol(''); setProgress(0); setSessionId(null);
    setKbAdded(false); setListCollapsed(false);
    setFilter('all'); setConfGroup('all'); setSearch(''); setExpandedId(null);
    loadPastSessions();
  };

  // ── Filtered list ─────────────────────────────────────────────────────────

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

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  // ── Step: idle ────────────────────────────────────────────────────────────
  if (step === 'idle') return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
      <div>
        <h2 className="text-3xl font-black text-ink-900 tracking-tight">New RFI Session</h2>
        <p className="text-ink-500 mt-2 text-sm font-medium max-w-lg">
          Upload questions for <strong className="text-ink-700">{opportunityName}</strong>. Each question is matched against the knowledge base and a draft is assembled from the closest answers for you to review.
        </p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInput.current?.click()}
        className={`border-2 border-dashed rounded-3xl p-14 text-center cursor-pointer transition-all duration-200 ${
          dragOver ? 'border-ink-900 bg-ink-50' : 'border-ink-200 hover:border-ink-400 hover:bg-white'
        }`}
      >
        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5 transition-colors ${dragOver ? 'bg-ink-900' : 'bg-ink-100'}`}>
          <Upload size={28} className={dragOver ? 'text-white' : 'text-ink-500'} />
        </div>
        <p className="text-lg font-black text-ink-800 mb-1">
          {dragOver ? 'Drop to upload' : 'Drag & drop your questions file'}
        </p>
        <p className="text-sm text-ink-400 font-medium">or click to browse</p>
        <div className="flex justify-center gap-2 mt-5">
          {['.csv', '.xlsx'].map((e) => (
            <span key={e} className="text-xs bg-white border border-ink-200 text-ink-500 px-3 py-1.5 rounded-full font-bold shadow-card">{e}</span>
          ))}
        </div>
        <input ref={fileInput} type="file" accept=".csv,.xlsx" onChange={handleFileChange} className="hidden" />
      </div>

      {uploadError && (
        <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
          <AlertTriangle size={14} className="flex-shrink-0" /> {uploadError}
        </div>
      )}

      {/* Steps */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: '1', icon: <Upload size={18} />,         title: 'Upload',  desc: 'CSV or Excel' },
          { n: '2', icon: <Sparkles size={18} />,       title: 'Match',   desc: 'KB lookup per question' },
          { n: '3', icon: <CheckCircle2 size={18} />,   title: 'Review',  desc: 'Accept, edit or skip' },
          { n: '4', icon: <FileDown size={18} />,       title: 'Export',  desc: 'Excel, CSV or Word' },
        ].map((s) => (
          <div key={s.n} className="bg-white rounded-2xl border border-ink-100 shadow-card p-4 text-center hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
            <div className="w-10 h-10 rounded-xl bg-ink-900 text-white flex items-center justify-center mx-auto mb-3">
              {s.icon}
            </div>
            <p className="text-sm font-bold text-ink-800">{s.title}</p>
            <p className="text-xs text-ink-400 mt-0.5 font-medium">{s.desc}</p>
          </div>
        ))}
      </div>

      {/* Past sessions */}
      {(pastSessions.length > 0 || orphanSessions.length > 0) && (
        <div className="space-y-6">
          {pastSessions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-ink-400" />
                <p className="text-sm font-bold text-ink-700">Previous Sessions</p>
                <button onClick={() => loadPastSessions()} className="ml-auto w-7 h-7 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded-lg transition-colors">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="space-y-2">
                {pastSessions.map((s) => <SessionRow key={s.id} session={s} onLoad={loadSessionQuestions} />)}
              </div>
            </div>
          )}

          {orphanSessions.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-ink-400" />
                <p className="text-sm font-bold text-ink-700">
                  {pastSessions.length > 0 ? 'Other Sessions' : 'Previous Sessions'}
                </p>
                {pastSessions.length > 0 && (
                  <span className="text-2xs text-ink-400 font-medium bg-ink-100 px-2 py-0.5 rounded-full">not linked to this opportunity</span>
                )}
              </div>
              <div className="space-y-2">
                {orphanSessions.map((s) => <SessionRow key={s.id} session={s} onLoad={loadSessionQuestions} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Step: column mapping ──────────────────────────────────────────────────
  if (step === 'mapping') return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 space-y-6">
      <div>
        <h2 className="text-2xl font-black text-ink-900 tracking-tight">Map Your Columns</h2>
        <p className="text-sm text-ink-500 mt-1.5 font-medium">Tell us which column contains the questions.</p>
      </div>

      <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
        <CheckCircle2 size={18} className="text-emerald-600 flex-shrink-0" />
        <span className="text-sm font-semibold text-emerald-800">
          <strong>{fileName}</strong> — {rawRows.current.length} rows, {headers.length} columns
        </span>
      </div>

      <div className="card p-6 space-y-5">
        <ColSelect label="Question column" value={questionCol} options={headers} onChange={setQuestionCol} required />

        <div>
          <p className="section-label mb-2.5">Detected columns</p>
          <div className="flex flex-wrap gap-2">
            {headers.map((h) => (
              <button
                key={h}
                onClick={() => setQuestionCol(h)}
                className={`text-xs px-3 py-1.5 rounded-xl border font-bold transition-all ${
                  h === questionCol ? 'bg-ink-900 border-ink-900 text-white' : 'bg-white border-ink-200 text-ink-500 hover:border-ink-400 hover:text-ink-800'
                }`}
              >{h}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => setStep('idle')} className="btn-ghost">Back</button>
        <button onClick={runProcessing} disabled={!questionCol} className="btn-primary disabled:opacity-40">
          <Sparkles size={16} /> Run KB Lookup
        </button>
      </div>
    </div>
  );

  // ── Step: processing ──────────────────────────────────────────────────────
  if (step === 'processing') return (
    <div className="max-w-md mx-auto px-4 sm:px-6 py-24 flex flex-col items-center gap-8">
      <div className="w-20 h-20 rounded-3xl bg-ink-900 flex items-center justify-center">
        <Loader2 size={36} className="text-white animate-spin" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-xl font-black text-ink-900">Matching Knowledge Base</p>
        <p className="text-sm text-ink-500 font-medium">{processMsg}</p>
      </div>
      <div className="w-full space-y-2">
        <div className="h-2 bg-ink-100 rounded-full overflow-hidden">
          <div className="h-full bg-ink-900 rounded-full transition-all duration-100" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-ink-400 text-center font-bold">{progress}%</p>
      </div>
    </div>
  );

  // ── Step: review / export ─────────────────────────────────────────────────
  if (step === 'review' || step === 'export') {
    const pendingCount  = pending.length;
    const acceptedCount = accepted.length;
    const skippedCount  = skipped.length;
    const totalCount    = questions.length;
    const allDone       = pendingCount === 0;

    const assignmentsWithNotes = Object.values(assignments).flat()
      .filter((a) => a.notes && a.notes.trim().length > 0);

    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">

        {/* Ready for review banner */}
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
          </div>
          <div className="flex items-center gap-2 flex-wrap ml-auto">
            {[
              { label: `${totalCount}`, sub: 'total',    cls: 'bg-white border-ink-200 text-ink-700' },
              { label: `${acceptedCount}`, sub: 'accepted', cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              { label: `${pendingCount}`, sub: 'pending',  cls: pendingCount > 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-ink-100 text-ink-400' },
              ...(skippedCount > 0 ? [{ label: `${skippedCount}`, sub: 'skipped', cls: 'bg-white border-ink-200 text-ink-500' }] : []),
            ].map((s) => (
              <span key={s.sub} className={`inline-flex items-baseline gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold ${s.cls}`}>
                {s.label} <span className="font-medium opacity-70">{s.sub}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Bulk actions + complete button */}
        <div className="flex flex-wrap items-center gap-2 p-4 bg-white rounded-2xl border border-ink-100 shadow-card">
          <span className="section-label mr-1">Bulk accept:</span>
          <button onClick={() => bulkAccept(0.80)} disabled={!anyCalibrated}
            title={anyCalibrated ? 'Accept pending drafts with calibrated confidence of 80% or more' : 'Not available: confidence is not calibrated for these results'}
            className="text-xs font-bold px-3.5 py-2 bg-ink-900 text-white rounded-xl hover:bg-ink-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            High ≥80%
          </button>
          <button onClick={() => bulkAccept(0.60)} disabled={!anyCalibrated}
            title={anyCalibrated ? 'Accept pending drafts with calibrated confidence of 60% or more' : 'Not available: confidence is not calibrated for these results'}
            className="text-xs font-bold px-3.5 py-2 bg-ink-100 text-ink-700 rounded-xl hover:bg-ink-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            Medium ≥60%
          </button>
          <button onClick={bulkAcceptAll} className="text-xs font-bold px-3.5 py-2 border border-ink-200 text-ink-600 rounded-xl hover:bg-ink-50 transition-colors">
            All
          </button>
          <div className="ml-auto">
            {(allDone || acceptedCount > 0) && step === 'review' && (
              <button onClick={finishSession} className="btn-primary text-xs py-2">
                <Download size={14} /> Review Complete <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>

        {uploadError && (
          <div role="alert" className="flex items-center gap-2 text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
            <AlertTriangle size={14} className="flex-shrink-0" /> {uploadError}
          </div>
        )}
        {retrievalNote && (
          <div role="status" className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 font-medium">
            <AlertTriangle size={14} className="flex-shrink-0" /> {retrievalNote}
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
                    className={`text-xs px-3 py-1.5 rounded-lg font-bold capitalize transition-all ${
                      filter === t ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
                    }`}>
                    {t} <span className="opacity-60">({cnt[t]})</span>
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
              <strong>{questions.filter((q) => q.confidence !== null && q.confidence < 0.4 && q.status === 'pending').length}</strong> questions have very low confidence (&lt;40%) — edit these carefully before accepting.
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
                    index={questions.indexOf(q)}
                    isExpanded={expandedId === q.id}
                    onToggleExpand={() => setExpandedId(expandedId === q.id ? null : q.id)}
                    onAccept={(ans) => handleAccept(q.id, ans)}
                    onSkip={() => handleSkip(q.id)}
                    onUndoSkip={() => handleUndoSkip(q.id)}
                    users={allUsers}
                    assignments={assignments[q.id] ?? []}
                    onAssign={canAssign ? handleAssign : undefined}
                    onUnassign={canAssign ? handleUnassign : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Export panel */}
        {step === 'export' && (
          <div className="card overflow-hidden">
            <div className="flex items-center gap-4 px-6 py-5 border-b border-ink-100 bg-ink-50">
              <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center">
                <Download size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-ink-900">Export & Finalise</h3>
                <p className="text-xs text-ink-500 font-medium">{acceptedCount} accepted response{acceptedCount !== 1 ? 's' : ''} ready</p>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {/* Add to KB */}
              <div>
                <p className="section-label mb-3">Knowledge Base</p>
                {kbAdded ? (
                  <div className="flex items-center gap-2.5 text-sm text-emerald-700 font-semibold">
                    <CheckCircle2 size={17} className="text-emerald-500" />
                    {acceptedCount} answer{acceptedCount !== 1 ? 's' : ''} added to Knowledge Base
                  </div>
                ) : (
                  <button onClick={handleAddToKB} className="btn-primary">
                    <Plus size={16} /> Add {acceptedCount} Answer{acceptedCount !== 1 ? 's' : ''} to KB
                  </button>
                )}
                <p className="text-xs text-ink-400 mt-2 font-medium">Accepted answers will be available for future RFI matching.</p>
              </div>

              {/* Download buttons */}
              <div className="border-t border-ink-100 pt-5">
                <p className="section-label mb-4">Download as</p>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => exportExcel(questions, fileName)}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-emerald-300 text-emerald-700 rounded-2xl hover:bg-emerald-50 transition-colors shadow-card">
                    <Sheet size={18} /> Excel (.xlsx)
                  </button>
                  <button onClick={() => exportCSV(questions, fileName)}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-ink-200 text-ink-700 rounded-2xl hover:bg-ink-50 transition-colors shadow-card">
                    <FileText size={18} /> CSV (.csv)
                  </button>
                  <button onClick={() => exportWord(questions, fileName)}
                    className="flex items-center gap-2 px-5 py-3 text-sm font-bold bg-white border-2 border-sky-300 text-sky-700 rounded-2xl hover:bg-sky-50 transition-colors shadow-card">
                    <FileDown size={18} /> Word (.doc)
                  </button>
                </div>
              </div>

              <div className="border-t border-ink-100 pt-4">
                <button onClick={startNew} className="btn-ghost text-sm">
                  <Upload size={15} /> Start New RFI
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
