import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readConfig } from './lib/config';
import './index.css';

// Sprint 14 security review (M2): only these two are read, so only these two are built into the
// bundle; passing import.meta.env whole would publish every VITE_ variable the host defines.
const appEnv = { VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY };
const root = createRoot(document.getElementById('root')!);
const config = readConfig(appEnv);

if (!config.ok) {
  root.render(
    <main className="min-h-screen flex items-center justify-center bg-ink-50 p-6">
      <div role="alert" className="max-w-lg bg-white border border-ink-200 rounded-2xl p-8 shadow-card">
        <h1 className="text-lg font-black text-ink-900 mb-2">RFI Respond is not configured</h1>
        {config.problem ? (
          <p className="text-sm text-coral-700 font-semibold mb-4">{config.problem}</p>
        ) : (
          <>
            <p className="text-sm text-ink-600 mb-4">These settings are missing:</p>
            <ul className="text-sm font-mono text-ink-800 mb-4 list-disc pl-5">
              {config.missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </>
        )}
        <p className="text-sm text-ink-600">
          Copy <code>.env.example</code> to <code>.env</code>, fill in the values, then restart the dev server.
          The README explains where the values come from.
        </p>
      </div>
    </main>,
  );
} else {
  // Security review, L4: after a redeployment, a tab left open asks for chunks that no longer exist;
  // reload once to get the new ones rather than failing.
  window.addEventListener('vite:preloadError', () => {
    try { if (sessionStorage.getItem('rfi-reloaded')) return; sessionStorage.setItem('rfi-reloaded', '1'); } catch { /* reload anyway */ }
    window.location.reload();
  });
  // Loaded only once the configuration is known to be complete.
  import('./App.tsx').then(({ default: App }) => {
    try { sessionStorage.removeItem('rfi-reloaded'); } catch { /* not needed */ }
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
