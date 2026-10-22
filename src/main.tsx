import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { readConfig } from './lib/config';
import './index.css';

const root = createRoot(document.getElementById('root')!);
const config = readConfig(import.meta.env);

if (!config.ok) {
  root.render(
    <main className="min-h-screen flex items-center justify-center bg-ink-50 p-6">
      <div role="alert" className="max-w-lg bg-white border border-ink-200 rounded-2xl p-8 shadow-card">
        <h1 className="text-lg font-black text-ink-900 mb-2">RFI Respond is not configured</h1>
        <p className="text-sm text-ink-600 mb-4">These settings are missing:</p>
        <ul className="text-sm font-mono text-ink-800 mb-4 list-disc pl-5">
          {config.missing.map((m) => <li key={m}>{m}</li>)}
        </ul>
        <p className="text-sm text-ink-600">
          Copy <code>.env.example</code> to <code>.env</code>, fill in the values, then restart the dev server.
          The README explains where the values come from.
        </p>
      </div>
    </main>,
  );
} else {
  // Loaded only once the configuration is known to be complete.
  import('./App.tsx').then(({ default: App }) => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
}
