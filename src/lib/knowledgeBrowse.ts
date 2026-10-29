/**
 * Sprint 17 (S17-3, K-1): the knowledge page. The overview's counts come from the database
 * (knowledge_overview(), which reads under the caller's own rights); browsing filters and sorts the
 * entries in the browser. Search is by number and words (S15-1); by meaning comes with K-3.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { entryMatches } from './knowledgeBase';

export type EntryState = 'reviewed' | 'overdue' | 'waiting' | 'translation' | 'retired';
export type OriginGroup = 'imported' | 'response' | 'manual';
export type BrowseSort = 'number' | 'cited' | 'review';

export interface KnowledgeOverview {
  total: number;
  languages: { en: number; ja: number };
  contributors: number;
  states: { reviewed: number; overdue: number; waiting: number; translations: number; proposals: number; retired: number };
  topics: { tag: string | null; entries: number; citations: number }[];
  /** `from` is the response's name; `replaces` is set when the entry is a proposed change to that entry. */
  learned: { ref: string; question: string; at: string; from: string | null; reviewed: boolean; replaces: string | null }[];
  entries: Record<string, { state: EntryState; citations: number; due: string }>;
}

export interface BrowseEntry {
  ref: string; question: string; answer: string; tags: string[]; source: string;
  origin: string; originRef: string | null; createdBy: string | null; createdAt: string;
  language: 'en' | 'ja'; translatedFrom: string[] | null;
}

export interface BrowseFilters {
  query: string;
  states: EntryState[];
  languages: ('en' | 'ja')[];
  origins: OriginGroup[];
  topic: string | null;
  sort: BrowseSort;
}

export const EMPTY_FILTERS: BrowseFilters = { query: '', states: [], languages: [], origins: [], topic: null, sort: 'number' };

export const STATE_LABEL: Record<EntryState, string> = {
  reviewed: 'Reviewed and current', overdue: 'Overdue for review', waiting: 'Waiting for review', translation: 'Translation to check',
  retired: 'Retired',
};

export function originGroup(origin: string): OriginGroup {
  return origin === 'response' ? 'response' : origin === 'manual' ? 'manual' : 'imported';
}

const UNKNOWN = { state: 'waiting' as EntryState, citations: 0, due: '' };

/** An entry number's place in order: KB-10000 comes after KB-9999 (Sprint 18, BUG-42). */
const refNumber = (ref: string) => Number(/(\d+)$/.exec(ref)?.[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * The entries to show, filtered and sorted. An entry the overview does not know counts as waiting.
 * Retired answers are shown only when the Retired state is chosen (Sprint 18, S18-3).
 */
export function browse(entries: BrowseEntry[], info: KnowledgeOverview['entries'], f: BrowseFilters): BrowseEntry[] {
  const of = (e: BrowseEntry) => info[e.ref] ?? UNKNOWN;
  const out = entries.filter((e) =>
    (f.states.length ? f.states.includes(of(e).state) : of(e).state !== 'retired')
    && (!f.languages.length || f.languages.includes(e.language))
    && (!f.origins.length || f.origins.includes(originGroup(e.origin)))
    && (f.topic === null || (f.topic === '' ? e.tags.length === 0 : e.tags.includes(f.topic)))
    && entryMatches({ id: e.ref, question: e.question, answer: e.answer, tags: e.tags }, f.query));
  const byRef = (a: BrowseEntry, b: BrowseEntry) => refNumber(a.ref) - refNumber(b.ref) || a.ref.localeCompare(b.ref);
  if (f.sort === 'cited') return out.sort((a, b) => of(b).citations - of(a).citations || byRef(a, b));
  if (f.sort === 'review') return out.sort((a, b) => (of(a).due || '9999').localeCompare(of(b).due || '9999') || byRef(a, b));
  return out.sort(byRef);
}

/** Where an answer came from, in words. */
export function describeSource(e: BrowseEntry, names: Map<string, string>): string {
  const who = (e.createdBy && names.get(e.createdBy)) || 'a former team member';
  if (e.translatedFrom?.length) {
    return `Machine translation of ${e.translatedFrom.join(', ')} (${e.language === 'ja' ? 'English' : 'Japanese'})`;
  }
  const file = e.originRef ? e.originRef.split('/').pop() : null;
  switch (e.origin) {
    case 'seed': return `Loaded with the demo data${file ? `, from ${file}` : ''}`;
    case 'import': return `Imported by ${who}${file ? ` from ${file}` : ''}`;
    case 'manual': return `Added by hand by ${who}`;
    case 'response': {
      // origin_ref is an internal path of ids; the source names the response ("RFI response: <name>").
      const name = e.source.replace(/^RFI response: /, '').trim();
      return `Learned from ${name ? `the response ${name}` : 'a response'}, answer approved by ${who}`;
    }
    default: return 'Source not recorded';
  }
}

export async function loadKnowledgeOverview(client: SupabaseClient): Promise<KnowledgeOverview> {
  const { data, error } = await client.rpc('knowledge_overview');
  if (error || !data) {
    if (error) console.error('knowledge_overview failed', error);
    throw new Error('The knowledge base overview could not be loaded. Check your connection and try again.');
  }
  return data as KnowledgeOverview;
}

/** Rows per request: the API returns at most 1,000 (`max_rows`), so the list is read a page at a time. */
export const BROWSE_PAGE = 1000;

export async function loadBrowseEntries(client: SupabaseClient): Promise<BrowseEntry[]> {
  const data: Record<string, unknown>[] = [];
  for (let from = 0; ; from += BROWSE_PAGE) {
    // Current entries only: not replaced ones, and not proposed changes still waiting for review.
    const { data: page, error } = await client.from('kb_entries')
      .select('ref, question, answer, tags, source, origin, origin_ref, created_by, created_at, language, translated_from')
      .is('superseded_by', null).is('proposed_replacement_of', null)
      .order('seq', { ascending: true }).range(from, from + BROWSE_PAGE - 1);
    if (error) {
      console.error('kb_entries read failed', error);
      throw new Error('The knowledge base could not be loaded. Check your connection and try again.');
    }
    data.push(...((page ?? []) as Record<string, unknown>[]));
    if (!page || page.length < BROWSE_PAGE) break;
  }
  return data.map((r) => ({
    ref: r.ref as string, question: r.question as string, answer: r.answer as string,
    tags: (r.tags as string[] | null) ?? [], source: (r.source as string) ?? '', origin: r.origin as string,
    originRef: (r.origin_ref as string | null) ?? null, createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string, language: r.language === 'ja' ? 'ja' : 'en',
    translatedFrom: Array.isArray(r.translated_from) ? (r.translated_from as string[]) : null,
  }));
}
