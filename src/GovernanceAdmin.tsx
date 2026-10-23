/**
 * Governance (admins only, Sprint 4): AI usage and caps (S4-1), entries waiting for review (S4-3)
 * and entries overdue for review (S4-4). The database enforces all of it; this page shows it and
 * lets an admin change the settings.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, RefreshCw, Save } from 'lucide-react';
import { supabase } from './lib/supabase';
import {
  formatGbp, loadUsageAdmin, loadUsageStatus, saveSettings,
  type AiPrice, type AiSettings, type SettingsChange, type UsageReport, type UsageStatus,
} from './lib/usage';

type Tab = 'usage';

export default function GovernanceAdmin() {
  const [tab, setTab] = useState<Tab>('usage');
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink-900 tracking-tight">Governance</h1>
        <p className="text-sm text-ink-500 mt-1">What the AI costs and what limits it, and the state of the knowledge base. Admins only.</p>
      </div>
      <div className="flex gap-2 border-b border-ink-100" role="tablist">
        {([['usage', 'Usage and limits']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm font-bold border-b-2 -mb-px ${tab === key ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-700'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'usage' && <UsageTab />}
    </div>
  );
}

const SETTING_FIELDS: { key: keyof SettingsChange; label: string; help: string; step: number; percent?: boolean }[] = [
  { key: 'daily_question_cap', label: 'Questions per person per day', help: 'Processing stops for that person at this number until tomorrow (UTC).', step: 1 },
  { key: 'daily_embed_cap', label: 'Knowledge-base texts indexed per person per day', help: 'Covers imports and new entries.', step: 1 },
  { key: 'monthly_budget_gbp', label: 'Monthly budget (£)', help: 'Processing stops for everyone when this month\'s estimated spend reaches it.', step: 1 },
  { key: 'alert_share', label: 'Warn admins at (% of budget)', help: 'Admins see a warning from this point.', step: 5, percent: true },
  { key: 'gbp_per_usd', label: 'Pounds per US dollar', help: 'Providers price in dollars. 1.00 counts each dollar as a pound, which overstates spend; set the current rate for a truer figure.', step: 0.01 },
  { key: 'review_interval_months', label: 'Review knowledge-base entries every (months)', help: 'Entries past this are reported, and drafts citing them are held from bulk approval.', step: 1 },
];

function UsageTab() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [prices, setPrices] = useState<AiPrice[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, admin] = await Promise.all([loadUsageStatus(supabase), loadUsageAdmin(supabase)]);
      setStatus(s);
      setReport(admin.report);
      setSettings(admin.settings);
      setPrices(admin.prices);
      setDraft(Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, String(f.percent ? Math.round(Number(admin.settings[f.key]) * 100) : admin.settings[f.key])])));
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError(''); setNotice('');
    const change: SettingsChange = {};
    for (const f of SETTING_FIELDS) {
      const v = Number(draft[f.key]);
      (change as Record<string, number>)[f.key] = f.percent ? v / 100 : v;
    }
    try {
      await saveSettings(supabase, change);
      setNotice('Saved. The change is in the audit log.');
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!status || !report || !settings) {
    return error ? <p className="text-sm text-coral-600">{error}</p> : <p className="text-sm text-ink-400">Loading…</p>;
  }
  const spent = status.spentGbp ?? 0;
  const share = status.budgetGbp > 0 ? Math.min(1, spent / status.budgetGbp) : 1;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-coral-600 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}

      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label flex items-center gap-1.5"><BarChart3 size={13} /> This month</p>
          <button onClick={load} className="btn-ghost text-xs py-1"><RefreshCw size={12} /> Refresh</button>
        </div>
        <p className="text-3xl font-black text-ink-900">{formatGbp(spent)} <span className="text-base font-bold text-ink-400">of {formatGbp(status.budgetGbp)}</span></p>
        <div className="h-2 rounded-full bg-ink-100 overflow-hidden">
          <div className={`h-full ${status.exhausted ? 'bg-coral-500' : status.alert ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${share * 100}%` }} />
        </div>
        <p className="text-xs text-ink-500">
          Estimated from the token counts each provider reported and the prices below, at {settings.gbp_per_usd} pounds per dollar.
          {status.exhausted ? ' The budget is reached: processing is stopped for everyone.' : status.alert ? ' Past the warning point.' : ''}
          {report.unpricedCalls > 0 && ` ${report.unpricedCalls} call${report.unpricedCalls === 1 ? '' : 's'} used a model with no price, so the figure is too low.`}
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="section-label mb-3">By person</p>
          {report.byUser.length === 0 ? <p className="text-sm text-ink-400">No AI calls this month.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {report.byUser.map((u) => (
                  <tr key={u.userId ?? 'none'} className="border-t border-ink-50">
                    <td className="py-1.5 text-ink-700">{u.name ?? 'Former user'}</td>
                    <td className="py-1.5 text-right text-ink-500">{u.calls} calls</td>
                    <td className="py-1.5 text-right font-bold text-ink-800">{formatGbp(u.spentGbp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card p-5">
          <p className="section-label mb-3">By model and job</p>
          {report.byModel.length === 0 ? <p className="text-sm text-ink-400">No AI calls this month.</p> : (
            <table className="w-full text-sm">
              <tbody>
                {report.byModel.map((m) => (
                  <tr key={`${m.provider}/${m.model}/${m.kind}`} className="border-t border-ink-50">
                    <td className="py-1.5 text-ink-700">{m.model} <span className="text-ink-400">({m.kind})</span></td>
                    <td className="py-1.5 text-right text-ink-500">{(m.inputTokens + m.outputTokens).toLocaleString()} tokens</td>
                    <td className="py-1.5 text-right font-bold text-ink-800">{formatGbp(m.spentGbp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <p className="section-label">Limits</p>
        <div className="grid md:grid-cols-2 gap-4">
          {SETTING_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm font-bold text-ink-700">{f.label}</span>
              <input
                type="number"
                step={f.step}
                min={0}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="input mt-1"
              />
              <span className="text-xs text-ink-400">{f.help}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-400">Last changed {new Date(settings.updated_at).toLocaleString()}.</p>
          <button onClick={save} className="btn-primary text-sm"><Save size={14} /> Save limits</button>
        </div>
      </div>

      <div className="card p-5">
        <p className="section-label mb-3">Prices used for the estimates (US dollars per million tokens)</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-ink-400 text-xs"><th>Model</th><th className="text-right">Input</th><th className="text-right">Output</th><th className="text-right">Checked</th></tr></thead>
          <tbody>
            {prices.map((p) => (
              <tr key={`${p.provider}/${p.model}`} className="border-t border-ink-50">
                <td className="py-1.5"><a href={p.source_url} target="_blank" rel="noreferrer" className="text-ink-700 underline decoration-ink-200">{p.model}</a></td>
                <td className="py-1.5 text-right">${Number(p.input_usd_per_mtok).toFixed(2)}</td>
                <td className="py-1.5 text-right">${Number(p.output_usd_per_mtok).toFixed(2)}</td>
                <td className="py-1.5 text-right text-ink-500">{p.checked_on}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-ink-400 mt-2">Local models (Ollama) cost nothing and are recorded at £0. Set spending limits in the providers' own consoles as well.</p>
      </div>
    </div>
  );
}
