/**
 * Reading and adding to the shared knowledge base (table kb_entries).
 * Imports go through the import_kb_entries database function, which is
 * all-or-nothing, skips duplicates and reports counts. See decision 0003 for
 * who may do what.
 */
import { supabase } from './supabase';
import type { KnowledgeEntry } from '../types';

export type KbOrigin = 'manual' | 'import' | 'response';

export interface ImportResult {
  inserted: number;
  duplicates: number;
  invalid: number;
}

export type NewEntry = Omit<KnowledgeEntry, 'id'>;

/** Current (not superseded) entries, oldest first. `id` is the short reference, e.g. KB-0042. */
export async function loadKnowledgeBase(): Promise<KnowledgeEntry[]> {
  const { data, error } = await supabase
    .from('kb_entries')
    .select('ref, question, answer, tags, source')
    .is('superseded_by', null)
    .order('seq', { ascending: true });
  if (error) throw new Error(`Could not load the knowledge base: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.ref as string,
    question: r.question as string,
    answer: r.answer as string,
    tags: (r.tags as string[] | null) ?? [],
    source: (r.source as string) || undefined,
  }));
}

export async function importEntries(entries: NewEntry[], origin: KbOrigin, originRef: string): Promise<ImportResult> {
  const { data, error } = await supabase.rpc('import_kb_entries', {
    entries: entries.map((e) => ({ question: e.question, answer: e.answer, tags: e.tags, source: e.source ?? '' })),
    entry_origin: origin,
    entry_origin_ref: originRef,
  });
  if (error) throw new Error(`Nothing was saved: ${error.message}`);
  return data as ImportResult;
}

/** One-line summary of an import for the user. */
export function describeImport(r: ImportResult): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [`${plural(r.inserted, 'entry', 'entries')} added to the knowledge base`];
  if (r.duplicates > 0) parts.push(`${plural(r.duplicates, 'duplicate', 'duplicates')} skipped`);
  if (r.invalid > 0) parts.push(`${plural(r.invalid, 'row', 'rows')} without a question or answer skipped`);
  return parts.join('; ') + '.';
}

/**
 * Ask the server to embed entries that have no vector from the configured model yet
 * (S1-3). Never throws: an import still counts if indexing fails, and the entries
 * are picked up by the next call.
 */
export async function indexNewEntries(): Promise<{ ok: true; embedded: number } | { ok: false; reason: string }> {
  const { data, error } = await supabase.functions.invoke('embed-entries', { body: {} });
  if (error || !data) return { ok: false, reason: error?.message ?? 'no response' };
  return { ok: true, embedded: (data as { embedded: number }).embedded };
}
