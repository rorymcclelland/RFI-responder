/**
 * Reading and adding to the shared knowledge base (table kb_entries).
 * Imports go through the import_kb_entries database function, which is
 * all-or-nothing, skips duplicates and reports counts. See decision 0003 for
 * who may do what.
 */
import { supabase } from './supabase';
import { functionErrorMessage } from './sessions';
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
    .select('ref, question, answer, tags, source, reviewed_at, language')
    .is('superseded_by', null)
    .order('seq', { ascending: true });
  if (error) throw new Error(`Could not load the knowledge base: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.ref as string,
    question: r.question as string,
    answer: r.answer as string,
    tags: (r.tags as string[] | null) ?? [],
    source: (r.source as string) || undefined,
    reviewed: r.reviewed_at !== null,
    language: r.language === 'ja' ? 'ja' : 'en',
  }));
}

/** The digits of an entry number, without leading zeros ("KB-0101" -> "101"), or null. */
function entryNumber(text: string): string | null {
  const m = /^(?:kb[-\s]?)?(\d+)$/i.exec(text);
  return m ? m[1].replace(/^0+(?=\d)/, '') : null;
}

/**
 * Sprint 15 (S15-1, BUG-36): does an entry match what was typed in the knowledge-base search?
 * By number ("KB-0101", "kb0101", "0101" or "101" all find KB-0101), or by the text of its
 * question, answer or tags, ignoring case. Plain text comparison: nothing typed is a pattern.
 */
export function entryMatches(entry: Pick<KnowledgeEntry, 'id' | 'question' | 'answer' | 'tags'>, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const wanted = entryNumber(q);
  if (wanted !== null && wanted === entryNumber(entry.id)) return true;
  const lower = q.toLowerCase();
  return entry.question.toLowerCase().includes(lower)
    || entry.answer.toLowerCase().includes(lower)
    || entry.tags.some((t) => t.toLowerCase().includes(lower));
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

export type IndexResult = { ok: true; embedded: number } | { ok: false; reason: string };

/**
 * Sprint 16 (S16-2, BUG-40): the message for a saved entry, returned at once, while indexing runs in
 * the background. After a demo reset indexing covers the whole knowledge base and can take seconds;
 * the save does not wait for it. If indexing fails, `onIndexFailed` gets the message to show.
 */
export function confirmThenIndex(saved: { ref: string; reviewed: boolean }, index: () => Promise<IndexResult>, onIndexFailed: (message: string) => void): string {
  const failed = (reason: string) => onIndexFailed(`${saved.ref} is saved but could not be indexed yet (${reason}), so it is indexed before the next questions are matched, if your daily limit allows.`);
  index().then((r) => { if (!r.ok) failed(r.reason); }, (err: unknown) => failed(err instanceof Error ? err.message : 'no response'));
  return `${saved.ref} added.${saved.reviewed ? '' : ' An admin will review it; until then, drafts that cite it are not bulk-approved.'}`;
}

/** The run in progress, shared by every caller until it finishes (Sprint 16 security review, M2). */
let indexing: Promise<IndexResult> | null = null;

/**
 * Ask the server to embed entries that have no vector from the configured model yet
 * (S1-3). Never throws: an import still counts if indexing fails, and the entries
 * are picked up by the next call. A call made while a run is in progress joins that
 * run, so two quick additions, or one during the sign-in run, do not index (and pay
 * for) the same entries twice.
 */
export function indexNewEntries(): Promise<IndexResult> {
  if (!indexing) indexing = runIndexing().finally(() => { indexing = null; });
  return indexing;
}

async function runIndexing(): Promise<IndexResult> {
  const { data, error } = await supabase.functions.invoke('embed-entries', { body: {} });
  if (error || !data) return { ok: false, reason: (await functionErrorMessage(error)).message };
  const d = data as { embedded: number; limit?: string | null };
  // Part-indexed at a usage cap (Sprint 4): the rest are picked up by a later call.
  if (d.limit) return { ok: false, reason: `${d.embedded} indexed; ${d.limit}` };
  return { ok: true, embedded: d.embedded };
}
