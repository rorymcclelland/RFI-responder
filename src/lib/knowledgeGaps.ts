/**
 * Sprint 21 (S21-2, K-4): gaps, what the knowledge base could not answer in recent responses, grouped
 * by wording, with where each group stands. The database decides the groups and their states
 * (knowledge_gaps(), which reads under the caller's own rights); this names them and counts them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type GapState = 'open' | 'answered' | 'learned' | 'not_learned' | 'unanswered';

export interface Gap {
  question: string;
  state: GapState;
  /** How many responses asked it, in the same wording. */
  responses: number;
  lastAsked: string;
  /** The entry it became, when learned. */
  entryRef: string | null;
  /** The question shown, and opened: the group's furthest one. */
  responseId: string;
  response: string;
  sessionId: string;
  questionId: string;
}

/** The order the filters list them in: what needs someone first. */
export const GAP_STATES: GapState[] = ['open', 'answered', 'learned', 'not_learned', 'unanswered'];

export const GAP_LABEL: Record<GapState, string> = {
  open: 'Not answered yet',
  answered: 'Answered, learned when sent',
  learned: 'Learned',
  not_learned: 'Answered, not added',
  unanswered: 'Left unanswered',
};

export const GAP_EXPLAIN: Record<GapState, string> = {
  open: 'Still to do in its response: open it there to write the answer or assign it.',
  answered: 'A person approved an answer. The knowledge base learns it when the response is marked as sent.',
  learned: 'A person answered it, and the answer is now in the knowledge base.',
  not_learned: 'Answered, and considered when the response was marked as sent, but not added (for instance the same answer as before, or not fully checked).',
  unanswered: 'The owner left it unanswered, or its response was archived first.',
};

export function gapCounts(gaps: Gap[]): Record<GapState, number> {
  const counts = { open: 0, answered: 0, learned: 0, not_learned: 0, unanswered: 0 } as Record<GapState, number>;
  for (const g of gaps) counts[g.state] += 1;
  return counts;
}

export function filterGaps(gaps: Gap[], states: GapState[]): Gap[] {
  return states.length ? gaps.filter((g) => states.includes(g.state)) : gaps;
}

export async function loadKnowledgeGaps(client: SupabaseClient): Promise<Gap[]> {
  const { data, error } = await client.rpc('knowledge_gaps');
  if (error || !Array.isArray(data)) {
    if (error) console.error('knowledge_gaps failed', error);
    throw new Error('The gaps could not be loaded. Check your connection and try again.');
  }
  return data as Gap[];
}
