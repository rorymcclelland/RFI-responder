import { useState, useEffect } from 'react';
import {
  Database, X, BookOpen, Tag, CheckCircle2,
  Plus, ChevronLeft, Briefcase,
  Inbox, Users, LogOut, Menu, Search, Sparkles, AlertTriangle,
} from 'lucide-react';
import { loadKnowledgeBase, importEntries, describeImport, indexNewEntries, type KbOrigin, type NewEntry } from './lib/knowledgeBase';
import { KnowledgeEntry, Opportunity, UserProfile } from './types';
import BulkUploadModal from './BulkUploadModal';
import RFIWorkspace from './RFIWorkspace';
import OpportunitiesDashboard from './OpportunitiesDashboard';
import AuthPage from './AuthPage';
import UserInbox from './UserInbox';
import UserManagement from './UserManagement';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';

// ─── KB Entry ─────────────────────────────────────────────────────────────────

function KBEntry({ entry }: { entry: KnowledgeEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-ink-100 rounded-2xl overflow-hidden hover:border-ink-200 transition-colors">
      <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xs font-bold text-ink-500 bg-ink-50 px-2 py-0.5 rounded-full border border-ink-100">
            {entry.id}
          </span>
          {entry.source && (
            <span className="text-2xs text-ink-400 flex items-center gap-1">
              <BookOpen size={9} />{entry.source}
            </span>
          )}
          <span className={`ml-auto text-ink-400 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}>
            <ChevronLeft size={13} className="rotate-180" />
          </span>
        </div>
        <p className="text-sm font-medium text-ink-800 leading-snug">{entry.question}</p>
        <div className="flex flex-wrap gap-1 mt-2.5">
          {entry.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 text-2xs text-ink-500 bg-ink-50 px-2 py-0.5 rounded-full border border-ink-100">
              <Tag size={8} />{tag}
            </span>
          ))}
        </div>
      </div>
      {expanded && (
        <div className="border-t border-ink-100 px-4 py-3 bg-ink-50 text-sm text-ink-600 leading-relaxed">
          {entry.answer}
        </div>
      )}
    </div>
  );
}

function KBModal({ entries, onClose, onBulkUpload }: { entries: KnowledgeEntry[]; onClose: () => void; onBulkUpload: () => void }) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? entries.filter(
        (e) =>
          e.question.toLowerCase().includes(search.toLowerCase()) ||
          e.answer.toLowerCase().includes(search.toLowerCase()) ||
          e.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      )
    : entries;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-modal w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-ink-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-ink-900 rounded-xl flex items-center justify-center flex-shrink-0">
              <Database size={18} className="text-white" />
            </div>
            <div>
              <h3 className="font-bold text-ink-900 text-base">Knowledge Base</h3>
              <p className="text-xs text-ink-400">{entries.length} entries</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBulkUpload}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink-700 border border-ink-200 rounded-xl hover:bg-ink-50 transition-colors"
            >
              <Plus size={12} /> Import Q&A
            </button>
            <button onClick={onClose} className="w-8 h-8 hover:bg-ink-100 rounded-xl transition-colors flex items-center justify-center">
              <X size={16} className="text-ink-500" />
            </button>
          </div>
        </div>
        <div className="px-6 py-4 border-b border-ink-100">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none" />
            <input
              type="text" placeholder="Search questions, answers, tags…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6 space-y-2.5">
          {filtered.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-ink-400">No entries match your search.</p>
            </div>
          ) : (
            filtered.map((entry) => <KBEntry key={entry.id} entry={entry} />)
          )}
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

type AppView = 'opportunities' | 'inbox' | 'users';

export default function App() {
  const [session, setSession]                     = useState<Session | null>(null);
  const [currentUser, setCurrentUser]             = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers]                   = useState<UserProfile[]>([]);
  const [authLoading, setAuthLoading]             = useState(true);
  const [kb, setKb]                               = useState<KnowledgeEntry[]>([]);
  const [showKBModal, setShowKBModal]             = useState(false);
  const [showBulkUpload, setShowBulkUpload]       = useState(false);
  const [toast, setToast]                         = useState<{ msg: string; tone: 'ok' | 'error' } | null>(null);
  const [activeOpportunity, setActiveOpportunity] = useState<Opportunity | null>(null);
  const [view, setView]                           = useState<AppView>('opportunities');
  const [navOpen, setNavOpen]                     = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) loadUserProfile(s.user.id);
      else setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        (async () => { await loadUserProfile(s.user.id); })();
      } else {
        setCurrentUser(null);
        setAllUsers([]);
      }
    });

    return () => subscription.unsubscribe();
    // Subscribe once on mount. loadUserProfile only calls state setters and Supabase,
    // so the first render's copy never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadUserProfile(userId: string) {
    setAuthLoading(true);
    const { data } = await supabase.from('user_profiles').select('*').eq('id', userId).maybeSingle();
    if (data) {
      setCurrentUser({
        id: data.id, displayName: data.display_name,
        jobTitle: data.job_title ?? '', department: data.department ?? '',
        expertiseTags: data.expertise_tags ?? [], isAdmin: data.is_admin,
        createdAt: data.created_at,
      });
    }
    await loadAllUsers();
    await refreshKB();
    setAuthLoading(false);
    // Fill any gaps in the meaning-based index (existing entries, or after a model change). Quiet unless it fails.
    void indexNewEntries().then((r) => {
      if (!r.ok) showToast(`Meaning-based search is unavailable (${r.reason}); matching will use keywords only.`, 'error');
    });
  }

  async function loadAllUsers() {
    const { data } = await supabase.from('user_profiles').select('*').order('display_name');
    if (data) {
      setAllUsers(data.map((r) => ({
        id: r.id, displayName: r.display_name,
        jobTitle: r.job_title ?? '', department: r.department ?? '',
        expertiseTags: r.expertise_tags ?? [], isAdmin: r.is_admin,
        createdAt: r.created_at,
      })));
    }
  }

  const showToast = (msg: string, tone: 'ok' | 'error' = 'ok') => {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), tone === 'error' ? 10000 : 5000);
  };

  const refreshKB = async () => {
    try {
      setKb(await loadKnowledgeBase());
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  /** Add entries through the database; returns whether anything was saved. */
  const addToKB = async (entries: NewEntry[], origin: KbOrigin, originRef: string): Promise<boolean> => {
    try {
      const result = await importEntries(entries, origin, originRef);
      await refreshKB();
      // Make the new entries findable by meaning (S1-3). The import counts even if this fails.
      const indexed = result.inserted > 0 ? await indexNewEntries() : { ok: true as const, embedded: 0 };
      if (indexed.ok) {
        showToast(describeImport(result));
      } else {
        showToast(`${describeImport(result)} Not yet indexed for meaning-based search (${indexed.reason}); they will be indexed on the next import.`, 'error');
      }
      return true;
    } catch (err) {
      showToast((err as Error).message, 'error');
      return false;
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setNavOpen(false);
    setActiveOpportunity(null);
    setView('opportunities');
  };

  const navigate = (v: AppView) => {
    setView(v);
    setActiveOpportunity(null);
    setNavOpen(false);
  };

  // Loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-ink-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-ink-900 rounded-2xl flex items-center justify-center animate-pulse">
            <Sparkles size={22} className="text-white" />
          </div>
          <p className="text-sm text-ink-400 font-medium">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session || !currentUser) {
    return <AuthPage onAuthenticated={() => {}} />;
  }

  const navItems: { key: AppView; icon: React.ReactNode; label: string }[] = [
    { key: 'opportunities', icon: <Briefcase size={18} />, label: 'Opportunities' },
    { key: 'inbox',         icon: <Inbox size={18} />,     label: 'Assignments' },
    { key: 'users',         icon: <Users size={18} />,     label: 'Team' },
  ];

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {showKBModal && (
        <KBModal
          entries={kb}
          onClose={() => setShowKBModal(false)}
          onBulkUpload={() => { setShowKBModal(false); setShowBulkUpload(true); }}
        />
      )}
      {showBulkUpload && (
        <BulkUploadModal
          onImport={async (e, fileName) => { if (await addToKB(e, 'import', fileName)) setShowBulkUpload(false); }}
          onClose={() => setShowBulkUpload(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div role="status" className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-ink-900 text-white text-sm px-5 py-3.5 rounded-2xl shadow-modal animate-slide-up">
          {toast.tone === 'error'
            ? <AlertTriangle size={16} className="text-coral-400 flex-shrink-0" />
            : <CheckCircle2 size={16} className="text-emerald-400 flex-shrink-0" />}
          <span className="font-medium">{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-2 text-ink-400 hover:text-white transition-colors">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Mobile nav overlay */}
      {navOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 sm:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      {/* Header */}
      <header className="bg-white border-b border-ink-100 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 bg-ink-900 rounded-xl flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <span className="font-black text-ink-900 text-base tracking-tight hidden sm:block">RFI Respond</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1 ml-4">
            {navItems.map((n) => {
              const active = view === n.key && !activeOpportunity;
              return (
                <button
                  key={n.key}
                  onClick={() => navigate(n.key)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all ${
                    active
                      ? 'bg-ink-900 text-white'
                      : 'text-ink-500 hover:text-ink-900 hover:bg-ink-50'
                  }`}
                >
                  {n.icon}
                  {n.label}
                </button>
              );
            })}
          </nav>

          {/* Breadcrumb when in workspace */}
          {activeOpportunity && (
            <div className="hidden sm:flex items-center gap-2 ml-2 text-sm">
              <button
                onClick={() => { setActiveOpportunity(null); setView('opportunities'); }}
                className="flex items-center gap-1.5 text-ink-400 hover:text-ink-700 transition-colors font-medium"
              >
                <ChevronLeft size={14} /> Opportunities
              </button>
              <span className="text-ink-200">/</span>
              <span className="font-semibold text-ink-800 truncate max-w-[180px]">{activeOpportunity.name}</span>
            </div>
          )}

          {/* Right: KB + user */}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowKBModal(true)}
              className="hidden sm:flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-ink-600 border border-ink-200 rounded-xl hover:bg-ink-50 hover:border-ink-300 transition-colors"
            >
              <Database size={15} />
              <span>KB</span>
              <span className="bg-ink-900 text-white text-2xs px-1.5 py-0.5 rounded-full font-bold">{kb.length}</span>
            </button>

            {/* User chip */}
            <div className="flex items-center gap-2 pl-2 border-l border-ink-100">
              <div className="w-8 h-8 rounded-full bg-ink-900 text-white flex items-center justify-center text-xs font-black flex-shrink-0">
                {currentUser.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="hidden md:block">
                <p className="text-xs font-bold text-ink-800 leading-none">{currentUser.displayName}</p>
                {currentUser.isAdmin && <p className="text-2xs text-ink-400 font-medium mt-0.5">Admin</p>}
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="w-8 h-8 flex items-center justify-center text-ink-400 hover:text-coral-500 hover:bg-coral-50 rounded-xl transition-colors ml-1"
              >
                <LogOut size={15} />
              </button>
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setNavOpen((o) => !o)}
              className="sm:hidden w-9 h-9 flex items-center justify-center text-ink-600 hover:bg-ink-100 rounded-xl transition-colors"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {navOpen && (
          <div className="sm:hidden border-t border-ink-100 bg-white px-4 py-3 space-y-1 animate-slide-up">
            {navItems.map((n) => {
              const active = view === n.key && !activeOpportunity;
              return (
                <button
                  key={n.key}
                  onClick={() => navigate(n.key)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                    active ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-50'
                  }`}
                >
                  {n.icon}{n.label}
                </button>
              );
            })}
            <div className="border-t border-ink-100 pt-2 mt-2">
              <button
                onClick={() => { setShowKBModal(true); setNavOpen(false); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors"
              >
                <Database size={18} /> Knowledge Base
                <span className="ml-auto text-2xs bg-ink-900 text-white px-1.5 py-0.5 rounded-full font-bold">{kb.length}</span>
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1">
        {activeOpportunity ? (
          <>
            {/* Mobile breadcrumb */}
            <div className="sm:hidden bg-white border-b border-ink-100 px-4 py-3 flex items-center gap-2 text-sm">
              <button
                onClick={() => setActiveOpportunity(null)}
                className="flex items-center gap-1.5 text-ink-400 hover:text-ink-700 transition-colors font-medium"
              >
                <ChevronLeft size={14} /> Opportunities
              </button>
              <span className="text-ink-200">/</span>
              <span className="font-semibold text-ink-800 truncate">{activeOpportunity.name}</span>
            </div>
            <RFIWorkspace
              onAddToKB={addToKB}
              opportunityId={activeOpportunity.id}
              opportunityName={activeOpportunity.name}
              currentUser={currentUser}
              allUsers={allUsers}
              canAssign={currentUser.isAdmin || activeOpportunity.ownerId === currentUser.id}
            />
          </>
        ) : view === 'inbox' ? (
          <UserInbox userId={currentUser.id} isAdmin={currentUser.isAdmin} />
        ) : view === 'users' ? (
          <UserManagement currentUserId={currentUser.id} isAdmin={currentUser.isAdmin} />
        ) : (
          <OpportunitiesDashboard
            currentUserId={currentUser.id}
            isAdmin={currentUser.isAdmin}
            onSelectOpportunity={(opp) => { setActiveOpportunity(opp); setView('opportunities'); }}
            onImportKB={() => setShowBulkUpload(true)}
          />
        )}
      </main>
    </div>
  );
}
