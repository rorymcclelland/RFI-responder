import { useState } from 'react';
import { Mail, Lock, ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react';
import { supabase } from './lib/supabase';

// Invite-only (decision 0003): there is no sign-up. Admins invite users.
type AuthMode = 'login' | 'reset';

interface Props {
  onAuthenticated: () => void;
}

export default function AuthPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const reset = () => { setError(''); setResetSent(false); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) { setError(err.message); setLoading(false); return; }
      onAuthenticated();
    } else {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (err) { setError(err.message); setLoading(false); return; }
      setResetSent(true);
    }

    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-ink-50 flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-ink-900 flex-col justify-between p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
            <Sparkles size={20} className="text-white" />
          </div>
          <span className="font-black text-white text-lg tracking-tight">RFI Respond</span>
        </div>

        <div>
          <h1 className="text-5xl font-black text-white leading-[1.1] tracking-tight mb-6">
            Answer RFIs from<br />what your team knows.
          </h1>
          <p className="text-ink-400 text-lg leading-relaxed max-w-sm">
            Knowledge-base matching, collaborative expert review, and one-click export.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            // Statements of what the tool does, not performance claims (project rule 1).
            { stat: 'Sourced', label: 'Drafts cite their entries' },
            { stat: 'Routed', label: 'To the right expert' },
            { stat: '3', label: 'Export formats' },
          ].map(({ stat, label }) => (
            <div key={stat} className="bg-white/5 rounded-2xl p-4 border border-white/10">
              <p className="text-2xl font-black text-white">{stat}</p>
              <p className="text-xs text-ink-400 mt-1 font-medium">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-10 lg:hidden">
            <div className="w-9 h-9 bg-ink-900 rounded-xl flex items-center justify-center">
              <Sparkles size={17} className="text-white" />
            </div>
            <span className="font-black text-ink-900 text-base tracking-tight">RFI Respond</span>
          </div>

          <div className="mb-8">
            <h2 className="text-3xl font-black text-ink-900 tracking-tight">
              {mode === 'login' ? 'Welcome back' : 'Reset password'}
            </h2>
            <p className="text-ink-500 mt-2 text-sm">
              {mode === 'login' ? 'Sign in to continue to your workspace.' :
               'We\'ll send you a link to reset your password.'}
            </p>
          </div>

          {mode === 'login' && (
            <p className="text-xs text-ink-500 font-medium mb-8">
              Access is by invitation. If you do not have an account, ask an admin to invite you.
            </p>
          )}

          {mode === 'reset' && (
            <button
              type="button"
              onClick={() => { setMode('login'); reset(); }}
              className="flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-800 font-medium mb-6 transition-colors"
            >
              <ChevronLeft size={14} /> Back to sign in
            </button>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {resetSent ? (
              <div className="py-8 text-center space-y-4">
                <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto">
                  <Mail size={26} className="text-emerald-600" />
                </div>
                <div>
                  <p className="font-bold text-ink-900">Check your email</p>
                  <p className="text-sm text-ink-500 mt-1">A reset link was sent to <strong className="text-ink-700">{email}</strong></p>
                </div>
                <button type="button" onClick={() => { setMode('login'); reset(); }}
                  className="text-sm text-ink-600 hover:text-ink-900 font-semibold underline transition-colors">
                  Back to sign in
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-bold text-ink-600 mb-1.5 uppercase tracking-wide">Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input
                      type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className="input pl-10"
                      required
                    />
                  </div>
                </div>

                {mode !== 'reset' && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-ink-600 uppercase tracking-wide">Password</label>
                      {mode === 'login' && (
                        <button type="button" onClick={() => { setMode('reset'); reset(); }}
                          className="text-xs text-ink-500 hover:text-ink-800 font-semibold transition-colors">
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
                      <input
                        type={showPw ? 'text' : 'password'} value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="input pl-10 pr-11"
                        required minLength={6}
                      />
                      <button type="button" onClick={() => setShowPw((s) => !s)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 transition-colors">
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <div className="text-sm text-coral-600 bg-coral-50 border border-coral-200 rounded-xl px-4 py-3 font-medium">
                    {error}
                  </div>
                )}

                <button
                  type="submit" disabled={loading}
                  className="btn-primary w-full justify-center mt-2 py-3 text-base"
                >
                  {loading ? 'Please wait…' :
                   mode === 'login' ? 'Sign In' :
                   'Send Reset Link'}
                  {!loading && <ArrowRight size={18} />}
                </button>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── missing import ───────────────────────────────────────────────────────────
function ChevronLeft({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}
