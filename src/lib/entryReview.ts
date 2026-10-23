/**
 * Adding entries by hand and reviewing them (Sprint 4, S4-3 and S4-4).
 *
 * The database decides whether a new entry starts reviewed (an admin's does, a member's does not)
 * and only review_entry() can review one. Until an entry is reviewed, or while it is overdue for
 * review, drafts that cite it are never bulk-approved.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DraftEntry { question: string; answer: string; tags: string[]; source: string }

/** Same limits as the database (kb_entries checks). */
export function validateEntry(e: DraftEntry): string | null {
  if (e.question.trim().length === 0) return 'Write the question this entry answers.';
  if (e.answer.trim().length === 0) return 'Write the answer.';
  if (e.question.trim().length > 5000) return 'The question is too long (5,000 characters at most).';
  if (e.answer.trim().length > 20000) return 'The answer is too long (20,000 characters at most).';
  if (e.source.length > 500) return 'The source is too long (500 characters at most).';
  if (e.tags.length > 20) return 'Use at most 20 tags.';
  return null;
}

export const parseTags = (text: string) => [...new Set(text.split(',').map((t) => t.trim()).filter(Boolean))];

/** Adds an entry as the signed-in user; returns its reference and whether it starts reviewed. */
export async function addEntry(client: SupabaseClient, e: DraftEntry): Promise<{ ref: string; reviewed: boolean }> {
  const problem = validateEntry(e);
  if (problem) throw new Error(problem);
  const { data, error } = await client
    .from('kb_entries')
    .insert({ question: e.question.trim(), answer: e.answer.trim(), tags: e.tags, source: e.source.trim(), origin: 'manual' })
    .select('ref, reviewed_at')
    .single();
  if (error || !data) {
    if (error?.code === '23505') throw new Error('An entry with this question already exists.');
    throw new Error(`The entry was not saved: ${error?.message ?? 'no response'}`);
  }
  return { ref: data.ref as string, reviewed: data.reviewed_at !== null };
}

export interface EntryForReview {
  id: string; ref: string; question: string; answer: string; tags: string[]; source: string;
  origin: string; originRef: string | null; addedBy: string | null; createdAt: string;
  /** Sprint 4 review: the entry this one would replace once an admin approves it. */
  replaces?: { ref: string; answer: string } | null;
  /** S4-4: when the entry fell due for review, and how often drafts cited it in the last 90 days. */
  dueSince?: string;
  recentCitations?: number;
}

const toEntry = (r: Record<string, unknown>): EntryForReview => ({
  id: r.id as string, ref: r.ref as string, question: r.question as string, answer: r.answer as string,
  tags: (r.tags as string[] | null) ?? [], source: (r.source as string) ?? '', origin: r.origin as string,
  originRef: (r.origin_ref as string | null) ?? null,
  addedBy: typeof r.added_by === 'string' ? r.added_by : ((r.added_by as { display_name?: string } | null)?.display_name) ?? null,
  createdAt: r.created_at as string,
  replaces: (r.replaces as { ref: string; answer: string } | null) ?? null,
  ...(r.review_due ? { dueSince: r.review_due as string, recentCitations: Number(r.recent_citations ?? 0) } : {}),
});

/** S4-4: current entries past their review date, longest overdue first (admins). */
export async function loadOverdueEntries(client: SupabaseClient): Promise<EntryForReview[]> {
  const { data, error } = await client.rpc('overdue_entries');
  if (error) throw new Error(`The overdue report could not be read: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(toEntry);
}

/**
 * Current entries nobody with authority has reviewed, oldest first (admins). A link to another
 * row of the same table is embedded by its column name (PostgREST does not resolve the
 * constraint-name hint for a self-reference; found in the Sprint 4 end-to-end run).
 */
export async function loadEntriesToReview(client: SupabaseClient): Promise<EntryForReview[]> {
  const { data, error } = await client
    .from('kb_entries')
    .select('id, ref, question, answer, tags, source, origin, origin_ref, created_at, added_by:user_profiles!kb_entries_created_by_fkey(display_name), replaces:proposed_replacement_of(ref, answer)')
    .is('reviewed_at', null)
    .is('superseded_by', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Entries to review could not be read: ${error.message}`);
  return (data ?? []).map((r) => toEntry(r as Record<string, unknown>));
}

/** Approve an entry, optionally correcting it first (admins). */
export async function reviewEntry(client: SupabaseClient, id: string, edits: { question?: string; answer?: string } = {}): Promise<void> {
  if (edits.question !== undefined || edits.answer !== undefined) {
    const problem = validateEntry({ question: edits.question ?? 'x', answer: edits.answer ?? 'x', tags: [], source: '' });
    if (problem) throw new Error(problem);
  }
  const { error } = await client.rpc('review_entry', { p_entry: id, p_question: edits.question ?? null, p_answer: edits.answer ?? null });
  if (error) throw new Error(`The review was not saved: ${error.message}`);
}

export function describeOrigin(e: Pick<EntryForReview, 'origin' | 'originRef' | 'addedBy'>): string {
  const who = e.addedBy ?? 'a former team member';
  switch (e.origin) {
    case 'manual': return `Added by hand by ${who}`;
    case 'import': return `Imported by ${who}${e.originRef ? ` from ${e.originRef}` : ''}`;
    case 'response': return `Learned from a response; answer approved by ${who}, who is not an admin`;
    default: return `Seed data`;
  }
}
