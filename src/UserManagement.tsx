import { useState, useEffect } from 'react';
import { Users, Tag, X, Shield, Search, ChevronDown, Briefcase, Building2, SlidersHorizontal } from 'lucide-react';
import { supabase } from './lib/supabase';
import { UserProfile } from './types';

const SUGGESTED_TAGS = [
  'encryption', 'data security', 'AES-256', 'TLS', 'key management',
  'compliance', 'SOC 2', 'ISO 27001', 'GDPR', 'HIPAA', 'CCPA',
  'access control', 'authentication', 'MFA', 'RBAC', 'SSO', 'identity',
  'privileged access', 'zero trust',
  'incident response', 'security operations', 'SIEM', 'forensics',
  'threat detection', 'SOC', 'monitoring',
  'vulnerability management', 'penetration testing', 'patch management',
  'network security', 'firewall', 'VPN',
  'cloud security', 'AWS', 'Azure', 'GCP',
  'application security', 'OWASP', 'SDLC', 'code review',
  'physical security', 'data center', 'business continuity', 'DR',
  'risk management', 'governance', 'audit', 'policy',
  'data privacy', 'data classification', 'data retention',
];

// ─── Tag category colours ──────────────────────────────────────────────────────

const TAG_CATEGORIES: { pattern: RegExp; classes: string }[] = [
  { pattern: /^(encryption|AES-256|TLS|key management|data security|data privacy|data classification|data retention)$/i,
    classes: 'bg-sky-50 text-sky-700 border-sky-200' },
  { pattern: /^(SOC 2|ISO 27001|GDPR|HIPAA|CCPA|compliance|audit|policy|governance|risk management)$/i,
    classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  { pattern: /^(access control|authentication|MFA|RBAC|SSO|identity|privileged access|zero trust)$/i,
    classes: 'bg-ink-100 text-ink-700 border-ink-200' },
  { pattern: /^(incident response|security operations|SIEM|forensics|threat detection|SOC|monitoring)$/i,
    classes: 'bg-rose-50 text-rose-700 border-rose-200' },
  { pattern: /^(vulnerability management|penetration testing|patch management|application security|OWASP|SDLC|code review)$/i,
    classes: 'bg-orange-50 text-orange-700 border-orange-200' },
  { pattern: /^(network security|firewall|VPN|physical security|data center|business continuity|DR)$/i,
    classes: 'bg-ink-50 text-ink-600 border-ink-200' },
  { pattern: /^(cloud security|AWS|Azure|GCP)$/i,
    classes: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
];

function tagClasses(tag: string): string {
  for (const { pattern, classes } of TAG_CATEGORIES) {
    if (pattern.test(tag)) return classes;
  }
  return 'bg-emerald-50 text-emerald-700 border-emerald-200';
}

// ─── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  'bg-ink-200 text-ink-700', 'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700',
  'bg-rose-100 text-rose-700',
];

function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

// ─── Tag editor ────────────────────────────────────────────────────────────────

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = SUGGESTED_TAGS.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setInput(''); setShowSuggestions(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 bg-ink-900 text-white rounded-full text-xs font-bold">
            <Tag size={9} />{t}
            <button onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:opacity-60 ml-0.5 transition-opacity"><X size={10} /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-xs text-ink-400 italic font-medium">No expertise tags yet</span>}
      </div>
      <div className="relative">
        <input
          type="text" value={input}
          placeholder="Add tag… (type or pick from suggestions)"
          onChange={(e) => { setInput(e.target.value); setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && input.trim()) { e.preventDefault(); addTag(input); }
          }}
          className="input text-xs"
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-ink-200 rounded-2xl shadow-modal max-h-44 overflow-y-auto">
            {suggestions.slice(0, 20).map((s) => (
              <button key={s} onMouseDown={() => addTag(s)}
                className="flex items-center gap-2 w-full px-4 py-2.5 text-xs text-ink-700 hover:bg-ink-50 hover:text-ink-900 transition-colors font-medium">
                <Tag size={10} className="text-ink-400" />{s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Edit drawer ───────────────────────────────────────────────────────────────

function EditUserDrawer({ user, currentUserId, isAdmin, onClose, onSaved }: {
  user: UserProfile; currentUserId: string; isAdmin: boolean;
  onClose: () => void; onSaved: (u: UserProfile) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [jobTitle, setJobTitle]       = useState(user.jobTitle);
  const [department, setDepartment]   = useState(user.department);
  const [tags, setTags]               = useState<string[]>(user.expertiseTags);
  const [isAdminVal, setIsAdminVal]   = useState(user.isAdmin);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const canEdit = isAdmin || user.id === currentUserId;

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true); setError('');
    const { error: err } = await supabase.from('user_profiles').update({
      display_name: displayName.trim(), job_title: jobTitle.trim(),
      department: department.trim(), expertise_tags: tags, is_admin: isAdminVal,
    }).eq('id', user.id);
    if (err) { setError(err.message); setSaving(false); return; }
    onSaved({ ...user, displayName: displayName.trim(), jobTitle: jobTitle.trim(), department: department.trim(), expertiseTags: tags, isAdmin: isAdminVal });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-end animate-fade-in">
      <div className="bg-white h-full w-full max-w-md shadow-modal flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-base ${avatarColor(user.displayName)}`}>
              {user.displayName.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-ink-900">{user.displayName}</h3>
              <p className="text-xs text-ink-500 font-medium">{user.jobTitle || 'No title set'}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center">
            <X size={15} className="text-ink-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid gap-4">
            <div>
              <label className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">Display Name</label>
              <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} disabled={!canEdit} className="input disabled:bg-ink-50 disabled:text-ink-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">Job Title</label>
              <input type="text" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={!canEdit}
                placeholder="e.g. Security Engineer" className="input disabled:bg-ink-50 disabled:text-ink-400" />
            </div>
            <div>
              <label className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">Department</label>
              <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={!canEdit}
                placeholder="e.g. Engineering" className="input disabled:bg-ink-50 disabled:text-ink-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-ink-600 mb-1 uppercase tracking-wide">Expertise & Specialisms</label>
            <p className="text-xs text-ink-400 mb-2.5 font-medium">Used to recommend this person for relevant RFI questions.</p>
            {canEdit ? <TagEditor tags={tags} onChange={setTags} /> : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <span key={t} className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-full text-xs font-bold ${tagClasses(t)}`}>
                    <Tag size={9} />{t}
                  </span>
                ))}
                {tags.length === 0 && <span className="text-xs text-ink-400 italic font-medium">No tags</span>}
              </div>
            )}
          </div>

          {isAdmin && (
            <div className="flex items-center justify-between p-4 bg-ink-50 rounded-2xl border border-ink-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-ink-200 rounded-xl flex items-center justify-center">
                  <Shield size={16} className="text-ink-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-ink-800">Admin Access</p>
                  <p className="text-xs text-ink-400 font-medium">Can manage users and see all assignments</p>
                </div>
              </div>
              <button
                onClick={() => { if (user.id !== currentUserId) setIsAdminVal((a) => !a); }}
                disabled={user.id === currentUserId}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${isAdminVal ? 'bg-ink-900' : 'bg-ink-200'} ${user.id === currentUserId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isAdminVal ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          )}

          {error && <p className="text-xs text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">{error}</p>}
        </div>

        {canEdit && (
          <div className="px-6 py-4 border-t border-ink-100 bg-ink-50 flex items-center justify-end gap-3">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={handleSave} disabled={saving || !displayName.trim()} className="btn-primary disabled:opacity-40">
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User card ─────────────────────────────────────────────────────────────────

function UserCard({ user, currentUserId, isAdmin, onEdit }: {
  user: UserProfile; currentUserId: string; isAdmin: boolean; onEdit: () => void;
}) {
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const visibleTags = tagsExpanded ? user.expertiseTags : user.expertiseTags.slice(0, 6);

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-card p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-150">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-base flex-shrink-0 ${avatarColor(user.displayName)}`}>
            {user.displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-bold text-ink-900">{user.displayName}</p>
              {user.id === currentUserId && (
                <span className="text-2xs text-ink-400 font-bold">(you)</span>
              )}
              {user.isAdmin && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-ink-900 text-white rounded-full text-2xs font-black flex-shrink-0">
                  <Shield size={9} />Admin
                </span>
              )}
            </div>
            {user.jobTitle && (
              <p className="text-xs font-semibold text-ink-600 mt-0.5 flex items-center gap-1">
                <Briefcase size={10} className="text-ink-400" />{user.jobTitle}
              </p>
            )}
            {user.department && (
              <p className="text-xs text-ink-400 flex items-center gap-1 mt-0.5 font-medium">
                <Building2 size={10} />{user.department}
              </p>
            )}
          </div>
        </div>
        {(isAdmin || user.id === currentUserId) && (
          <button onClick={onEdit} className="btn-ghost text-xs py-1.5 flex-shrink-0">
            Edit
          </button>
        )}
      </div>

      {user.expertiseTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center pt-3 border-t border-ink-50">
          {visibleTags.map((t) => (
            <span key={t} className={`inline-flex items-center gap-1 px-2.5 py-1 border rounded-full text-2xs font-bold ${tagClasses(t)}`}>
              <Tag size={8} />{t}
            </span>
          ))}
          {user.expertiseTags.length > 6 && (
            <button
              onClick={() => setTagsExpanded((v) => !v)}
              className="flex items-center gap-0.5 text-xs text-ink-500 hover:text-ink-800 font-bold transition-colors"
            >
              {tagsExpanded ? 'Show less' : `+${user.expertiseTags.length - 6} more`}
              <ChevronDown size={11} className={`transition-transform ${tagsExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

interface Props { currentUserId: string; isAdmin: boolean; }

export default function UserManagement({ currentUserId, isAdmin }: Props) {
  const [users, setUsers]             = useState<UserProfile[]>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [deptFilter, setDeptFilter]   = useState('');
  const [tagFilter, setTagFilter]     = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);

  useEffect(() => { loadUsers(); }, []);

  async function loadUsers() {
    setLoading(true);
    const { data } = await supabase.from('user_profiles').select('*').order('display_name');
    if (data) {
      setUsers(data.map((r) => ({
        id: r.id, displayName: r.display_name, jobTitle: r.job_title ?? '',
        department: r.department ?? '', expertiseTags: r.expertise_tags ?? [],
        isAdmin: r.is_admin, createdAt: r.created_at,
      })));
    }
    setLoading(false);
  }

  const departments = [...new Set(users.map((u) => u.department).filter(Boolean))].sort();
  const allTags     = [...new Set(users.flatMap((u) => u.expertiseTags))].sort();

  const filtered = users.filter((u) => {
    if (search && !u.displayName.toLowerCase().includes(search.toLowerCase()) &&
        !u.jobTitle.toLowerCase().includes(search.toLowerCase())) return false;
    if (deptFilter && u.department !== deptFilter) return false;
    if (tagFilter && !u.expertiseTags.includes(tagFilter)) return false;
    return true;
  });

  const activeFilterCount = [deptFilter, tagFilter].filter(Boolean).length;

  return (
    <>
      {editingUser && (
        <EditUserDrawer
          user={editingUser} currentUserId={currentUserId} isAdmin={isAdmin}
          onClose={() => setEditingUser(null)}
          onSaved={(updated) => { setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u)); setEditingUser(null); }}
        />
      )}

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-10 space-y-7">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-ink-900 tracking-tight">Team</h1>
            <p className="text-ink-500 mt-1.5 text-sm font-medium">Browse members, roles, and areas of expertise.</p>
          </div>
          <div className="text-xs font-bold text-ink-500 bg-white border border-ink-200 shadow-card rounded-xl px-3.5 py-2 flex items-center gap-1.5">
            <Users size={13} />{users.length} member{users.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Department pills */}
        {departments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {departments.map((dept) => {
              const count = users.filter((u) => u.department === dept).length;
              const active = deptFilter === dept;
              return (
                <button
                  key={dept}
                  onClick={() => setDeptFilter(active ? '' : dept)}
                  className={`flex items-center gap-1.5 text-xs px-3.5 py-2 rounded-xl border font-bold transition-all ${
                    active ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-600 border-ink-200 shadow-card hover:border-ink-400 hover:text-ink-900'
                  }`}
                >
                  <Building2 size={11} />{dept}
                  <span className="opacity-60">({count})</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Search + filter */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              type="text" placeholder="Search by name or job title…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors">
                <X size={13} />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm border rounded-xl font-bold transition-all ${
              showFilters || activeFilterCount > 0
                ? 'bg-ink-900 border-ink-900 text-white'
                : 'bg-white border-ink-200 text-ink-600 shadow-card hover:border-ink-400'
            }`}
          >
            <SlidersHorizontal size={14} />
            Filter by specialism
            {activeFilterCount > 0 && (
              <span className={`text-2xs rounded-full w-5 h-5 flex items-center justify-center font-black ${showFilters ? 'bg-white/20' : 'bg-ink-900 text-white'}`}>
                {activeFilterCount}
              </span>
            )}
          </button>

          {(deptFilter || tagFilter || search) && (
            <button
              onClick={() => { setSearch(''); setDeptFilter(''); setTagFilter(''); }}
              className="text-xs text-ink-500 hover:text-ink-800 flex items-center gap-1 font-bold transition-colors"
            >
              <X size={11} />Clear all
            </button>
          )}
        </div>

        {/* Specialism filter panel */}
        {showFilters && (
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">Filter by Specialism</p>
              {tagFilter && (
                <button onClick={() => setTagFilter('')} className="text-xs text-ink-500 hover:text-ink-800 flex items-center gap-1 font-bold transition-colors">
                  <X size={10} />Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {allTags.map((t) => {
                const count = users.filter((u) => u.expertiseTags.includes(t)).length;
                const active = tagFilter === t;
                return (
                  <button
                    key={t}
                    onClick={() => setTagFilter(active ? '' : t)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-2xs font-bold border transition-all ${
                      active ? 'bg-ink-900 text-white border-ink-900' : `${tagClasses(t)} hover:opacity-80`
                    }`}
                  >
                    <Tag size={8} />{t}
                    <span className="opacity-60">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Count when filtering */}
        {(search || deptFilter || tagFilter) && !loading && (
          <p className="text-xs text-ink-500 font-medium">
            Showing <strong className="text-ink-800">{filtered.length}</strong> of {users.length} members
            {tagFilter && <> with specialism <strong className="text-ink-800">{tagFilter}</strong></>}
            {deptFilter && <> in <strong className="text-ink-800">{deptFilter}</strong></>}
          </p>
        )}

        {/* Grid */}
        {loading ? (
          <div className="py-24 text-center text-ink-400 text-sm font-medium">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-24 text-center space-y-3">
            <Users size={32} className="text-ink-200 mx-auto" />
            <p className="text-sm text-ink-500 font-semibold">No team members match your filters</p>
            <button onClick={() => { setSearch(''); setDeptFilter(''); setTagFilter(''); }}
              className="text-xs text-ink-600 hover:text-ink-900 font-bold underline transition-colors">Clear filters</button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((u) => (
              <UserCard key={u.id} user={u} currentUserId={currentUserId} isAdmin={isAdmin} onEdit={() => setEditingUser(u)} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
