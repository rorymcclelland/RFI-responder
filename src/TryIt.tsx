/**
 * Sprint 23 (S23-1, U-8): Try it, on Home and Responses. Makes your own try from the sample
 * questionnaire, or opens the one you have (Q4: one open try each); Start a new try puts the open
 * one away first. Drafting happens on the try's page, as for any file not yet drafted.
 */
import { useEffect, useState } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import { supabase } from './lib/supabase';
import { openResponse } from './lib/openQuestion';
import { TRY_SAMPLE, openTry, startNewTry, startTry } from './lib/tryIt';
import type { UserProfile } from './types';

export default function TryIt({ currentUser, compact = false }: { currentUser: UserProfile; compact?: boolean }) {
  const [hasTry, setHasTry] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    openTry(supabase, currentUser.id).then((t) => { if (live) setHasTry(Boolean(t)); }).catch(() => { if (live) setHasTry(false); });
    return () => { live = false; };
  }, [currentUser.id]);

  const go = async (fresh: boolean) => {
    setBusy(true); setError('');
    try {
      const t = await (fresh ? startNewTry : startTry)(supabase, currentUser.id, currentUser.displayName);
      openResponse(t.responseId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Try it" className={`rounded-2xl border border-sky-200 bg-sky-50/60 ${compact ? 'p-4' : 'p-5'} space-y-2`}>
      <p className="text-sm text-ink-700">
        <span className="font-bold text-ink-900">Try it with a sample questionnaire.</span>{' '}
        Your own copy of a short questionnaire from {TRY_SAMPLE.replace(': security questionnaire', '')}, drafted from the knowledge base for you to approve, download and mark as sent.
        Nothing you do in a try is learned by the knowledge base.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => go(false)} disabled={busy || hasTry === null} className="btn-primary text-sm disabled:opacity-50">
          <FlaskConical size={14} aria-hidden="true" /> {busy ? 'Making your try…' : hasTry ? 'Open your try' : 'Try it with a sample questionnaire'}
        </button>
        {hasTry && (
          <button onClick={() => go(true)} disabled={busy} className="btn-ghost text-sm disabled:opacity-50">
            <RefreshCw size={14} aria-hidden="true" /> Start a new try
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-coral-700">{error}</p>}
    </section>
  );
}
