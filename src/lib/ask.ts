/**
 * Sprint 18 (S18-4, K-3): ask the knowledge base a question. The ask-knowledge Edge Function runs the
 * same pipeline as a response and saves nothing but the cost; this module calls it and words the result.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { functionErrorMessage } from './sessions';

export const MAX_ASK_CHARS = 2000;

export interface AskResult {
  question: string;
  draft: string;
  draftKind: 'generated' | 'assembled' | 'insufficient_evidence' | 'person_required';
  confidence: number | null;
  verdict: 'yes' | 'partly' | 'no' | null;
  judgeReason: string | null;
  gate: string | null;
  gateReason: string | null;
  language: 'en' | 'ja';
  cited: string[];
  sources: { ref: string; score: number }[];
  note: string | null;
}

export async function askKnowledge(client: SupabaseClient, question: string): Promise<AskResult> {
  const q = question.trim();
  if (!q) throw new Error('Type a question to ask.');
  if (q.length > MAX_ASK_CHARS) throw new Error(`Keep the question to ${MAX_ASK_CHARS} characters.`);
  const { data, error } = await client.functions.invoke('ask-knowledge', { body: { question: q } });
  if (error) throw new Error((await functionErrorMessage(error)).message);
  const result = (data as { result?: AskResult } | null)?.result;
  if (!result) throw new Error('The question could not be answered just now. Try again shortly.');
  return result;
}

/** What the result means, in a sentence, before the draft. */
export function askSummary(r: Pick<AskResult, 'draftKind' | 'gate' | 'gateReason'>): string {
  if (r.draftKind === 'person_required') return 'A person must answer pricing questions; none is drafted.';
  if (r.draftKind === 'insufficient_evidence') return 'The knowledge base does not answer this, so nothing is drafted. In a response, a person would write the answer.';
  if (r.gate) return `In a response this draft would be held for a person to approve individually: ${r.gateReason ?? 'see the reason on the question'}`;
  return 'In a response, a person would approve it before it is sent.';
}
