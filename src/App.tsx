import { OPEN_ENTRY_EVENT } from './lib/openEntry';
import { useState, useEffect, useRef } from 'react';
import {
  Database, X, CheckCircle2,
  ChevronLeft, Briefcase,
  Inbox, Users, LogOut, Menu, Sparkles, AlertTriangle, Scale, HelpCircle,
} from 'lucide-react';
import { authEventAction, type AuthState } from './lib/authEvents';
import { importEntries, describeImport, indexNewEntries, type KbOrigin, type NewEntry } from './lib/knowledgeBase';
import { Opportunity, UserProfile } from './types';
import BulkUploadModal from './BulkUploadModal';
import RFIWorkspace from './RFIWorkspace';
import OpportunitiesDashboard from './OpportunitiesDashboard';
import AuthPage from './AuthPage';
import UserInbox from './UserInbox';
import UserManagement from './UserManagement';
import GovernanceAdmin from './GovernanceAdmin';
import KnowledgePage from './KnowledgePage';
import { loadUsageStatus, type UsageStatus } from './lib/usage';
import { supabase } from './lib/supabase';
import HelpView from './help/HelpView';
import SetPassword from './SetPassword';
import { linkPurpose } from './lib/passwordLink';
import Introduction from './help/Introduction';
import { startPage } from './lib/guide';
import { loadOnboardedAt, markOnboarded, PROFILE_COLUMNS, shouldShowIntroduction, stepsFor } from './lib/onboarding';
import type { Session } from '@supabase/supabase-js';


// ─── App ──────────────────────────────────────────────────────────────────────

// BUG-30: read before the Supabase client clears the address's fragment.
const ARRIVED_FOR = linkPurpose(window.location.hash);

type AppView = 'responses' | 'knowledge' | 'inbox' | 'users' | 'governance' | 'help';

export default function App() {
  const [session, setSession]                     = useState<Session | null>(null);
  const [currentUser, setCurrentUser]             = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers]                   = useState<UserProfile[]>([]);
  const [authLoading, setAuthLoading]             = useState(true);
  // Sprint 17 (S17-3): changes when entries change elsewhere, so the knowledge page reloads.
  const [kbVersion, setKbVersion]                 = useState(0);
  const [showBulkUpload, setShowBulkUpload]       = useState(false);
  // Sprint 18 (S18-2): an answer to open on the knowledge page, from a draft's sources or an ask.
  const [openRef, setOpenRef]                     = useState<{ ref: string; n: number } | null>(null);
  const [toast, setToast]                         = useState<{ msg: string; tone: 'ok' | 'error' } | null>(null);
  const [activeOpportunity, setActiveOpportunity] = useState<Opportunity | null>(null);
  const [view, setView]                           = useState<AppView>('responses');
  // S4-1: admins are warned past the budget's warning point; everyone is told when it is reached.
  const [usage, setUsage]                         = useState<UsageStatus | null>(null);
  const [navOpen, setNavOpen]                     = useState(false);
  // Sprint 10: the guide inside the app (S10-2) and the introduction (S10-6).
  const [helpAt, setHelpAt]                       = useState<{ page: string; anchor: string | null } | null>(null);
  const [helpMenuOpen, setHelpMenuOpen]           = useState(false);
  const [introOpen, setIntroOpen]                 = useState(false);
  const [settingPassword, setSettingPassword]     = useState(ARRIVED_FOR);

  // Sprint 14 (S14-6, BUG-34): whose profile is on screen, and whose is loading, so a session reported
  // again for the same person (on refocus, or a renewed token) keeps everything on screen.
  const auth = useRef<AuthState>({ loaded: null, loading: null });

  useEffect(() => {
    const onSession = (event: string, s: Session | null) => {
      setSession(s);
      const action = authEventAction(event, auth.current, s?.user.id ?? null);
      if ((action === 'load' || action === 'refresh') && s) {
        void loadUserProfile(s.user.id, action === 'refresh');
      } else if (action === 'clear') {
        // Security review, L1: nothing of the previous person's stays on screen.
        auth.current = { loaded: null, loading: null };
        setCurrentUser(null);
        setAllUsers([]);
        setActiveOpportunity(null);
        setView('responses');
        setHelpAt(null);
        setIntroOpen(false);
        setUsage(null);
        setAuthLoading(false);
      }
    };
    supabase.auth.getSession().then(({ data: { session: s } }) => onSession('INITIAL_SESSION', s));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setSettingPassword('recovery');
      onSession(event, s);
    });

    return () => subscription.unsubscribe();
    // Subscribe once on mount. loadUserProfile only calls state setters and Supabase,
    // so the first render's copy never goes stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh the usage position when the signed-in user or the page changes (S4-1).
  useEffect(() => {
    if (!currentUser) return;
    loadUsageStatus(supabase).then(setUsage).catch(() => setUsage(null));
  }, [currentUser, view, activeOpportunity]);

  async function loadUserProfile(userId: string, quiet = false) {
    // The loading screen only when the person changes (S14-6): it unmounts the app. A quiet refresh
    // (the same person reported again) updates the profile in place.
    if (!quiet) { auth.current = { loaded: null, loading: userId }; setAuthLoading(true); }
    const [{ data }, onboardedAt] = await Promise.all([
      supabase.from('user_profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
      loadOnboardedAt(supabase),
    ]);
    // Security review, L1: a result for someone who is no longer signed in is ignored.
    if (quiet ? auth.current.loaded !== userId : auth.current.loading !== userId) return;
    if (quiet) {
      if (data) setCurrentUser((u) => (u && u.id === userId ? { ...u, displayName: data.display_name, jobTitle: data.job_title ?? '', department: data.department ?? '', expertiseTags: data.expertise_tags ?? [], isAdmin: data.is_admin } : u));
      return;
    }
    // Security review, M1: only a loaded profile counts as on screen; a failed load is retried at the next sign-in.
    auth.current = { loaded: data ? userId : null, loading: null };
    if (data) {
      setCurrentUser({
        id: data.id, displayName: data.display_name,
        jobTitle: data.job_title ?? '', department: data.department ?? '',
        expertiseTags: data.expertise_tags ?? [], isAdmin: data.is_admin,
        createdAt: data.created_at, onboardedAt: onboardedAt ?? null,
      });
      // Shown after the first sign-in, on any browser, until finished or skipped (S10-6).
      if (onboardedAt !== undefined && shouldShowIntroduction({ onboardedAt })) setIntroOpen(true);
    }
    await loadAllUsers();
    await refreshKB();
    setAuthLoading(false);
    // Fill any gaps in the meaning-based index (existing entries, or after a model change). Quiet unless it fails.
    void indexNewEntries().then((r) => {
      if (!r.ok) showToast(`Some knowledge-base entries could not be indexed (${r.reason}); they are indexed before questions are next matched, if the limit allows, and any question matched without them says so.`, 'error');
    });
  }

  async function loadAllUsers() {
    const { data } = await supabase.from('user_profiles').select(PROFILE_COLUMNS).order('display_name');
    if (data) {
      setAllUsers(data.map((r) => ({
        id: r.id, displayName: r.display_name,
        jobTitle: r.job_title ?? '', department: r.department ?? '',
        expertiseTags: r.expertise_tags ?? [], isAdmin: r.is_admin,
        createdAt: r.created_at,
      })));
    }
  }

  // Sprint 16 security review (M1): each toast gets its own full time; an earlier one's timer cannot clear it.
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (msg: string, tone: 'ok' | 'error' = 'ok') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, tone });
    toastTimer.current = setTimeout(() => setToast(null), tone === 'error' ? 10000 : 5000);
  };

  // Sprint 17 (S17-3): the knowledge page reads the entries itself; this tells it to read them again.
  const refreshKB = () => setKbVersion((v) => v + 1);

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
        showToast(`${describeImport(result)} Not yet indexed for meaning-based search (${indexed.reason}), so they are indexed before questions are next matched, if the limit allows, and any question matched without them says so.`, 'error');
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
    setView('responses');
  };

  const navigate = (v: AppView) => {
    setView(v);
    setActiveOpportunity(null);
    setNavOpen(false);
    setHelpMenuOpen(false);
  };

  useEffect(() => {
    const onOpen = (e: Event) => {
      const ref = (e as CustomEvent<string>).detail;
      if (typeof ref !== 'string') return;
      navigate('knowledge');
      setOpenRef((o) => ({ ref, n: (o?.n ?? 0) + 1 }));
    };
    window.addEventListener(OPEN_ENTRY_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ENTRY_EVENT, onOpen);
  }, []);

  const openGuide = (page: string, anchor: string | null) => {
    setHelpAt({ page, anchor });
    navigate('help');
  };

  /** Close the introduction and remember it on the account; a failed save only means it is shown again. */
  const closeIntroduction = () => {
    setIntroOpen(false);
    if (currentUser && !currentUser.onboardedAt) {
      void markOnboarded(supabase).then((saved) => {
        if (saved) setCurrentUser((u) => (u ? { ...u, onboardedAt: new Date().toISOString() } : u));
      });
    }
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

  if (settingPassword) {
    return <SetPassword purpose={settingPassword} onDone={() => { setSettingPassword(null); history.replaceState(null, '', window.location.pathname); }} />;
  }

  const navItems: { key: AppView; icon: React.ReactNode; label: string }[] = [
    { key: 'responses', icon: <Briefcase size={18} />, label: 'Responses' },
    { key: 'knowledge', icon: <Database size={18} />, label: 'Knowledge' },
    { key: 'inbox',         icon: <Inbox size={18} />,     label: 'Assignments' },
    { key: 'users',         icon: <Users size={18} />,     label: 'Team' },
    ...(currentUser.isAdmin ? [{ key: 'governance' as AppView, icon: <Scale size={18} />, label: 'Governance' }] : []),
  ];

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {introOpen && (
        <Introduction
          steps={stepsFor(currentUser.isAdmin)}
          onClose={closeIntroduction}
          onOpenGuide={(page, anchor) => { closeIntroduction(); openGuide(page, anchor); }}
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
            <span className="font-black text-ink-900 text-base tracking-tight hidden lg:block">RFI Respond</span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-1 lg:ml-4">
            {navItems.map((n) => {
              const active = view === n.key && !activeOpportunity;
              return (
                <button
                  key={n.key}
                  onClick={() => navigate(n.key)}
                  title={n.label}
                  aria-label={n.label}
                  className={`flex items-center gap-2 px-3 lg:px-3.5 py-2 rounded-xl text-sm font-semibold transition-all ${
                    active
                      ? 'bg-ink-900 text-white'
                      : 'text-ink-500 hover:text-ink-900 hover:bg-ink-50'
                  }`}
                >
                  {n.icon}
                  {/* Sprint 7 (F-10): icons only below 1024 px, so the header fits a 768 px window. */}
                  <span className="hidden lg:inline">{n.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Breadcrumb when in workspace */}
          {activeOpportunity && (
            // BUG-33: the breadcrumb takes the space left and truncates the name (full name on hover); it
            // never overlaps Help. The back link is an icon, since Responses is already in the bar.
            <div className="hidden lg:flex flex-1 items-center gap-1.5 ml-2 text-sm min-w-0">
              <button
                onClick={() => { setActiveOpportunity(null); setView('responses'); }}
                title="Back to responses"
                aria-label="Back to responses"
                className="flex-shrink-0 flex items-center text-ink-400 hover:text-ink-700 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-semibold text-ink-800 truncate min-w-0" title={activeOpportunity.name}>{activeOpportunity.name}</span>
            </div>
          )}

          {/* Right: Help, KB and user */}
          <div className="ml-auto flex-shrink-0 flex items-center gap-2">
            {/* Help (S10-2): the guide, and the introduction again (S10-6). */}
            <div className="relative hidden sm:block">
              <button
                onClick={() => setHelpMenuOpen((o) => !o)}
                onKeyDown={(e) => { if (e.key === 'Escape') setHelpMenuOpen(false); }}
                aria-haspopup="menu"
                aria-expanded={helpMenuOpen}
                title="Help"
                aria-label="Help"
                className={`flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-xl border transition-colors ${view === 'help' && !activeOpportunity ? 'bg-ink-900 text-white border-ink-900' : 'text-ink-600 border-ink-200 hover:bg-ink-50 hover:border-ink-300'}`}
              >
                <HelpCircle size={15} />
                <span className="hidden lg:inline">Help</span>
              </button>
              {helpMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setHelpMenuOpen(false)} />
                  <div role="menu" onKeyDown={(e) => { if (e.key === 'Escape') setHelpMenuOpen(false); }}
                    className="absolute right-0 mt-2 w-56 bg-white border border-ink-200 rounded-2xl shadow-modal py-1.5 z-50">
                    <button role="menuitem" autoFocus onClick={() => openGuide(startPage(currentUser.isAdmin), null)}
                      className="w-full text-left text-sm px-4 py-2.5 hover:bg-ink-50 text-ink-700 font-medium">Open the guide</button>
                    <button role="menuitem" onClick={() => { setHelpMenuOpen(false); setIntroOpen(true); }}
                      className="w-full text-left text-sm px-4 py-2.5 hover:bg-ink-50 text-ink-700 font-medium">Show the introduction</button>
                  </div>
                </>
              )}
            </div>


            {/* User chip */}
            <div className="flex items-center gap-2 pl-2 border-l border-ink-100">
              <div className="w-8 h-8 rounded-full bg-ink-900 text-white flex items-center justify-center text-xs font-black flex-shrink-0">
                {currentUser.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="hidden lg:block">
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
                onClick={() => openGuide(startPage(currentUser.isAdmin), null)}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors"
              >
                <HelpCircle size={18} /> Help
              </button>
              <button
                onClick={() => { setNavOpen(false); setIntroOpen(true); }}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold text-ink-600 hover:bg-ink-50 transition-colors"
              >
                <Sparkles size={18} /> Show the introduction
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1">
        {usage && (usage.exhausted || (usage.alert && currentUser.isAdmin)) && (
          <div className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${usage.exhausted ? 'bg-coral-50 text-coral-700' : 'bg-amber-50 text-amber-800'}`} role="status">
            <AlertTriangle size={14} className="flex-shrink-0" />
            {usage.exhausted
              ? "This month's AI budget has been reached, so new questions cannot be processed. An admin can raise it under Governance."
              : `AI spend this month has passed the warning point${usage.spentGbp !== null ? ` (£${usage.spentGbp.toFixed(2)} of £${usage.budgetGbp})` : ''}. See Governance.`}
          </div>
        )}
        {activeOpportunity ? (
          <>
            {/* Mobile breadcrumb */}
            <div className="sm:hidden bg-white border-b border-ink-100 px-4 py-3 flex items-center gap-2 text-sm">
              <button
                onClick={() => setActiveOpportunity(null)}
                className="flex items-center gap-1.5 text-ink-400 hover:text-ink-700 transition-colors font-medium"
              >
                <ChevronLeft size={14} /> Responses
              </button>
              <span className="text-ink-200">/</span>
              <span className="font-semibold text-ink-800 truncate">{activeOpportunity.name}</span>
            </div>
            <RFIWorkspace
              key={activeOpportunity.id}
              opportunityId={activeOpportunity.id}
              archived={activeOpportunity.archivedAt !== null}
              opportunityName={activeOpportunity.name}
              currentUser={currentUser}
              allUsers={allUsers}
              canAssign={currentUser.isAdmin || activeOpportunity.ownerId === currentUser.id}
              ownerName={allUsers.find((u) => u.id === activeOpportunity.ownerId)?.displayName ?? null}
            />
          </>
        ) : view === 'knowledge' ? (
          <KnowledgePage
            names={new Map(allUsers.map((u) => [u.id, u.displayName]))}
            isAdmin={currentUser.isAdmin}
            version={kbVersion}
            onImport={() => setShowBulkUpload(true)}
            onAdded={(m) => { showToast(m); refreshKB(); }}
            onIndexFailed={(m) => showToast(m, 'error')}
            onReview={() => setView('governance')}
            openRef={openRef}
            onOpenedRef={() => setOpenRef(null)}
            onAsked={() => loadUsageStatus(supabase).then(setUsage).catch(() => undefined)}
          />
        ) : view === 'inbox' ? (
          <UserInbox userId={currentUser.id} isAdmin={currentUser.isAdmin} />
        ) : view === 'users' ? (
          <UserManagement currentUserId={currentUser.id} isAdmin={currentUser.isAdmin} />
        ) : view === 'governance' && currentUser.isAdmin ? (
          <GovernanceAdmin names={new Map(allUsers.map((u) => [u.id, u.displayName]))} onDemoReset={() => { setActiveOpportunity(null); refreshKB(); }} />
        ) : view === 'help' ? (
          <HelpView
            page={helpAt?.page ?? startPage(currentUser.isAdmin)}
            anchor={helpAt?.anchor ?? null}
            onOpen={openGuide}
            onShowIntroduction={() => setIntroOpen(true)}
          />
        ) : (
          <OpportunitiesDashboard
            currentUserId={currentUser.id}
            isAdmin={currentUser.isAdmin}
            onSelectOpportunity={(opp) => { setActiveOpportunity(opp); setView('responses'); }}
          />
        )}
      </main>
    </div>
  );
}
