import { useState, useEffect } from 'react';
import { ChevronDown, CheckCircle2, SkipForward, Pencil, RotateCcw, BookOpen, Tag, UserPlus, UserCheck, X, ChevronDown as ChevDown, Info, ExternalLink, AlertTriangle } from 'lucide-react';
import { RFIQuestion, UserProfile, QuestionAssignment, KnowledgeEntry } from './types';
import { formatConfidence } from './lib/format';
import { answerSource, ANSWER_HEADING, ANSWER_TIP } from './lib/answerLabel';
import { suggestExperts, type ExpertSuggestion } from './lib/responses';
import { supabase } from './lib/supabase';

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center">
      <Info size={12} className="text-ink-300 hover:text-ink-500 cursor-default transition-colors" />
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-ink-900 text-white text-xs rounded-xl px-3 py-2 leading-relaxed shadow-modal opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-30 whitespace-normal font-normal">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-ink-900" />
      </span>
    </span>
  );
}

// ─── KB Article Modal ─────────────────────────────────────────────────────────

function KBArticleModal({ entry, score, onClose }: { entry: KnowledgeEntry; score: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-modal w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center flex-shrink-0">
              <BookOpen size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black text-ink-600 bg-ink-50 px-2.5 py-1 rounded-full border border-ink-200">{entry.id}</span>
                {entry.source && (
                  <span className="text-xs text-ink-400 flex items-center gap-1 font-medium">
                    <ExternalLink size={10} />{entry.source}
                  </span>
                )}
                <span title="Similarity to the question; not a probability" className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full">
                  {Math.round(score * 100)}% similarity
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center flex-shrink-0 ml-2">
            <X size={15} className="text-ink-400" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-5">
          <div>
            <p className="section-label mb-2">Question</p>
            <p className="text-sm font-semibold text-ink-800 leading-snug">{entry.question}</p>
          </div>
          <div>
            <p className="section-label mb-2">Answer</p>
            <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">{entry.answer}</p>
          </div>
          {entry.tags.length > 0 && (
            <div>
              <p className="section-label mb-2">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {entry.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 text-xs bg-ink-50 text-ink-600 px-2.5 py-1 rounded-full border border-ink-200 font-medium">
                    <Tag size={9} />{t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidenceLabel(c: number | null): { label: string; dot: string; bar: string; text: string } {
  if (c === null) return { label: 'Not calibrated', dot: 'bg-ink-300', bar: 'bg-ink-300', text: 'text-ink-500' };
  const pct = c * 100;
  if (pct >= 80) return { label: 'High',   dot: 'bg-emerald-500', bar: 'bg-emerald-500', text: 'text-emerald-700' };
  if (pct >= 40) return { label: 'Medium', dot: 'bg-amber-400',   bar: 'bg-amber-400',   text: 'text-amber-700' };
  return               { label: 'Low',    dot: 'bg-coral-500',   bar: 'bg-coral-500',   text: 'text-coral-600' };
}

/** Why a question is never bulk-approved (S2-2a, S2-3), as the reviewer sees it. */
const GATE_BADGE: Record<NonNullable<RFIQuestion['gate']>, { label: string; cls: string }> = {
  pricing:     { label: 'Pricing: a person answers', cls: 'bg-coral-50 text-coral-700 border-coral-200' },
  legal:       { label: 'Legal: review individually', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  unchecked:   { label: 'Not fully checked', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  translation: { label: 'Translated draft', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  unreviewed_source: { label: 'Cites an unreviewed entry', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  stale_source: { label: 'Cites an entry overdue for review', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** What the Proposed Response box holds, for its tooltip. */
const DRAFT_KIND_TIP: Record<NonNullable<RFIQuestion['draftKind']>, string> = {
  generated: 'Written by a language model from the matched knowledge-base entries only, citing them. Every citation and figure was checked against the entries before it was offered.',
  assembled: 'Assembled from sentences of the matched knowledge-base answers, with references. Nothing was generated.',
  insufficient_evidence: 'No draft: the matched entries do not answer this question. A person needs to write the answer.',
  person_required: 'No draft: pricing questions are always answered by a person.',
};

const STATUS_RING: Record<RFIQuestion['status'], string> = {
  pending:  'border-ink-200 hover:border-ink-300',
  accepted: 'border-emerald-300 bg-emerald-50/20',
  skipped:  'border-ink-100 opacity-60',
};

const ASSIGNMENT_BADGE: Record<string, string> = {
  pending:   'bg-ink-50 text-ink-600 border-ink-200',
  in_review: 'bg-amber-50 text-amber-700 border-amber-200',
  answered:  'bg-sky-50 text-sky-700 border-sky-200',
  approved:  'bg-emerald-50 text-emerald-700 border-emerald-200',
};
const ASSIGNMENT_LABEL: Record<string, string> = {
  pending: 'Pending', in_review: 'In Review', answered: 'Answered', approved: 'Approved',
};

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = ['bg-ink-200 text-ink-700', 'bg-sky-100 text-sky-700', 'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700', 'bg-rose-100 text-rose-700', 'bg-cyan-100 text-cyan-700'];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

// ─── Assignment panel ─────────────────────────────────────────────────────────

function AssignmentPanel({
  question, users, assignments, onAssign, onUnassign,
}: {
  question: RFIQuestion; users: UserProfile[];
  assignments: QuestionAssignment[];
  onAssign: (userId: string) => void; onUnassign: (assignmentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ExpertSuggestion[]>([]);
  const assignedIds = new Set(assignments.map((a) => a.assignedTo));

  // S3-6: suggestions from what people wrote and approved before, as well as stated expertise.
  useEffect(() => {
    let live = true;
    suggestExperts(supabase, question.id).then((s) => { if (live) setSuggestions(s); });
    return () => { live = false; };
  }, [question.id]);

  const reasonsFor = new Map(suggestions.map((s) => [s.userId, s]));
  const scored = users
    .filter((u) => !assignedIds.has(u.id))
    .map((u) => ({ user: u, matchingTags: reasonsFor.get(u.id)?.reasons ?? [], score: reasonsFor.get(u.id)?.score ?? 0 }))
    .sort((a, b) => b.score - a.score || a.user.displayName.localeCompare(b.user.displayName));

  const recommendedCount = scored.filter(({ score }) => score > 0).length;

  return (
    <div onClick={(e) => e.stopPropagation()} className="space-y-2.5">
      {/* Current assignees */}
      {assignments.length > 0 && (
        <div className="space-y-1.5">
          {assignments.map((a) => {
            const u = users.find((u) => u.id === a.assignedTo);
            return (
              <div key={a.id} className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${a.status === 'approved' ? 'bg-emerald-50 border-emerald-200' : 'bg-ink-50 border-ink-200'}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 ${avatarColor(u?.displayName ?? '?')}`}>
                  {u?.displayName.charAt(0).toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-ink-800">{u?.displayName ?? 'Unknown'}</span>
                  {u?.jobTitle && <span className="text-xs text-ink-400 ml-1.5 font-medium">{u.jobTitle}</span>}
                </div>
                <span className={`status-pill text-2xs ${ASSIGNMENT_BADGE[a.status]}`}>{ASSIGNMENT_LABEL[a.status]}</span>
                {a.status !== 'approved' && (
                  <button onClick={() => onUnassign(a.id)} className="w-5 h-5 flex items-center justify-center text-ink-300 hover:text-coral-500 transition-colors flex-shrink-0" title="Remove">
                    <X size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Assign button */}
      {scored.length > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className={`flex items-center gap-2 text-xs font-bold border rounded-xl px-3.5 py-2 transition-all ${
            open ? 'bg-ink-900 border-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 border-ink-200 hover:border-ink-400 hover:bg-ink-50'
          }`}
        >
          <UserPlus size={13} />
          {assignments.length > 0 ? 'Assign another' : 'Assign for review'}
          {recommendedCount > 0 && (
            <span className={`text-2xs rounded-full px-1.5 py-0.5 font-black leading-none ${open ? 'bg-white/20 text-white' : 'bg-ink-900 text-white'}`}>
              {recommendedCount} match
            </span>
          )}
          <ChevDown size={11} className={`transition-transform ml-0.5 ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Candidate list */}
      {open && (
        <div className="border border-ink-200 rounded-2xl overflow-hidden shadow-card">
          {scored.length === 0 && (
            <p className="text-xs text-ink-400 px-4 py-3 font-medium">All team members are assigned.</p>
          )}
          {scored.map(({ user, matchingTags }, idx) => {
            const isRecommended = matchingTags.length > 0;
            const isTop = idx === 0 && isRecommended;
            return (
              <div key={user.id} className={`border-b border-ink-100 last:border-b-0 ${isTop ? 'bg-ink-50' : 'bg-white'}`}>
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-black flex-shrink-0 ${avatarColor(user.displayName)}`}>
                    {user.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-ink-800">{user.displayName}</span>
                      {isTop && (
                        <span className="text-2xs font-black text-ink-600 bg-ink-100 border border-ink-200 px-2 py-0.5 rounded-full">Top pick</span>
                      )}
                    </div>
                    {user.jobTitle && (
                      <p className="text-xs text-ink-500 font-medium mb-1.5">{user.jobTitle}{user.department ? ` · ${user.department}` : ''}</p>
                    )}
                    {isRecommended ? (
                      <div className="flex flex-wrap gap-1">
                        {matchingTags.map((t) => (
                          <span key={t} className="inline-flex items-center gap-1 text-2xs font-bold bg-ink-900 text-white px-2 py-0.5 rounded-full">
                            <Tag size={8} />{t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-2xs text-ink-300 italic font-medium">No history or expertise match</p>
                    )}
                  </div>
                  <button
                    onClick={() => onAssign(user.id)}
                    className={`flex-shrink-0 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors ${
                      isRecommended ? 'bg-ink-900 text-white hover:bg-ink-700' : 'border border-ink-200 text-ink-500 hover:bg-ink-50'
                    }`}
                  >
                    Assign
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  question: RFIQuestion;
  index: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAccept: (finalAnswer: string) => void;
  onSkip: () => void;
  onUndoSkip: () => void;
  users?: UserProfile[];
  assignments?: QuestionAssignment[];
  onAssign?: (questionId: string, userId: string) => void;
  onUnassign?: (questionId: string, assignmentId: string) => void;
  /** Owner, admin or assignee (Sprint 3, F-7); others can read but not decide. */
  canDecide?: boolean;
}

export default function RFIQuestionCard({
  question, index, isExpanded, onToggleExpand, onAccept, onSkip, onUndoSkip,
  users = [], assignments = [], onAssign, onUnassign, canDecide = true,
}: Props) {
  const [editing, setEditing]     = useState(false);
  const [editText, setEditText]   = useState(question.finalAnswer);
  const [kbArticle, setKbArticle] = useState<{ entry: KnowledgeEntry; score: number } | null>(null);
  const conf = confidenceLabel(question.confidence);
  const source = answerSource(question);
  const pct  = question.confidence === null ? null : Math.round(question.confidence * 100);

  useEffect(() => { setEditText(question.finalAnswer); }, [question.finalAnswer]);

  const handleAccept = () => {
    if (editing) { onAccept(editText); setEditing(false); }
    else onAccept(question.finalAnswer);
  };

  const handleStartEdit = () => {
    setEditText(question.finalAnswer);
    setEditing(true);
    if (!isExpanded) onToggleExpand();
  };

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all duration-150 shadow-card ${STATUS_RING[question.status]}`}>
      {kbArticle && (
        <KBArticleModal entry={kbArticle.entry} score={kbArticle.score} onClose={() => setKbArticle(null)} />
      )}

      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 px-5 py-4 cursor-pointer select-none" onClick={onToggleExpand}>
        {/* Confidence dot */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0 mt-0.5">
          <div className={`w-3 h-3 rounded-full ${conf.dot}`} />
        </div>

        {/* Index */}
        <span className="text-xs font-black text-ink-300 flex-shrink-0 w-7 mt-0.5 font-feature-tnum">
          {String(index + 1).padStart(2, '0')}
        </span>
        {question.customerRef && (
          <span className="text-2xs font-bold text-ink-500 bg-ink-50 border border-ink-100 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5" title="The customer's number for this question">
            {question.customerRef}
          </span>
        )}

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold leading-snug ${question.status === 'skipped' ? 'text-ink-400 line-through' : 'text-ink-800'}`}>
            {question.question}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-2xs font-black uppercase tracking-wide ${conf.text}`}>
              {pct === null ? conf.label : `${conf.label}: ${formatConfidence(question.confidence)}`}
            </span>
            {question.gate && (
              <span title={question.gateReason ?? undefined} className={`status-pill text-2xs ${GATE_BADGE[question.gate].cls}`}>
                {GATE_BADGE[question.gate].label}
              </span>
            )}
            {!question.processed && <span className="status-pill text-2xs bg-ink-50 text-ink-500 border-ink-200">Not processed yet</span>}
            {question.status === 'accepted' && (
              <span className="flex items-center gap-1 text-2xs text-emerald-700 font-bold">
                <CheckCircle2 size={11} />
                {question.finalAnswer !== question.generatedAnswer ? 'Accepted (edited)' : 'Accepted'}
                {question.approval && (
                  <span className="font-medium text-emerald-600">
                    {' '}by {users.find((u) => u.id === question.approval!.by)?.displayName ?? 'a team member'},{' '}
                    {new Date(question.approval.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {question.approval.kind === 'bulk' && question.approval.threshold !== null ? `, bulk at ${Math.round(question.approval.threshold * 100)}%` : ''}
                  </span>
                )}
              </span>
            )}
            {question.status === 'skipped' && (
              <span className="text-2xs text-ink-400 font-bold">Skipped</span>
            )}
            {assignments.length > 0 && (
              <span className="flex items-center gap-1 text-2xs text-ink-600 font-bold">
                <UserCheck size={11} />
                {assignments.length === 1 ? 'Assigned' : `${assignments.length} assigned`}
              </span>
            )}
          </div>
        </div>

        {/* Confidence bar */}
        <div className="hidden sm:flex items-center gap-2 w-28 flex-shrink-0 mt-1">
          <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${conf.bar}`} style={{ width: `${pct ?? 0}%` }} />
          </div>
          <span className={`text-xs font-black w-9 text-right ${conf.text}`} title={pct === null ? 'Not calibrated' : undefined}>{pct === null ? 'n/c' : formatConfidence(question.confidence)}</span>
        </div>

        <ChevronDown size={16} className={`flex-shrink-0 text-ink-300 transition-transform mt-0.5 ${isExpanded ? 'rotate-180' : ''}`} />
      </div>

      {/* ── Expanded body ───────────────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-ink-100 px-5 pb-5 pt-4 space-y-5">

          {/* Confidence breakdown */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Confidence', value: question.confidence, tip: question.confidence === null
                  ? 'Not calibrated: matching was keyword-only, the answerability check was unavailable, or there is no calibration table for the models in use. Bulk approval is not available for this question.'
                  : `The measured chance that the knowledge base answers this question with the top entry, from the matching and a check of whether the entry actually answers it, calibrated on ${question.provenance.calibrationSet ?? 'the evaluation set'} (docs/evals). The set is small, so the top is shown as 99%+, never as certainty.` },
              { label: 'Similarity', value: question.retrievalScore, tip: 'Cosine similarity between the question and the best-matching entry (or the keyword score when matching was keyword-only). Not a probability.' },
            ].map((m) => {
              if (m.value === null) {
                return (
                  <div key={m.label} className="bg-ink-50 rounded-xl p-3 border border-ink-100">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-2xs font-black uppercase tracking-wider text-ink-500">{m.label}</span>
                      <InfoTip text={m.tip} />
                    </div>
                    <span className="text-sm font-black text-ink-500">Not calibrated</span>
                  </div>
                );
              }
              const mp = Math.min(100, Math.round(m.value * 100));
              const mc = mp >= 80 ? 'text-emerald-700' : mp >= 40 ? 'text-amber-700' : 'text-coral-600';
              const bar = mp >= 80 ? 'bg-emerald-500' : mp >= 40 ? 'bg-amber-400' : 'bg-coral-500';
              return (
                <div key={m.label} className="bg-ink-50 rounded-xl p-3 border border-ink-100">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className={`text-2xs font-black uppercase tracking-wider ${mc}`}>{m.label}</span>
                    <InfoTip text={m.tip} />
                  </div>
                  <div className="h-1 bg-ink-200 rounded-full overflow-hidden mb-1.5">
                    <div className={`h-full rounded-full ${bar}`} style={{ width: `${mp}%` }} />
                  </div>
                  <span className={`text-sm font-black ${mc}`}>{m.label === 'Confidence' ? formatConfidence(m.value) : `${mp}%`}</span>
                </div>
              );
            })}
          </div>

          {/* KB sources */}
          {question.sources.length > 0 && (
            <div>
              <p className="section-label mb-2.5 flex items-center gap-1.5">
                <BookOpen size={11} /> KB Sources
                <InfoTip text="Knowledge-base entries this draft was assembled from. Click to read the full entry." />
              </p>
              <div className="flex flex-wrap gap-2">
                {question.sources.slice(0, 3).map((s) => (
                  <button
                    key={s.entry.id}
                    onClick={(e) => { e.stopPropagation(); setKbArticle({ entry: s.entry, score: s.score }); }}
                    className="flex items-center gap-2 text-xs bg-ink-50 border border-ink-200 text-ink-700 px-3 py-1.5 rounded-xl hover:bg-ink-900 hover:text-white hover:border-ink-900 transition-all cursor-pointer group font-semibold"
                  >
                    <span className="font-black">{s.entry.id}</span>
                    <span className="text-ink-400 group-hover:text-white/60 truncate max-w-[160px] transition-colors">{s.entry.question}</span>
                    <span className="font-bold opacity-60" title="Similarity to the question; not a probability">({Math.round(s.score * 100)}%)</span>
                    <ExternalLink size={10} className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Assignment */}
          {users.length > 0 && onAssign && onUnassign && (
            <div className="border-t border-ink-100 pt-4">
              <p className="section-label mb-3 flex items-center gap-1.5">
                <UserPlus size={11} /> Expert Assignment
                <InfoTip text="Route this question to team members for specialist review. Suggestions come from who wrote the cited entries, who approved similar answers before, and stated expertise; the reasons are shown." />
              </p>
              <AssignmentPanel
                question={question}
                users={users}
                assignments={assignments}
                onAssign={(userId) => onAssign(question.id, userId)}
                onUnassign={(assignmentId) => onUnassign(question.id, assignmentId)}
              />
            </div>
          )}

          {/* Answer */}
          <div className="border-t border-ink-100 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="section-label flex items-center gap-1.5">
                {editing ? 'Edit Response' : ANSWER_HEADING[source]}
                {!editing && <InfoTip text={source === 'draft'
                  ? `${question.draftKind ? DRAFT_KIND_TIP[question.draftKind] : 'Draft assembled from the best-matching knowledge-base answers, with references.'} Accept as it is, edit, or skip.`
                  : ANSWER_TIP[source]} />}
              </p>
              {!editing && canDecide && question.status !== 'skipped' && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleStartEdit(); }}
                  className="flex items-center gap-1.5 text-xs text-ink-500 hover:text-ink-900 font-bold transition-colors"
                >
                  <Pencil size={11} /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={8} autoFocus
                  className="input resize-none leading-relaxed font-normal"
                />
                <div className="flex items-center gap-2">
                  <button onClick={() => { onAccept(editText); setEditing(false); }} className="btn-primary text-xs py-2">
                    <CheckCircle2 size={13} /> Save & Accept
                  </button>
                  <button onClick={() => { setEditing(false); setEditText(question.finalAnswer); }} className="btn-ghost text-xs py-2">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-ink-700 leading-relaxed bg-ink-50 rounded-2xl p-4 border border-ink-100 whitespace-pre-wrap font-normal">
                {question.finalAnswer || <span className="italic text-ink-400">No draft available.</span>}
              </div>
            )}
          </div>

          {(question.gateReason || question.processingNote) && (
            <div className="space-y-1.5 text-xs font-medium leading-relaxed">
              {question.gateReason && <p className="text-ink-600"><strong>Held back from bulk approval:</strong> {question.gateReason}</p>}
              {question.processingNote && <p className="text-amber-700">{question.processingNote}</p>}
            </div>
          )}
          {(question.provenance.draftModel || question.provenance.judgeModel || question.provenance.embeddingModel) && (
            <p className="text-2xs text-ink-400 font-medium">
              {[
                question.provenance.embeddingModel && `Matched with ${question.provenance.embeddingModel}`,
                question.provenance.judgeModel && `checked by ${question.provenance.judgeModel}`,
                question.provenance.draftModel && `drafted by ${question.provenance.draftModel} (${question.provenance.promptVersion})`,
              ].filter(Boolean).join(', ')}.
            </p>
          )}

          {!canDecide && question.status === 'pending' && (
            <p className="text-xs text-ink-500 font-medium">Only the response owner, an admin, or someone this question is assigned to can decide it.</p>
          )}

          {/* Action buttons */}
          {!editing && canDecide && (
            <div className="flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
              {question.status !== 'accepted' && question.status !== 'skipped' && (
                <>
                  <button onClick={handleAccept} className="btn-primary text-xs py-2">
                    <CheckCircle2 size={14} /> Accept
                  </button>
                  <button onClick={handleStartEdit} className="btn-ghost text-xs py-2">
                    <Pencil size={13} /> Edit First
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); onSkip(); }}
                    className="flex items-center gap-1.5 text-xs font-bold text-ink-400 hover:text-ink-700 transition-colors ml-auto">
                    <SkipForward size={13} /> Skip
                  </button>
                </>
              )}
              {question.status === 'accepted' && (
                <button onClick={(e) => { e.stopPropagation(); handleStartEdit(); }} className="btn-ghost text-xs py-2">
                  <Pencil size={13} /> Revise Answer
                </button>
              )}
              {question.status === 'skipped' && (
                <button onClick={(e) => { e.stopPropagation(); onUndoSkip(); }} className="btn-ghost text-xs py-2">
                  <RotateCcw size={13} /> Restore
                </button>
              )}
            </div>
          )}

          {question.confidence !== null && question.confidence < 0.4 && question.status === 'pending' && (
            <div className="flex items-start gap-2.5 p-3.5 bg-coral-50 border border-coral-200 rounded-xl">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5 text-coral-500" />
              <p className="text-xs text-coral-700 font-medium leading-relaxed">
                Low confidence: the knowledge base probably does not answer this. Review carefully before accepting.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
