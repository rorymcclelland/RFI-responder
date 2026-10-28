/**
 * Sprint 17 (S17-3, K-1): the knowledge page. The overview's counts come from the database
 * (knowledge_overview(), which reads under the caller's own rights); browsing filters and sorts the
 * entries in the browser. Search is by number and words (S15-1); by meaning comes with K-3.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { entryMatches } from './knowledgeBase';

export type EntryState = 'reviewed' | 'overdue' | 'waiting' | 'translation';
export type OriginGroup = 'imported' | 'response' | 'manual';
export type BrowseSort = 'number' | 'cited' | 'review';

export interface KnowledgeOverview {
  total: number;
  languages: { en: number; ja: number };
  contributors: number;
  states: { reviewed: number; overdue: number; waiting: number; translations: number };
  topics: { tag: string | null; entries: number; citations: number }[];
  learned: { ref: string; question: string; at: string; from: string | null; reviewed: boolean }[];
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
};

export function originGroup(origin: string): OriginGroup {
  return origin === 'response' ? 'response' : origin === 'manual' ? 'manual' : 'imported';
}

const UNKNOWN = { state: 'waiting' as EntryState, citations: 0, due: '' };

/** The entries to show, filtered and sorted. An entry the overview does not know counts as waiting. */
export function browse(entries: BrowseEntry[], info: KnowledgeOverview['entries'], f: BrowseFilters): BrowseEntry[] {
  const of = (e: BrowseEntry) => info[e.ref] ?? UNKNOWN;
  const out = entries.filter((e) =>
    (!f.states.length || f.states.includes(of(e).state))
    && (!f.languages.length || f.languages.includes(e.language))
    && (!f.origins.length || f.origins.includes(originGroup(e.origin)))
    && (f.topic === null || (f.topic === '' ? e.tags.length === 0 : e.tags.includes(f.topic)))
    && entryMatches({ id: e.ref, question: e.question, answer: e.answer, tags: e.tags }, f.query));
  const byRef = (a: BrowseEntry, b: BrowseEntry) => a.ref.localeCompare(b.ref);
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
    case 'response': return `Learned from a response${e.originRef ? ` (${e.originRef})` : ''}, answer approved by ${who}`;
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

export async function loadBrowseEntries(client: SupabaseClient): Promise<BrowseEntry[]> {
  const { data, error } = await client.from('kb_entries')
    .select('ref, question, answer, tags, source, origin, origin_ref, created_by, created_at, language, translated_from')
    .is('superseded_by', null).order('seq', { ascending: true });
  if (error) {
    console.error('kb_entries read failed', error);
    throw new Error('The knowledge base could not be loaded. Check your connection and try again.');
  }
  return (data ?? []).map((r) => ({
    ref: r.ref as string, question: r.question as string, answer: r.answer as string,
    tags: (r.tags as string[] | null) ?? [], source: (r.source as string) ?? '', origin: r.origin as string,
    originRef: (r.origin_ref as string | null) ?? null, createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as string, language: r.language === 'ja' ? 'ja' : 'en',
    translatedFrom: Array.isArray(r.translated_from) ? (r.translated_from as string[]) : null,
  }));
}
