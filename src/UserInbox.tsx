import { useState, useEffect } from 'react';
import { Inbox, Clock, TrendingUp, CheckCircle2, CheckCheck, ChevronDown, RefreshCw, MessageSquare, X, ArrowRight, Lock } from 'lucide-react';
import { supabase } from './lib/supabase';
import { assignmentPeople } from './lib/format';
import { QuestionAssignment, AssignmentStatus } from './types';

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AssignmentStatus, {
  label: string; icon: React.ReactNode;
  pill: string; next: AssignmentStatus | null;
}> = {
  pending:   { label: 'Pending',   icon: <Clock size={12} />,        pill: 'bg-ink-50 text-ink-600 border-ink-200',             next: 'in_review' },
  in_review: { label: 'In Review', icon: <TrendingUp size={12} />,   pill: 'bg-amber-50 text-amber-700 border-amber-200',       next: 'answered' },
  answered:  { label: 'Answered',  icon: <CheckCircle2 size={12} />, pill: 'bg-sky-50 text-sky-700 border-sky-200',             next: 'approved' },
  approved:  { label: 'Approved',  icon: <CheckCheck size={12} />,   pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', next: null },
  closed:    { label: 'Closed',    icon: <Lock size={12} />,         pill: 'bg-ink-50 text-ink-400 border-ink-200',             next: null },
};

const STATUS_ORDER: AssignmentStatus[] = ['pending', 'in_review', 'answered', 'approved'];
/** Filters: the steps, plus assignments closed when their response was exported (F-26). */
const FILTERS: AssignmentStatus[] = [...STATUS_ORDER, 'closed'];

// ─── Notes modal ──────────────────────────────────────────────────────────────

function NotesModal({ assignment, onClose, onSave }: {
  assignment: QuestionAssignment; onClose: () => void; onSave: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(assignment.notes);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(notes);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-modal w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-ink-900 rounded-xl flex items-center justify-center">
              <MessageSquare size={16} className="text-white" />
            </div>
            <h3 className="font-bold text-ink-900">Add Notes</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center">
            <X size={15} className="text-ink-500" />
          </button>
        </div>
        <div className="p-6">
          <p className="text-xs text-ink-500 mb-3 line-clamp-2 font-medium">{assignment.questionText}</p>
          <textarea
            autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} rows={5}
            placeholder="Add your notes or comments…"
            className="input resize-none"
          />
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-ink-100 bg-ink-50 rounded-b-3xl">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Notes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Assignment card ──────────────────────────────────────────────────────────

function AssignmentCard({ assignment, isOwn, tab, onStatusChange, onNotesUpdate }: {
  tab: 'mine' | 'sent' | 'all';
  assignment: QuestionAssignment; isOwn: boolean;
  onStatusChange: (id: string, status: AssignmentStatus) => void;
  onNotesUpdate: (id: string, notes: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const cfg = STATUS_CONFIG[assignment.status];
  const nextStatus = cfg.next;
  const sidx = STATUS_ORDER.indexOf(assignment.status);

  return (
    <>
      {showNotes && (
        <NotesModal
          assignment={assignment}
          onClose={() => setShowNotes(false)}
          onSave={(notes) => { onNotesUpdate(assignment.id, notes); return Promise.resolve(); }}
        />
      )}
      <div className={`bg-white rounded-2xl border shadow-card overflow-hidden transition-all duration-150 ${
        assignment.status === 'approved' ? 'border-emerald-200' : 'border-ink-100 hover:border-ink-200'
      }`}>
        <div className="flex items-start gap-4 px-5 py-4 cursor-pointer" onClick={() => setExpanded((e) => !e)}>
          {/* Status indicator strip */}
          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${
            assignment.status === 'pending' ? 'bg-ink-200' :
            assignment.status === 'in_review' ? 'bg-amber-400' :
            assignment.status === 'answered' ? 'bg-sky-400' :
            'bg-emerald-500'
          }`} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`status-pill ${cfg.pill}`}>
                {cfg.icon}{cfg.label}
              </span>
              {assignment.opportunityName && (
                <span className="text-xs text-ink-400 font-medium truncate">{assignment.opportunityName}</span>
              )}
            </div>
            <p className="text-sm font-semibold text-ink-800 leading-snug line-clamp-2">{assignment.questionText}</p>
            <p className="text-xs text-ink-400 mt-1.5 font-medium">
              {new Date(assignment.createdAt).toLocaleDateString()}
              {` · ${assignmentPeople(tab, assignment)}`}
            </p>
          </div>

          {/* Progress dots */}
          <div className="hidden sm:flex items-center gap-1 flex-shrink-0 mt-1">
            {STATUS_ORDER.map((s, i) => {
              const isPast = i < sidx;
              const isCurrent = i === sidx;
              return (
                <div key={s} className="flex items-center gap-1">
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    isCurrent ? 'bg-ink-900' : isPast ? 'bg-emerald-500' : 'bg-ink-100'
                  }`} />
                  {i < STATUS_ORDER.length - 1 && (
                    <div className={`w-4 h-0.5 ${isPast ? 'bg-emerald-300' : 'bg-ink-100'}`} />
                  )}
                </div>
              );
            })}
          </div>

          <ChevronDown size={15} className={`flex-shrink-0 text-ink-300 transition-transform mt-0.5 ${expanded ? 'rotate-180' : ''}`} />
        </div>

        {expanded && (
          <div className="border-t border-ink-100 px-5 py-4 space-y-4">
            {assignment.answerText && (
              <div>
                <p className="section-label mb-2">Proposed Answer</p>
                <div className="text-sm text-ink-700 bg-ink-50 rounded-2xl p-4 border border-ink-100 leading-relaxed whitespace-pre-wrap max-h-44 overflow-y-auto font-normal">
                  {assignment.answerText}
                </div>
              </div>
            )}

            {assignment.notes && (
              <div>
                <p className="section-label mb-2">Notes</p>
                <div className="text-sm text-ink-700 bg-amber-50 rounded-2xl p-4 border border-amber-100 whitespace-pre-wrap font-normal">
                  {assignment.notes}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {isOwn && nextStatus && (
                <button
                  onClick={() => onStatusChange(assignment.id, nextStatus)}
                  className="btn-primary text-xs py-2"
                >
                  {STATUS_CONFIG[nextStatus].icon}
                  Mark as {STATUS_CONFIG[nextStatus].label}
                  <ArrowRight size={12} />
                </button>
              )}
              <button
                onClick={() => setShowNotes(true)}
                className="btn-ghost text-xs py-2"
              >
                <MessageSquare size={12} /> {assignment.notes ? 'Edit Notes' : 'Add Notes'}
              </button>

              {/* Mobile progress */}
              <div className="ml-auto sm:hidden flex items-center gap-1">
                {STATUS_ORDER.map((s, i) => {
                  const isPast = i < sidx;
                  const isCurrent = i === sidx;
                  return (
                    <div key={s} className="flex items-center gap-1">
                      <div className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-ink-900' : isPast ? 'bg-emerald-500' : 'bg-ink-100'}`} />
                      {i < STATUS_ORDER.length - 1 && <div className={`w-3 h-0.5 ${isPast ? 'bg-emerald-300' : 'bg-ink-100'}`} />}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Main inbox ───────────────────────────────────────────────────────────────

interface Props { userId: string; isAdmin: boolean; }
type InboxTab = 'mine' | 'sent' | 'all';

export default function UserInbox({ userId, isAdmin }: Props) {
  const [assignments, setAssignments] = useState<QuestionAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<InboxTab>('mine');
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | 'all'>('all');

  useEffect(() => { loadAssignments(); }, []);

  async function loadAssignments() {
    setLoading(true);
    const { data } = await supabase
      .from('question_assignments')
      .select(`
        *,
        assignedToProfile:user_profiles!question_assignments_assigned_to_fkey(id, display_name, expertise_tags, is_admin, created_at),
        assignedByProfile:user_profiles!question_assignments_assigned_by_fkey(id, display_name, expertise_tags, is_admin, created_at),
        opportunity:opportunities(name)
      `)
      .order('created_at', { ascending: false });

    if (data) {
      setAssignments(data.map((r) => ({
        id: r.id, questionId: r.question_id, sessionId: r.session_id,
        opportunityId: r.opportunity_id, assignedTo: r.assigned_to, assignedBy: r.assigned_by,
        questionText: r.question_text, answerText: r.answer_text, status: r.status as AssignmentStatus,
        notes: r.notes, completedAt: r.completed_at ?? null,
        createdAt: r.created_at, updatedAt: r.updated_at,
        assignedToProfile: r.assignedToProfile ? {
          id: r.assignedToProfile.id, displayName: r.assignedToProfile.display_name,
          expertiseTags: r.assignedToProfile.expertise_tags ?? [], isAdmin: r.assignedToProfile.is_admin,
          createdAt: r.assignedToProfile.created_at, jobTitle: '', department: '',
        } : undefined,
        assignedByProfile: r.assignedByProfile ? {
          id: r.assignedByProfile.id, displayName: r.assignedByProfile.display_name,
          expertiseTags: r.assignedByProfile.expertise_tags ?? [], isAdmin: r.assignedByProfile.is_admin,
          createdAt: r.assignedByProfile.created_at, jobTitle: '', department: '',
        } : undefined,
        opportunityName: r.opportunity?.name,
      })));
    }
    setLoading(false);
  }

  const handleStatusChange = async (id: string, status: AssignmentStatus) => {
    const now = new Date().toISOString();
    await supabase.from('question_assignments')
      .update({ status, updated_at: now, ...(status === 'approved' ? { completed_at: now } : {}) })
      .eq('id', id);

    if (status === 'approved') {
      const thisA = assignments.find((a) => a.id === id);
      if (thisA) {
        await supabase.from('question_assignments')
          .update({ status: 'approved', updated_at: now, completed_at: now })
          .eq('question_id', thisA.questionId).eq('session_id', thisA.sessionId).neq('id', id);
        setAssignments((prev) =>
          prev.map((a) =>
            a.questionId === thisA.questionId && a.sessionId === thisA.sessionId
              ? { ...a, status: 'approved', completedAt: now, updatedAt: now } : a
          )
        );
        return;
      }
    }
    setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, status, updatedAt: now } : a));
  };

  const handleNotesUpdate = async (id: string, notes: string) => {
    await supabase.from('question_assignments').update({ notes, updated_at: new Date().toISOString() }).eq('id', id);
    setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, notes } : a));
  };

  const tabItems: { key: InboxTab; label: string }[] = [
    { key: 'mine', label: 'My Inbox' },
    { key: 'sent', label: 'Sent' },
    ...(isAdmin ? [{ key: 'all' as InboxTab, label: 'All' }] : []),
  ];

  const filtered = assignments.filter((a) => {
    if (tab === 'mine' && a.assignedTo !== userId) return false;
    if (tab === 'sent' && a.assignedBy !== userId) return false;
    if (statusFilter !== 'all' && a.status !== statusFilter) return false;
    return true;
  });

  const pendingCount  = assignments.filter((a) => a.assignedTo === userId && a.status === 'pending').length;
  const inReviewCount = assignments.filter((a) => a.assignedTo === userId && a.status === 'in_review').length;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-7">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-ink-900 tracking-tight">Assignments</h1>
          <p className="text-ink-500 mt-1.5 text-sm font-medium">Questions routed to you or others for expert review.</p>
        </div>
        <div className="flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="status-pill bg-amber-50 text-amber-700 border-amber-200 text-xs">
              <Clock size={12} /> {pendingCount} pending
            </span>
          )}
          {inReviewCount > 0 && (
            <span className="status-pill bg-sky-50 text-sky-700 border-sky-200 text-xs">
              <TrendingUp size={12} /> {inReviewCount} in review
            </span>
          )}
          <button onClick={loadAssignments} className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 bg-white border border-ink-200 rounded-xl transition-colors shadow-card" title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* Tabs + filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card">
          {tabItems.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-xs px-4 py-2 rounded-lg font-bold transition-all ${
                tab === t.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card">
          <button onClick={() => setStatusFilter('all')}
            className={`text-xs px-3 py-2 rounded-lg font-bold transition-all ${
              statusFilter === 'all' ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
            }`}>All</button>
          {FILTERS.map((s) => (
            <button key={s} onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={`text-xs px-3 py-2 rounded-lg font-bold transition-all ${
                statusFilter === s ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
              }`}>
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-ink-400 text-sm gap-2 font-medium">
          <RefreshCw size={16} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-24 space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-white border border-ink-100 shadow-card flex items-center justify-center mx-auto">
            <Inbox size={28} className="text-ink-300" />
          </div>
          <div>
            <p className="font-bold text-ink-700">
              {tab === 'mine' ? 'No questions assigned to you' : tab === 'sent' ? 'No questions sent for review' : 'No assignments yet'}
            </p>
            <p className="text-sm text-ink-400 mt-1 font-medium">
              Assignments appear here when questions are routed during RFI review.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <AssignmentCard
              key={a.id}
              assignment={a}
              isOwn={a.assignedTo === userId}
              tab={tab}
              onStatusChange={handleStatusChange}
              onNotesUpdate={handleNotesUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
