/** BUG-30: choose a password after following an invitation or a password-reset link. */
import { useState } from 'react';
import { Lock, Sparkles } from 'lucide-react';
import { supabase } from './lib/supabase';
import { passwordProblem, type LinkPurpose } from './lib/passwordLink';

export default function SetPassword({ purpose, onDone }: { purpose: Exclude<LinkPurpose, null>; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = passwordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (err) { setError(`The password was not saved: ${err.message}`); return; }
    onDone();
  };

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-3xl shadow-modal w-full max-w-sm p-8 space-y-4">
        <div className="w-10 h-10 bg-ink-900 rounded-xl flex items-center justify-center"><Sparkles size={18} className="text-white" /></div>
        <h1 className="text-xl font-black text-ink-900 tracking-tight">{purpose === 'invite' ? 'Welcome: choose a password' : 'Choose a new password'}</h1>
        <p className="text-sm text-ink-600">At least 12 characters, with letters and digits. You will use it with your email address to sign in.</p>
        <label className="block text-xs font-bold text-ink-600">New password
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input mt-1" />
        </label>
        <label className="block text-xs font-bold text-ink-600">Type it again
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input mt-1" />
        </label>
        {error && <p role="alert" className="text-sm text-coral-700">{error}</p>}
        <button type="submit" disabled={saving} className="btn-primary w-full justify-center"><Lock size={14} /> Save password</button>
      </form>
    </div>
  );
}
