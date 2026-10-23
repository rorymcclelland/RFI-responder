import { useState, useEffect } from 'react';
import { Plus, Search, X, Briefcase, TrendingUp, CheckCircle2, XCircle, Clock, RefreshCw, ArrowRight, FileSpreadsheet, Check, Trash2, ChevronDown, Pencil } from 'lucide-react';
import { Opportunity, OpportunityStatus } from './types';
import { supabase } from './lib/supabase';

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
            title={`${c.displayName}${c.jobTitle ? ` — ${c.jobTitle}` : ''}`}
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

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<OpportunityStatus, {
  label: string;
  icon: React.ReactNode;
  dot: string;
  pill: string;
  cardAccent: string;
}> = {
  new:         { label: 'New',         icon: <Clock size={12} />,        dot: 'bg-sky-400',     pill: 'bg-sky-50 text-sky-700 border-sky-200',           cardAccent: 'border-l-sky-300' },
  in_progress: { label: 'In Progress', icon: <TrendingUp size={12} />,   dot: 'bg-amber-400',   pill: 'bg-amber-50 text-amber-700 border-amber-200',     cardAccent: 'border-l-amber-300' },
  won:         { label: 'Won',         icon: <CheckCircle2 size={12} />, dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', cardAccent: 'border-l-emerald-400' },
  lost:        { label: 'Lost',        icon: <XCircle size={12} />,      dot: 'bg-ink-300',     pill: 'bg-ink-50 text-ink-500 border-ink-200',            cardAccent: 'border-l-ink-200' },
};

const ALL_STATUSES: OpportunityStatus[] = ['new', 'in_progress', 'won', 'lost'];

// ─── Create modal ──────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (opp: Opportunity) => void }) {
  const [name, setName] = useState('');
  const [status, setStatus] = useState<OpportunityStatus>('new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true);
    // created_by and owner_id default to the signed-in user in the database.
    const { data, error: dbErr } = await supabase
      .from('opportunities')
      .insert({ name: name.trim(), status })
      .select()
      .maybeSingle();
    if (dbErr || !data) { setError('Failed to create opportunity.'); setSaving(false); return; }
    onCreate({ id: data.id, name: data.name, status: data.status, ownerId: data.owner_id, createdAt: data.created_at, updatedAt: data.updated_at });
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-modal w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-ink-900 rounded-xl flex items-center justify-center">
              <Briefcase size={18} className="text-white" />
            </div>
            <h3 className="font-bold text-ink-900 text-base">New Opportunity</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center">
            <X size={16} className="text-ink-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-bold text-ink-600 mb-2 uppercase tracking-wide">
              Opportunity Name <span className="text-coral-500">*</span>
            </label>
            <input
              autoFocus type="text" value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Acme Corp Security RFI 2026"
              className="input"
            />
            {error && <p className="text-xs text-coral-600 mt-1.5 font-medium">{error}</p>}
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-600 mb-2 uppercase tracking-wide">Initial Status</label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_STATUSES.map((s) => {
                const cfg = STATUS_CONFIG[s];
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-semibold transition-all ${
                      status === s
                        ? 'border-ink-900 bg-ink-900 text-white'
                        : 'border-ink-200 text-ink-600 hover:border-ink-300 hover:bg-ink-50'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === s ? 'bg-white' : cfg.dot}`} />
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink-100 rounded-b-3xl bg-ink-50">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={handleCreate} disabled={saving || !name.trim()} className="btn-primary disabled:opacity-40">
            {saving ? 'Creating…' : 'Create'}
            {!saving && <ArrowRight size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Opportunity card ──────────────────────────────────────────────────────────

function OpportunityCard({
  opp, sessionCount, canEdit, canDelete, onOpen, onRename, onStatusChange, onDelete,
}: {
  opp: Opportunity; sessionCount: number; canEdit: boolean; canDelete: boolean;
  onOpen: () => void; onRename: (name: string) => void;
  onStatusChange: (s: OpportunityStatus) => void; onDelete: () => void;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(opp.name);
  const cfg = STATUS_CONFIG[opp.status];

  const commitRename = () => {
    if (editVal.trim() && editVal.trim() !== opp.name) onRename(editVal.trim());
    setEditing(false);
  };

  return (
    <div
      onClick={!editing && !statusOpen && !confirmDelete ? onOpen : undefined}
      className={`group bg-white rounded-2xl border border-ink-100 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-150 cursor-pointer overflow-hidden border-l-4 ${cfg.cardAccent}`}
    >
      <div className="p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
                  className="input py-1.5 text-sm font-bold flex-1"
                />
                <button onClick={commitRename} className="w-7 h-7 bg-ink-900 text-white rounded-lg flex items-center justify-center hover:bg-ink-700 transition-colors flex-shrink-0">
                  <Check size={13} />
                </button>
                <button onClick={() => setEditing(false)} className="w-7 h-7 border border-ink-200 rounded-lg flex items-center justify-center hover:bg-ink-50 transition-colors flex-shrink-0">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-ink-900 truncate leading-tight">{opp.name}</h3>
                {canEdit && <button
                  onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  className="opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-all flex-shrink-0"
                  title="Rename"
                >
                  <Pencil size={12} />
                </button>}
              </div>
            )}
          </div>

          {/* Status badge */}
          <div className="relative flex-shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => canEdit && setStatusOpen((o) => !o)}
              disabled={!canEdit}
              title={canEdit ? 'Change status' : 'Only the owner or an admin can change the status'}
              className={`status-pill ${cfg.pill} gap-1.5 disabled:cursor-default`}
            >
              {cfg.icon}
              {cfg.label}
              {canEdit && <ChevronDown size={10} className={`transition-transform ${statusOpen ? 'rotate-180' : ''}`} />}
            </button>
            {statusOpen && (
              <div className="absolute right-0 top-9 bg-white border border-ink-200 rounded-2xl shadow-modal z-20 w-44 py-1.5 overflow-hidden">
                {ALL_STATUSES.map((s) => {
                  const sc = STATUS_CONFIG[s];
                  return (
                    <button
                      key={s}
                      onClick={() => { onStatusChange(s); setStatusOpen(false); }}
                      className={`flex items-center gap-2.5 w-full px-4 py-2.5 text-xs font-semibold transition-colors ${
                        s === opp.status ? 'bg-ink-50 text-ink-900' : 'text-ink-600 hover:bg-ink-50'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sc.dot}`} />
                      {sc.label}
                      {s === opp.status && <Check size={12} className="ml-auto text-ink-500" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-ink-400 font-medium">
          <span className="flex items-center gap-1.5">
            <FileSpreadsheet size={13} className="text-ink-300" />
            {sessionCount} session{sessionCount !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={11} className="text-ink-300" />
            {new Date(opp.createdAt).toLocaleDateString()}
          </span>

          {/* Delete: admins only, for responses created in error */}
          {canDelete && <div className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-coral-600 font-semibold text-xs">Delete?</span>
                <button onClick={onDelete} className="px-2 py-1 text-2xs font-black bg-coral-500 text-white rounded-lg hover:bg-coral-600 transition-colors">Yes</button>
                <button onClick={() => setConfirmDelete(false)} className="px-2 py-1 text-2xs font-bold text-ink-500 border border-ink-200 rounded-lg hover:bg-ink-50 transition-colors">No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center text-ink-300 hover:text-coral-500 hover:bg-coral-50 rounded-lg transition-all"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>}
        </div>

        <div className="mt-3 pt-3 border-t border-ink-50">
          <ContributorAvatars opportunityId={opp.id} />
        </div>
      </div>

      {/* Open CTA */}
      {!confirmDelete && !editing && (
        <div className="px-5 pb-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-400 group-hover:text-ink-700 transition-colors">
            Open workspace <ArrowRight size={12} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  isAdmin: boolean;
  onSelectOpportunity: (opp: Opportunity) => void;
  onImportKB: () => void;
}

export default function OpportunitiesDashboard({ currentUserId, isAdmin, onSelectOpportunity, onImportKB }: Props) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OpportunityStatus | 'all'>('all');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadOpportunities(); }, []);

  async function loadOpportunities() {
    setLoading(true);
    const { data } = await supabase.from('opportunities').select('*').order('updated_at', { ascending: false });
    if (data) {
      setOpportunities(data.map((r) => ({
        id: r.id, name: r.name, status: r.status, ownerId: r.owner_id ?? null,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })));
      const ids = data.map((r) => r.id);
      if (ids.length > 0) {
        const { data: sessions } = await supabase.from('rfi_sessions').select('opportunity_id').in('opportunity_id', ids);
        const counts: Record<string, number> = {};
        for (const s of sessions ?? []) {
          if (s.opportunity_id) counts[s.opportunity_id] = (counts[s.opportunity_id] ?? 0) + 1;
        }
        setSessionCounts(counts);
      }
    }
    setLoading(false);
  }

  const handleCreated = (opp: Opportunity) => {
    setOpportunities((prev) => [opp, ...prev]);
    setShowCreate(false);
    onSelectOpportunity(opp);
  };

  const handleRename = async (id: string, name: string) => {
    await supabase.from('opportunities').update({ name }).eq('id', id);
    setOpportunities((prev) => prev.map((o) => o.id === id ? { ...o, name } : o));
  };

  const handleStatusChange = async (id: string, status: OpportunityStatus) => {
    await supabase.from('opportunities').update({ status }).eq('id', id);
    setOpportunities((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('opportunities').delete().eq('id', id);
    setOpportunities((prev) => prev.filter((o) => o.id !== id));
    setSessionCounts((prev) => { const next = { ...prev }; delete next[id]; return next; });
  };

  const filtered = opportunities.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (search) return o.name.toLowerCase().includes(search.toLowerCase());
    return true;
  });

  const counts = {
    all: opportunities.length,
    new: opportunities.filter((o) => o.status === 'new').length,
    in_progress: opportunities.filter((o) => o.status === 'in_progress').length,
    won: opportunities.filter((o) => o.status === 'won').length,
    lost: opportunities.filter((o) => o.status === 'lost').length,
  };

  return (
    <>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
          <div>
            <h1 className="text-3xl font-black text-ink-900 tracking-tight">Opportunities</h1>
            <p className="text-ink-500 mt-1.5 text-sm font-medium">
              Each opportunity holds RFI sessions, with drafts written from the knowledge base for a person to review.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={onImportKB} className="btn-ghost text-sm">
              <Plus size={15} /> Import KB
            </button>
            <button onClick={() => setShowCreate(true)} className="btn-primary text-sm">
              <Plus size={15} /> New Opportunity
            </button>
          </div>
        </div>

        {/* Status stat tiles */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {ALL_STATUSES.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(active ? 'all' : s)}
                className={`p-5 rounded-2xl border text-left transition-all duration-150 ${
                  active
                    ? 'bg-ink-900 border-ink-900 shadow-card-hover'
                    : 'bg-white border-ink-100 shadow-card hover:shadow-card-hover hover:-translate-y-0.5'
                }`}
              >
                <div className={`flex items-center gap-1.5 text-xs font-bold mb-2 uppercase tracking-wide ${active ? 'text-white/60' : 'text-ink-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${active ? 'bg-white/50' : cfg.dot}`} />
                  {cfg.label}
                </div>
                <p className={`text-3xl font-black leading-none ${active ? 'text-white' : 'text-ink-900'}`}>{counts[s]}</p>
              </button>
            );
          })}
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              type="text" placeholder="Search opportunities…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex bg-white border border-ink-200 rounded-xl p-1 gap-0.5 shadow-card">
            {(['all', ...ALL_STATUSES] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                  statusFilter === s ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-50'
                }`}
              >
                {s === 'in_progress' ? 'Active' : s === 'all' ? 'All' : STATUS_CONFIG[s].label}
                <span className="ml-1 opacity-60">({counts[s]})</span>
              </button>
            ))}
          </div>

          <button onClick={loadOpportunities} className="w-9 h-9 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-white border border-ink-200 rounded-xl transition-colors shadow-card" title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24 text-ink-400 text-sm gap-2 font-medium">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-white border border-ink-100 shadow-card flex items-center justify-center mx-auto">
              <Briefcase size={28} className="text-ink-300" />
            </div>
            <div>
              <p className="font-bold text-ink-700 text-base">
                {opportunities.length === 0 ? 'No opportunities yet' : 'No results found'}
              </p>
              <p className="text-sm text-ink-400 mt-1">
                {opportunities.length === 0 ? 'Create your first to get started.' : 'Try adjusting your search or filter.'}
              </p>
            </div>
            {opportunities.length === 0 && (
              <button onClick={() => setShowCreate(true)} className="btn-primary mx-auto">
                <Plus size={15} /> Create First Opportunity
              </button>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((opp) => (
              <OpportunityCard
                key={opp.id}
                opp={opp}
                sessionCount={sessionCounts[opp.id] ?? 0}
                canEdit={isAdmin || opp.ownerId === currentUserId}
                canDelete={isAdmin}
                onOpen={() => onSelectOpportunity(opp)}
                onRename={(name) => handleRename(opp.id, name)}
                onStatusChange={(s) => handleStatusChange(opp.id, s)}
                onDelete={() => handleDelete(opp.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
