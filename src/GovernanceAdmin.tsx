/**
 * Governance (admins only, Sprint 4): AI usage and caps (S4-1), entries waiting for review (S4-3)
 * and entries overdue for review (S4-4), and since Sprint 11 the audit log (S11-9). The database
 * enforces all of it; this page shows it and lets an admin change the settings. Since Sprint 15
 * (S15-4), where a demo is loaded, an admin can reset it here.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Pencil, RefreshCw, Save } from 'lucide-react';
import { supabase } from './lib/supabase';
import LanguageLabel from './LanguageLabel';
import {
  formatGbp, loadUsageAdmin, loadUsageStatus, saveSettings, spendByUse,
  type AiPrice, type AiSettings, type SettingsChange, type UsageReport, type UsageStatus,
} from './lib/usage';
import { describeOrigin, loadEntriesToReview, loadOverdueEntries, reviewEntry, type EntryForReview } from './lib/entryReview';
import { AUDIT_GROUPS, AUDIT_LIMIT, describeAudit, loadAuditLog, loadAuditPeople, type AuditRow } from './lib/auditLog';
import { RESET_PHRASE, confirmHint, isConfirmed, loadDemoStatus, resetDemo, type DemoStatus } from './lib/demoReset';

type Tab = 'usage' | 'review' | 'overdue' | 'audit' | 'demo';

export default function GovernanceAdmin({ names = new Map(), onDemoReset }: { names?: Map<string, string>; onDemoReset?: () => void }) {
  const [tab, setTab] = useState<Tab>('usage');
  // S15-4: the Demo tab appears only where a demo is loaded.
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const loadDemo = useCallback(async () => setDemo(await loadDemoStatus(supabase)), []);
  useEffect(() => { loadDemo(); }, [loadDemo]);
  const tabs: [Tab, string][] = [['usage', 'Usage and limits'], ['review', 'Entries to review'], ['overdue', 'Overdue for review'], ['audit', 'Audit log']];
  if (demo?.loaded) tabs.push(['demo', 'Demo']);
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-ink-900 tracking-tight">Governance</h1>
        <p className="text-sm text-ink-500 mt-1">What the AI costs and what limits it, and the state of the knowledge base. Admins only.</p>
      </div>
      <div className="flex gap-2 border-b border-ink-100" role="tablist">
        {tabs.map(([key, label]) => (
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
      {tab === 'review' && <ReviewTab mode="unreviewed" />}
      {tab === 'overdue' && <ReviewTab mode="overdue" />}
      {tab === 'audit' && <AuditTab names={names} />}
      {tab === 'demo' && demo?.loaded && <DemoTab status={demo} onReset={() => { loadDemo(); onDemoReset?.(); }} />}
    </div>
  );
}

// Sprint 22 (S22-2, Q3): what an admin changes monthly is in view; what tunes the estimates (the
// reserves and the exchange rate) is under Advanced.
const SETTING_FIELDS: { key: keyof SettingsChange; label: string; help: string; step: number; percent?: boolean; advanced?: boolean }[] = [
  { key: 'daily_question_cap', label: 'Questions per person per day', help: 'Processing stops for that person at this number until tomorrow (UTC).', step: 1 },
  { key: 'daily_embed_cap', label: 'Knowledge-base texts indexed per person per day', help: 'Covers imports and new entries.', step: 1 },
  { key: 'daily_extract_cap', label: 'Word documents read by AI per person per day', help: 'Finding the questions in an uploaded Word document. Spreadsheets do not count.', step: 1 },
  { key: 'monthly_budget_gbp', label: 'Monthly budget (£)', help: 'Processing stops for everyone when this month\'s estimated spend reaches it.', step: 1 },
  { key: 'alert_share', label: 'Warn admins at (% of budget)', help: 'Admins see a warning from this point.', step: 5, percent: true },
  { key: 'est_usd_per_question', label: 'Reserve per question (US$)', help: 'Held against the budget while a question is processed, until its real cost is recorded. Compare it with the measured average above.', step: 0.001, advanced: true },
  // Sprint 11 (F-54): the last setting that was only reachable through the database.
  { key: 'est_usd_per_embed_text', label: 'Reserve per knowledge-base text indexed (US$)', help: 'Held against the budget while knowledge-base entries are indexed, until the real cost is recorded.', step: 0.0001, advanced: true },
  { key: 'est_usd_per_extract_kchar', label: 'Reserve per 1,000 characters of a Word document (US$)', help: 'Held against the budget while the questions in a Word document are found, until the real cost is recorded.', step: 0.0001, advanced: true },
  { key: 'gbp_per_usd', label: 'Pounds per US dollar', help: 'Providers price in dollars. 1.00 counts each dollar as a pound, which overstates spend; set the current rate for a truer figure.', step: 0.01, advanced: true },
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
  // BUG-35 (Sprint 14): the button shows it is saving, and the outcome appears beside it.
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ ok: boolean; text: string; from: 'limits' | 'advanced' } | null>(null);

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

  const save = async (from: 'limits' | 'advanced') => {
    setError(''); setNotice(''); setSaveResult(null); setSaving(true);
    const change: SettingsChange = {};
    for (const f of SETTING_FIELDS) {
      const v = Number(draft[f.key]);
      (change as Record<string, number>)[f.key] = f.percent ? v / 100 : v;
    }
    try {
      await saveSettings(supabase, change);
      await load();
      setSaveResult({ ok: true, text: 'Saved. The change is in the audit log.', from });
    } catch (err) {
      setSaveResult({ ok: false, text: (err as Error).message, from });
    } finally {
      setSaving(false);
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
          Estimated from the token counts each provider reported and the prices below, converted at £{Number(settings.gbp_per_usd).toFixed(2)} to the dollar.
          {status.exhausted ? ' The budget is reached: processing is stopped for everyone.' : status.alert ? ' Past the warning point.' : ''}
          {report.avgUsdPerQuestion !== null && ` Measured this month: $${report.avgUsdPerQuestion.toFixed(4)} per question over ${report.questionsProcessed} processed; each question reserves $${Number(settings.est_usd_per_question).toFixed(4)}.`}
          {report.unpricedCalls > 0 && ` ${report.unpricedCalls} call${report.unpricedCalls === 1 ? '' : 's'} used a model with no price (${report.unpricedModels.join(', ') || 'unknown'}), so the figure is too low until its price is added to the ai_prices table.`}
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
          <p className="section-label mb-3">Spend by use</p>
          {report.byFunction.length === 0 ? <p className="text-sm text-ink-400">No AI calls this month.</p> : (
            <table className="w-full text-sm" aria-label="Spend by use">
              <tbody>
                {spendByUse(report.byFunction).map((u) => (
                  <tr key={u.label} className="border-t border-ink-50">
                    <td className="py-1.5 text-ink-700">{u.label}</td>
                    <td className="py-1.5 text-right text-ink-500">{u.calls} {u.calls === 1 ? 'call' : 'calls'}</td>
                    <td className="py-1.5 text-right font-bold text-ink-800">{formatGbp(u.spentGbp)}</td>
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
          {SETTING_FIELDS.filter((f) => !f.advanced).map((f) => (
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
          <div className="flex items-center gap-3">
            <span role="status" aria-live="polite" className={`text-sm ${saveResult?.ok ? 'text-emerald-700' : 'text-coral-600'}`}>
              {saveResult?.from === 'limits' ? saveResult.text : ''}
            </span>
            <button onClick={() => save('limits')} disabled={saving} aria-busy={saving} className="btn-primary text-sm disabled:opacity-60">
              <Save size={14} /> {saving ? 'Saving…' : 'Save limits'}
            </button>
          </div>
        </div>
      </div>

      <details className="card p-5 group">
        <summary className="cursor-pointer text-sm font-bold text-ink-800">Advanced: reserves, exchange rate, prices and spend by model</summary>
        <div className="space-y-6 mt-4">
          <div className="space-y-4">
            <p className="text-xs text-ink-500">How the spend is estimated. Change these when the measured cost or the exchange rate moves.</p>
            <div className="grid md:grid-cols-2 gap-4">
              {SETTING_FIELDS.filter((f) => f.advanced).map((f) => (
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
            <div className="flex items-center justify-end gap-3">
              <span role="status" aria-live="polite" className={`text-sm ${saveResult?.ok ? 'text-emerald-700' : 'text-coral-600'}`}>
                {saveResult?.from === 'advanced' ? saveResult.text : ''}
              </span>
              <button onClick={() => save('advanced')} disabled={saving} aria-busy={saving} className="btn-primary text-sm disabled:opacity-60">
                <Save size={14} /> {saving ? 'Saving…' : 'Save advanced settings'}
              </button>
            </div>
          </div>
          <div>
            <p className="section-label mb-3">Spend by model</p>
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
          <div>
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
      </details>
    </div>
  );
}

/**
 * S4-3: entries added by members (or learned from an assignee's answer) waiting for an admin.
 * S4-4: entries past their review date. Both are cleared the same way, with review_entry().
 */
function ReviewTab({ mode }: { mode: 'unreviewed' | 'overdue' }) {
  const [entries, setEntries] = useState<EntryForReview[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setError('');
    try {
      setEntries(await (mode === 'overdue' ? loadOverdueEntries(supabase) : loadEntriesToReview(supabase)));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [mode]);
  useEffect(() => { load(); }, [load]);

  const approve = async (e: EntryForReview, edits?: { question: string; answer: string }) => {
    setError(''); setNotice('');
    try {
      await reviewEntry(supabase, e.id, edits);
      setNotice(`${e.ref} reviewed${edits ? ' with corrections' : ''}. Questions waiting on it in open responses are released for bulk approval, unless they cite another entry still awaiting review.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!entries) return error ? <p className="text-sm text-coral-600">{error}</p> : <p className="text-sm text-ink-400">Loading…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        {mode === 'overdue'
          ? 'Entries not reviewed or confirmed within the review interval (set under Usage and limits). Drafts that cite them are never bulk-approved until they are reviewed again. An answer approved unedited, when its response is marked as sent, also counts as a confirmation.'
          : 'Entries added by team members go into the knowledge base at once, but drafts that cite them are never bulk-approved until an admin reviews them here.'}
      </p>
      {error && <p className="text-sm text-coral-600 flex items-center gap-2"><AlertTriangle size={14} /> {error}</p>}
      {notice && <p className="text-sm text-emerald-700">{notice}</p>}
      {entries.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-500"><CheckCircle2 size={16} className="inline mr-1 text-emerald-600" /> {mode === 'overdue' ? 'No entry is overdue for review.' : 'Nothing waiting for review.'}</div>
      ) : entries.map((e) => <ReviewCard key={e.id} entry={e} onApprove={approve} />)}
    </div>
  );
}

function ReviewCard({ entry, onApprove }: { entry: EntryForReview; onApprove: (e: EntryForReview, edits?: { question: string; answer: string }) => void }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  return (
    <div className="card p-5 space-y-2">
      <div className="flex items-center gap-2 text-xs text-ink-500">
        <span className="font-bold text-ink-700 bg-ink-50 border border-ink-100 px-2 py-0.5 rounded-full">{entry.ref}</span>
        <LanguageLabel language={entry.language} />
        <span>{describeOrigin(entry)}, {new Date(entry.createdAt).toLocaleDateString()}</span>
        {entry.dueSince && (
          <span className="text-amber-700 font-bold">
            Due since {new Date(entry.dueSince).toLocaleDateString()}{entry.recentCitations ? `; cited ${entry.recentCitations} time${entry.recentCitations === 1 ? '' : 's'} in 90 days` : ''}
          </span>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea className="input min-h-[60px]" value={question} onChange={(ev) => setQuestion(ev.target.value)} aria-label="Question" />
          <textarea className="input min-h-[120px]" value={answer} onChange={(ev) => setAnswer(ev.target.value)} aria-label="Answer" />
        </div>
      ) : (
        <>
          <p className="text-sm font-bold text-ink-800">{entry.question}</p>
          <p className="text-sm text-ink-600 whitespace-pre-wrap">{entry.answer}</p>
        </>
      )}
      {entry.source && <p className="text-xs text-ink-400">Source: {entry.source}</p>}
      {entry.replaces && (
        <div className="text-xs text-ink-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="font-bold text-amber-800">Approving this replaces {entry.replaces.ref}, which currently says:</p>
          <p className="mt-1 whitespace-pre-wrap">{entry.replaces.answer}</p>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {editing ? (
          <>
            <button onClick={() => { setEditing(false); setQuestion(entry.question); setAnswer(entry.answer); }} className="btn-ghost text-sm">Cancel</button>
            <button onClick={() => onApprove(entry, { question, answer })} className="btn-primary text-sm"><CheckCircle2 size={14} /> Save corrections and approve</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="btn-ghost text-sm"><Pencil size={13} /> Correct</button>
            <button onClick={() => onApprove(entry)} className="btn-primary text-sm"><CheckCircle2 size={14} /> {entry.dueSince ? 'Still correct' : 'Approve'}</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Sprint 11 (S11-9, F-53): the audit log, newest first, in plain words. Read-only. Since Sprint 22
 * (S22-2) it is filtered by person and by response as well as by kind, together, in the database.
 */
function AuditTab({ names }: { names: Map<string, string> }) {
  const [group, setGroup] = useState<string>('');
  const [actor, setActor] = useState<string>('');
  const [response, setResponse] = useState<string>('');
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [responses, setResponses] = useState<{ id: string; name: string }[]>([]);
  const [found, setFound] = useState<{ rows: AuditRow[]; more: boolean } | null>(null);
  const [error, setError] = useState('');

  // The choices for the filters: everyone who has acted in the log, and every response, archived too.
  useEffect(() => {
    let live = true;
    loadAuditPeople(supabase).then((p) => { if (live) setPeople(p); }).catch(() => undefined);
    supabase.from('opportunities').select('id,name').order('name').then(({ data }) => {
      if (live) setResponses(((data ?? []) as { id: string; name: string }[]).map((r) => ({ id: String(r.id), name: String(r.name) })));
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setError(''); setFound(null);
    loadAuditLog(supabase, { group: group || null, actor: actor || null, response: response || null })
      .then((r) => { if (live) setFound(r); })
      .catch((err: Error) => { if (live) { setFound({ rows: [], more: false }); setError(err.message); } });
    return () => { live = false; };
  }, [group, actor, response]);

  const filtered = Boolean(group || actor || response);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="audit-group" className="block text-sm font-semibold text-ink-700">Show</label>
          <select id="audit-group" value={group} onChange={(e) => setGroup(e.target.value)} className="input w-auto text-sm py-2 mt-1">
            <option value="">Everything</option>
            {Object.entries(AUDIT_GROUPS).map(([key, g]) => <option key={key} value={key}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-person" className="block text-sm font-semibold text-ink-700">Person</label>
          <select id="audit-person" value={actor} onChange={(e) => setActor(e.target.value)} className="input w-auto max-w-[16rem] text-sm py-2 mt-1">
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="audit-response" className="block text-sm font-semibold text-ink-700">Response</label>
          <select id="audit-response" value={response} onChange={(e) => setResponse(e.target.value)} className="input w-auto max-w-[20rem] text-sm py-2 mt-1">
            <option value="">Any response</option>
            {responses.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        {filtered && (
          <button className="btn-ghost text-xs py-2" onClick={() => { setGroup(''); setActor(''); setResponse(''); }}>Clear the filters</button>
        )}
      </div>
      <p className="text-xs text-ink-500">
        Newest first, at most {AUDIT_LIMIT} entries. Written by the database; admins cannot change or delete them.
        {' '}A response&apos;s entries include those about its files and questions.
      </p>
      {error && <p role="alert" className="text-sm text-coral-700">{error}</p>}
      {found === null ? (
        <p className="text-sm text-ink-400">Loading…</p>
      ) : found.rows.length === 0 ? (
        <p className="text-sm text-ink-400">{filtered ? 'Nothing recorded that matches these filters.' : 'Nothing recorded yet.'}</p>
      ) : (
        <>
          <ul aria-label="Audit log" className="bg-white rounded-2xl border border-ink-100 shadow-card divide-y divide-ink-100">
            {found.rows.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <p className="text-sm text-ink-800">{describeAudit(r, names)}</p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {r.actorName ?? (r.actorId ? 'Former user' : 'The system')} · {new Date(r.at).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · <code className="text-[0.85em]">{r.action}</code>
                </p>
              </li>
            ))}
          </ul>
          {found.more && (
            <p role="status" className="text-xs text-ink-500">
              These are the newest {AUDIT_LIMIT}; older entries match too. Choose a person, a response or a kind to see them.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** S15-4 (F-63): put the demo back as it was loaded, confirmed by typing a phrase. */
function DemoTab({ status, onReset }: { status: DemoStatus; onReset: () => void }) {
  const [typed, setTyped] = useState('');
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const reset = async () => {
    setResult(null); setResetting(true);
    try {
      setResult({ ok: true, text: await resetDemo(supabase, typed) });
      setTyped('');
      onReset();
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setResetting(false);
    }
  };
  return (
    <div className="card p-5 space-y-4">
      <p className="section-label">Reset the demo</p>
      <div className="text-sm text-ink-600 space-y-2">
        <p>Puts the demo back as it was loaded: the four demo responses and the demo knowledge base, with entry numbers from KB-0001 again.</p>
        <p><strong>Removed:</strong> every response and every knowledge-base entry, including anything reviewers added. <strong>Kept:</strong> real people&apos;s accounts and roles, the limits, real people&apos;s usage, and the audit log, which records the reset. The demo&apos;s fictional people are put back as they were loaded.</p>
        <p>Do not reset while someone is processing questions: their run would fail. The next sign-in indexes the entries again, which costs a few pence.</p>
        <p className="text-xs text-ink-400">Last reset: {status.lastResetAt ? new Date(status.lastResetAt).toLocaleString() : 'never'}.</p>
      </div>
      <label className="block max-w-sm">
        <span className="text-sm font-bold text-ink-700">To confirm, type the whole phrase: &ldquo;{RESET_PHRASE}&rdquo;</span>
        <input className="input mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="demo-reset-hint" />
        <span id="demo-reset-hint" className={`text-xs mt-1 block ${isConfirmed(typed) ? 'text-emerald-700' : 'text-ink-500'}`}>{confirmHint(typed)}</span>
      </label>
      <div className="flex items-center gap-3">
        <button onClick={reset} disabled={!isConfirmed(typed) || resetting} aria-busy={resetting} className="btn-primary text-sm disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none disabled:cursor-not-allowed">
          <RefreshCw size={14} /> {resetting ? 'Resetting…' : 'Reset the demo'}
        </button>
        <span role="status" aria-live="polite" className={`text-sm ${result?.ok ? 'text-emerald-700' : 'text-coral-600'}`}>{result?.text ?? ''}</span>
      </div>
    </div>
  );
}
