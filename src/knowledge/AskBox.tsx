/**
 * Sprint 18 (S18-4, K-3): ask the knowledge base a question, as a customer would, and see the answer
 * it would draft, with its confidence, the checker's verdict and the answers behind it. The server
 * runs the same pipeline as a response and saves nothing but the cost (Rory, Q4).
 */
import { useRef, useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { MAX_ASK_CHARS, askKnowledge, askSummary, type AskResult } from '../lib/ask';
import { confidenceBand } from '../workspace/confidenceBands';
import { formatConfidence } from '../lib/format';

interface Props {
  /** Questions of the entries, by number, to name the sources. */
  questionOf: (ref: string) => string | undefined;
  onOpen: (ref: string) => void;
  /** Spend changed: the usage banner may need refreshing. */
  onAsked?: () => void;
}

const VERDICT: Record<string, string> = { yes: 'Yes', partly: 'Partly', no: 'No' };

export default function AskBox({ questionOf, onOpen, onAsked }: Props) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AskResult | null>(null);
  const seq = useRef(0);

  const ask = async () => {
    const n = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const r = await askKnowledge(supabase, question);
      if (n === seq.current) setResult(r);
    } catch (err) {
      if (n === seq.current) { setResult(null); setError((err as Error).message); }
    } finally {
      if (n === seq.current) setBusy(false);
      onAsked?.();
    }
  };

  const band = result ? confidenceBand(result.confidence) : null;
  const shown = result ? [...result.cited, ...result.sources.map((s) => s.ref).filter((r) => !result.cited.includes(r))] : [];

  return (
    <section aria-labelledby="ask" className="card p-6 space-y-4">
      <div>
        <h2 id="ask" className="text-lg font-black text-ink-900 flex items-center gap-2"><MessageCircleQuestion size={18} /> Ask it a question</h2>
        <p className="text-sm text-ink-500 mt-1">Type a question as a customer would. You see the answer it would draft, and why, before any questionnaire arrives. Nothing about your question is saved; it counts towards your daily limit like a question in a response.</p>
      </div>
      <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); if (!busy) ask(); }}>
        <label className="flex-1">
          <span className="sr-only">Your question</span>
          <input className="input text-sm" value={question} maxLength={MAX_ASK_CHARS} onChange={(e) => setQuestion(e.target.value)}
            placeholder="How do you encrypt customer data at rest?" />
        </label>
        <button type="submit" disabled={busy || !question.trim()} className="btn-primary text-sm">{busy ? 'Asking…' : 'Ask'}</button>
      </form>
      <div aria-live="polite" className="space-y-3">
        {busy && <p className="text-sm text-ink-400">Matching, checking and drafting. This takes a few seconds.</p>}
        {error && <p role="alert" className="text-sm text-coral-600">{error}</p>}
        {result && !busy && (
          <div className="space-y-3 border-t border-ink-100 pt-4">
            <p className="text-xs text-ink-500">{askSummary(result)}</p>
            {result.draftKind !== 'person_required' && result.draftKind !== 'insufficient_evidence' && (
              <p className="text-sm text-ink-800 leading-relaxed whitespace-pre-line bg-ink-50 rounded-xl px-4 py-3">{result.draft}</p>
            )}
            <p className="text-xs text-ink-600">
              Confidence: <strong>{band?.label}</strong>{result.confidence !== null ? ` (${formatConfidence(result.confidence)})` : ''}
              {result.verdict && <> · Checker: <strong>{VERDICT[result.verdict] ?? result.verdict}</strong>{result.judgeReason ? `, ${result.judgeReason}` : ''}</>}
            </p>
            {result.note && <p className="text-xs text-ink-500">{result.note}</p>}
            {shown.length > 0 && (
              <div className="space-y-1">
                <p className="section-label">Answers it drew on</p>
                <ul className="space-y-1">
                  {shown.map((ref) => (
                    <li key={ref} className="text-xs text-ink-600">
                      <button className="font-bold underline" onClick={() => onOpen(ref)}>{ref}</button>
                      {questionOf(ref) ? ` ${questionOf(ref)}` : ''}{result.cited.includes(ref) ? ' (cited in the draft)' : ' (matched)'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
