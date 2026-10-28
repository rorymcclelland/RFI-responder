// Sprint 17, S17-3 (K-1): browsing the knowledge base. Test numbers: docs/refinement/sprint-17.md.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { browse, describeSource, EMPTY_FILTERS } = await import('./knowledgeBrowse');

const e = (ref: string, o: Partial<Record<string, unknown>> = {}) => ({
  ref, question: `Question ${ref}?`, answer: 'Yes.', tags: [] as string[], source: '', origin: 'import', originRef: null as string | null,
  createdBy: 'u1', createdAt: '2026-01-01T00:00:00Z', language: 'en' as 'en' | 'ja', translatedFrom: null as string[] | null, ...o,
});
const entries = [
  e('KB-0001', { tags: ['encryption'] }),
  e('KB-0002', { language: 'ja', translatedFrom: ['KB-0001'], origin: 'seed' }),
  e('KB-0003', { origin: 'response', originRef: 'Bluefin Freight: A7' }),
  e('KB-0004', { origin: 'manual', question: 'Do you encrypt laptops?' }),
];
const states = {
  'KB-0001': { state: 'reviewed', citations: 9, due: '2027-03-01T00:00:00Z' },
  'KB-0002': { state: 'translation', citations: 1, due: '2026-12-01T00:00:00Z' },
  'KB-0003': { state: 'waiting', citations: 0, due: '2027-01-01T00:00:00Z' },
  'KB-0004': { state: 'overdue', citations: 3, due: '2025-01-01T00:00:00Z' },
};
const refs = (r: { ref: string }[]) => r.map((x) => x.ref);

describe('browse (test 4)', () => {
  it('with no filters lists every entry by number', () => {
    expect(refs(browse(entries as never, states as never, EMPTY_FILTERS))).toEqual(['KB-0001', 'KB-0002', 'KB-0003', 'KB-0004']);
  });

  it('filters by state, language and where it came from, and combines them', () => {
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, states: ['translation', 'waiting'] }))).toEqual(['KB-0002', 'KB-0003']);
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, languages: ['ja'], states: ['waiting'] }))).toEqual([]);
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, origins: ['imported'] }))).toEqual(['KB-0001', 'KB-0002']);
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, origins: ['response', 'manual'] }))).toEqual(['KB-0003', 'KB-0004']);
  });

  it('searches by number and words, as the knowledge-base search does', () => {
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, query: '4' }))).toEqual(['KB-0004']);
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, query: 'encrypt' }))).toEqual(['KB-0001', 'KB-0004']);
  });

  it('sorts by most cited, and by oldest review date first', () => {
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, sort: 'cited' }))).toEqual(['KB-0001', 'KB-0004', 'KB-0002', 'KB-0003']);
    expect(refs(browse(entries as never, states as never, { ...EMPTY_FILTERS, sort: 'review' }))).toEqual(['KB-0004', 'KB-0002', 'KB-0003', 'KB-0001']);
  });

  it('an entry missing from the overview counts as waiting with no citations, not an error', () => {
    expect(refs(browse([e('KB-0009')] as never, {} as never, { ...EMPTY_FILTERS, states: ['waiting'] }))).toEqual(['KB-0009']);
  });

  it('7. a very long search does not hang', () => {
    const t = Date.now();
    browse(entries as never, states as never, { ...EMPTY_FILTERS, query: 'x'.repeat(100_000) });
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe('describeSource (test 5)', () => {
  const names = new Map([['u1', 'Sarah Chen']]);
  it('says where each answer came from, in words', () => {
    expect(describeSource(e('KB-1', { origin: 'import', originRef: 'policies.xlsx' }) as never, names)).toBe('Imported by Sarah Chen from policies.xlsx');
    expect(describeSource(e('KB-1', { origin: 'seed', originRef: 'sample-data/security-qa.csv' }) as never, names)).toBe('Loaded with the demo data, from security-qa.csv');
    expect(describeSource(e('KB-1', { origin: 'manual' }) as never, names)).toBe('Added by hand by Sarah Chen');
    expect(describeSource(e('KB-1', { origin: 'response', originRef: 'Bluefin Freight: A7' }) as never, names)).toBe('Learned from a response (Bluefin Freight: A7), answer approved by Sarah Chen');
    expect(describeSource(e('KB-1', { language: 'ja', translatedFrom: ['KB-0001'], origin: 'seed' }) as never, names)).toBe('Machine translation of KB-0001 (English)');
    expect(describeSource(e('KB-1', { origin: 'manual', createdBy: 'gone' }) as never, names)).toBe('Added by hand by a former team member');
  });
});
