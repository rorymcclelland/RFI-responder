import { useEffect, useState } from 'react';
import {
  AlertTriangle, Archive, ArrowRight, Briefcase, CalendarClock, Check, Clock, Pencil, Plus, RefreshCw, Search, Trash2, User, X,
} from 'lucide-react';
import { supabase } from './lib/supabase';
import { archiveResponse, createResponse, deleteResponse, loadOverview, updateResponse } from './lib/responses';
import type { Opportunity, ResponseOutcome, ResponseStage } from './types';

// ─── Avatar helpers ────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-ink-200 text-ink-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

interface ContributorProfile { id: string; displayName: string; jobTitle: string; }

function ContributorAvatars({ opportunityId }: { opportunityId: string }) {
  const [contributors, setContributors] = useState<ContributorProfile[]>([]);

  useEffect(() => {
    supabase
      .from('opportunity_contributors')
      .select('user_id, user_profiles(id, display_name, job_title)')
      .eq('opportunity_id', opportunityId)
      .then(({ data }) => {
        if (data) {
          setContributors(
            data
              .map((r) => {
                // Without generated database types supabase-js types an embedded row as an array,
                // although a many-to-one join returns a single object at runtime. Accept either.
                type ProfileRow = { id: string; display_name: string; job_title: string | null };
                const joined = r.user_profiles as unknown as ProfileRow | ProfileRow[] | null;
                const p = Array.isArray(joined) ? joined[0] ?? null : joined;
                return p ? { id: p.id, displayName: p.display_name, jobTitle: p.job_title ?? '' } : null;
              })
              .filter(Boolean) as ContributorProfile[]
          );
        }
      });
  }, [opportunityId]);

  if (contributors.length === 0) return null;

  const visible = contributors.slice(0, 4);
  const overflow = contributors.length - visible.length;

  return (
    <div className="flex items-center gap-2">
      <div className="flex -space-x-1.5">
        {visible.map((c) => (
          <div
            key={c.id}
            title={`${c.displayName}${c.jobTitle ? `, ${c.jobTitle}` : ''}`}
            className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-2xs font-black flex-shrink-0 ${avatarColor(c.displayName)}`}
          >
            {c.displayName.charAt(0).toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div className="w-6 h-6 rounded-full border-2 border-white bg-ink-100 flex items-center justify-center text-2xs font-bold text-ink-500 flex-shrink-0">
            +{overflow}
          </div>
        )}
      </div>
      <span className="text-2xs text-ink-400 font-medium">
        {contributors.length} contributor{contributors.length !== 1 ? 's' : ''}
      </span>
    </div>
  );
}

// ─── Stage ─────────────────────────────────────────────────────────────────────

const STAGE: Record<ResponseStage, { label: string; pill: string; accent: string }> = {
  new:       { label: 'New',       pill: 'bg-sky-50 text-sky-700 border-sky-200',             accent: 'border-l-sky-300' },
  in_review: { label: 'In review', pill: 'bg-amber-50 text-amber-700 border-amber-200',       accent: 'border-l-amber-300' },
  ready:     { label: 'Ready',     pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', accent: 'border-l-emerald-400' },
  exported:  { label: 'Exported',  pill: 'bg-ink-900 text-white border-ink-900',              accent: 'border-l-ink-700' },
  // Sprint 11 (S11-1): answers changed after the export was recorded; record it again.
  changed:   { label: 'Changed since export', pill: 'bg-amber-50 text-amber-800 border-amber-300', accent: 'border-l-amber-400' },
  archived:  { label: 'Archived',  pill: 'bg-ink-50 text-ink-500 border-ink-200',             accent: 'border-l-ink-200' },
};
const OUTCOME_LABEL: Record<ResponseOutcome, string> = { won: 'Won', lost: 'Lost', withdrawn: 'Withdrawn' };

const formatDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// ─── Dialogs ───────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div role="dialog" aria-label={title} className="bg-white rounded-3xl shadow-modal w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <h3 className="font-bold text-ink-900 text-base">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center">
            <X size={16} className="text-ink-500" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const create = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    try {
      onCreated(await createResponse(supabase, name.trim(), due || null));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };
  return (
    <Modal title="New Opportunity" onClose={onClose}>
      <div className="p-6 space-y-5">
        <div>
          <label htmlFor="new-name" className="block text-xs font-bold text-ink-600 mb-2 uppercase tracking-wide">Name <span className="text-coral-500">*</span></label>
          <input id="new-name" autoFocus value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="e.g. Acme Corp Security RFI 2026" className="input" />
        </div>
        <div>
          <label htmlFor="new-due" className="block text-xs font-bold text-ink-600 mb-2 uppercase tracking-wide">Due date</label>
          <input id="new-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input" />
        </div>
        {error && <p role="alert" className="text-xs text-coral-600 font-medium">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink-100 rounded-b-3xl bg-ink-50">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={create} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-40">
          {saving ? 'Creating…' : 'Create'} {!saving && <ArrowRight size={15} />}
        </button>
      </div>
    </Modal>
  );
}

function ArchiveModal({ opp, onClose, onDone }: { opp: Opportunity; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<ResponseOutcome>(opp.exportedAt ? 'won' : 'withdrawn');
  const [error, setError] = useState('');
  const run = async () => {
    try {
      await archiveResponse(supabase, opp.id, outcome);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title={`Archive ${opp.name}`} onClose={onClose}>
      <div className="p-6 space-y-4">
        <p className="text-sm text-ink-600">Archived responses are kept as a record and can no longer be changed.</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Outcome">
          {(['won', 'lost', 'withdrawn'] as ResponseOutcome[]).map((o) => {
            const disabled = o !== 'withdrawn' && !opp.exportedAt;
            return (
              <button key={o} role="radio" aria-checked={outcome === o} disabled={disabled} onClick={() => setOutcome(o)}
                title={disabled ? 'Record the export first; a response never sent can only be withdrawn' : undefined}
                className={`px-3 py-2.5 rounded-xl border text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                  outcome === o ? 'border-ink-900 bg-ink-900 text-white' : 'border-ink-200 text-ink-600 hover:bg-ink-50'}`}>
                {OUTCOME_LABEL[o]}
              </button>
            );
          })}
        </div>
        {error && <p role="alert" className="text-xs text-coral-600 font-medium">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink-100 rounded-b-3xl bg-ink-50">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={run} className="btn-primary"><Archive size={14} /> Archive</button>
      </div>
    </Modal>
  );
}

function DeleteModal({ opp, onClose, onDone }: { opp: Opportunity; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const run = async () => {
    try {
      await deleteResponse(supabase, opp.id, reason);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal title={`Delete ${opp.name}`} onClose={onClose}>
      <div className="p-6 space-y-4">
        <p className="text-sm text-ink-600">
          Deleting is only for responses created in error. It removes the response, its sessions and questions permanently,
          and is recorded in the audit log with your reason. To keep a finished response, archive it instead.
        </p>
        <label htmlFor="delete-reason" className="block text-xs font-bold text-ink-600 uppercase tracking-wide">Reason (at least 10 characters)</label>
        <textarea id="delete-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="input resize-none" />
        {error && <p role="alert" className="text-xs text-coral-600 font-medium">{error}</p>}
      </div>
      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink-100 rounded-b-3xl bg-ink-50">
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={run} disabled={reason.trim().length < 10} className="btn-primary bg-coral-600 hover:bg-coral-700 disabled:opacity-40">
          <Trash2 size={14} /> Delete permanently
        </button>
      </div>
    </Modal>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────────

function ResponseCard({ opp, canEdit, canDelete, onOpen, onChanged, onArchive, onDelete, onError }: {
  opp: Opportunity; canEdit: boolean; canDelete: boolean;
  onOpen: () => void; onChanged: () => void; onArchive: () => void; onDelete: () => void; onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState<'name' | 'due' | null>(null);
  const [name, setName] = useState(opp.name);
  const [due, setDue] = useState(opp.dueDate ?? '');
  const stage = STAGE[opp.stage];
  const pct = opp.total ? Math.round((opp.decided / opp.total) * 100) : 0;
  const editable = canEdit && !opp.archivedAt;

  const save = async (patch: { name?: string; dueDate?: string | null }) => {
    setEditing(null);
    try {
      await updateResponse(supabase, opp.id, patch);
      onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  return (
    <div onClick={editing ? undefined : onOpen}
      className={`group bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-150 cursor-pointer overflow-hidden border-l-4 ${stage.accent}`}>
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            {editing === 'name' ? (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save({ name: name.trim() }); if (e.key === 'Escape') setEditing(null); }}
                  className="input py-1.5 text-sm font-bold flex-1" />
                <button aria-label="Save name" onClick={() => name.trim() && save({ name: name.trim() })} className="w-7 h-7 bg-ink-900 text-white rounded-lg flex items-center justify-center"><Check size={13} /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-ink-900 truncate leading-tight">{opp.name}</h3>
                {editable && (
                  <button aria-label="Rename" onClick={(e) => { e.stopPropagation(); setEditing('name'); }}
                    className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-all flex-shrink-0">
                    <Pencil size={12} />
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-ink-400 font-medium mt-1 flex items-center gap-1.5">
              <User size={11} /> {opp.ownerName ?? 'No owner'}
            </p>
          </div>
          <span className={`status-pill flex-shrink-0 ${stage.pill}`}>
            {stage.label}{opp.outcome ? `: ${OUTCOME_LABEL[opp.outcome]}` : ''}
          </span>
        </div>

        {(opp.overdue || opp.atRisk) && (
          <div className="flex flex-wrap gap-1.5">
            {opp.overdue && <span className="status-pill bg-coral-50 text-coral-700 border-coral-200"><AlertTriangle size={11} /> Overdue</span>}
            {opp.atRisk && <span className="status-pill bg-amber-50 text-amber-800 border-amber-200"><AlertTriangle size={11} /> At risk</span>}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-ink-500 mb-1">
            <span>{opp.decided} of {opp.total} decided</span>
            {opp.gatedPending > 0 && <span className="text-coral-600">{opp.gatedPending} pricing or legal open</span>}
          </div>
          <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-ink-400 font-medium" onClick={(e) => e.stopPropagation()}>
          {editing === 'due' ? (
            <span className="flex items-center gap-1.5">
              <input aria-label="Due date" type="date" autoFocus value={due} onChange={(e) => setDue(e.target.value)} className="input py-1 text-xs" />
              <button aria-label="Save due date" onClick={() => save({ dueDate: due || null })} className="w-6 h-6 bg-ink-900 text-white rounded-lg flex items-center justify-center"><Check size={11} /></button>
            </span>
          ) : (
            <button disabled={!editable} onClick={() => setEditing('due')} className="flex items-center gap-1.5 disabled:cursor-default hover:text-ink-700"
              title={editable ? 'Change the due date' : undefined}>
              <CalendarClock size={12} /> {opp.dueDate ? `Due ${formatDate(opp.dueDate)}` : editable ? 'Set a due date' : 'No due date'}
            </button>
          )}
          {opp.openAssignments > 0 && <span className="flex items-center gap-1"><Clock size={11} /> {opp.openAssignments} with experts</span>}
          <div className="ml-auto flex items-center gap-1">
            {editable && (
              <button aria-label="Archive" title="Archive with outcome" onClick={onArchive}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 flex items-center justify-center text-ink-300 hover:text-ink-700 hover:bg-ink-50 rounded-lg transition-all">
                <Archive size={13} />
              </button>
            )}
            {canDelete && (
              <button aria-label="Delete" title="Delete a response created in error" onClick={onDelete}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 flex items-center justify-center text-ink-300 hover:text-coral-500 hover:bg-coral-50 rounded-lg transition-all">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="pt-3 border-t border-ink-50"><ContributorAvatars opportunityId={opp.id} /></div>
      </div>
      <div className="px-5 pb-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-400 group-hover:text-ink-700 transition-colors">Open workspace <ArrowRight size={12} /></div>
      </div>
    </div>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onSelectOpportunity: (opp: Opportunity) => void;
  onImportKB: () => void;
}

type Tab = 'active' | 'archived';
const ACTIVE_STAGES: ResponseStage[] = ['new', 'in_review', 'ready', 'exported', 'changed'];

export default function OpportunitiesDashboard({ currentUserId, isAdmin, onSelectOpportunity, onImportKB }: Props) {
  const [responses, setResponses] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [stage, setStage] = useState<ResponseStage | 'all'>('all');
  const [mine, setMine] = useState(false);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<Opportunity | null>(null);
  const [deleting, setDeleting] = useState<Opportunity | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      setResponses(await loadOverview(supabase));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const inTab = responses.filter((r) => (tab === 'archived' ? r.archivedAt !== null : r.archivedAt === null));
  const visible = inTab.filter((r) =>
    (stage === 'all' || r.stage === stage) && (!mine || r.ownerId === currentUserId)
    && (!search || r.name.toLowerCase().includes(search.toLowerCase())));
  const active = responses.filter((r) => r.archivedAt === null);
  const tiles = [
    { label: 'In review', value: active.filter((r) => r.stage === 'in_review').length, onClick: () => { setTab('active'); setStage('in_review'); } },
    { label: 'Ready to export', value: active.filter((r) => r.stage === 'ready').length, onClick: () => { setTab('active'); setStage('ready'); } },
    { label: 'At risk', value: active.filter((r) => r.atRisk).length, warn: true },
    { label: 'Overdue', value: active.filter((r) => r.overdue).length, warn: true },
  ];

  return (
    <>
      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={async (id) => {
        setCreating(false);
        await reload();
        const created = (await loadOverview(supabase)).find((r) => r.id === id);
        if (created) onSelectOpportunity(created);
      }} />}
      {archiving && <ArchiveModal opp={archiving} onClose={() => setArchiving(null)} onDone={() => { setArchiving(null); reload(); }} />}
      {deleting && <DeleteModal opp={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); reload(); }} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div>
            <h1 className="text-3xl font-black text-ink-900 tracking-tight">Opportunities</h1>
            <p className="text-ink-500 mt-1.5 text-sm font-medium">
              Every response in flight, with its owner, due date and progress. Finished responses are archived with their outcome.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onImportKB} className="btn-ghost text-sm"><Plus size={15} /> Import KB</button>
            <button onClick={() => setCreating(true)} className="btn-primary text-sm"><Plus size={15} /> New Opportunity</button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tiles.map((t) => (
            <button key={t.label} onClick={t.onClick} disabled={!t.onClick}
              className="p-5 rounded-2xl border text-left bg-white border-ink-100 shadow-card enabled:hover:shadow-card-hover transition-all disabled:cursor-default">
              <div className="text-xs font-bold mb-2 uppercase tracking-wide text-ink-400">{t.label}</div>
              <p className={`text-3xl font-black leading-none ${t.warn && t.value > 0 ? 'text-coral-600' : 'text-ink-900'}`}>{t.value}</p>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card" role="tablist">
            {(['active', 'archived'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setStage('all'); }}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold ${tab === t ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-50'}`}>
                {t === 'active' ? `Active (${active.length})` : `Archived (${responses.length - active.length})`}
              </button>
            ))}
          </div>
          {tab === 'active' && (
            <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card">
              {(['all', ...ACTIVE_STAGES] as const).map((s) => (
                <button key={s} onClick={() => setStage(s)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-bold ${stage === s ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-50'}`}>
                  {s === 'all' ? 'All stages' : STAGE[s].label}
                </button>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-xs font-bold text-ink-600">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine only
          </label>
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input aria-label="Search opportunities" type="text" placeholder="Search opportunities…" value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-10" />
          </div>
          <button onClick={reload} aria-label="Refresh" className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-white border border-ink-200 rounded-xl shadow-card">
            <RefreshCw size={15} />
          </button>
        </div>

        {error && <div role="alert" className="text-sm text-coral-700 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">{error}</div>}

        {loading ? (
          <div className="flex items-center justify-center py-24 text-ink-400 text-sm gap-2 font-medium"><RefreshCw size={16} className="animate-spin" /> Loading…</div>
        ) : visible.length === 0 ? (
          <div className="text-center py-24 space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-white border border-ink-100 shadow-card flex items-center justify-center mx-auto"><Briefcase size={28} className="text-ink-300" /></div>
            <p className="font-bold text-ink-700 text-base">{responses.length === 0 ? 'No opportunities yet' : 'Nothing matches'}</p>
            {responses.length === 0 && <button onClick={() => setCreating(true)} className="btn-primary mx-auto"><Plus size={15} /> Create First Opportunity</button>}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((opp) => (
              <ResponseCard key={opp.id} opp={opp}
                canEdit={isAdmin || opp.ownerId === currentUserId}
                canDelete={isAdmin}
                onOpen={() => onSelectOpportunity(opp)}
                onChanged={reload}
                onArchive={() => setArchiving(opp)}
                onDelete={() => setDeleting(opp)}
                onError={setError}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
