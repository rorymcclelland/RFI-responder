// Sprint 0, story S0-4: the import summary the user sees (tests 1, 3 and 4).
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { describeImport } = await import('./knowledgeBase');

describe('describeImport', () => {
  it('reports a clean import', () => {
    expect(describeImport({ inserted: 100, duplicates: 0, invalid: 0 })).toBe('100 entries added to the knowledge base.');
  });

  it('reports duplicates on a repeated import', () => {
    expect(describeImport({ inserted: 0, duplicates: 100, invalid: 0 })).toBe(
      '0 entries added to the knowledge base; 100 duplicates skipped.',
    );
  });

  it('reports skipped invalid rows, with singulars', () => {
    expect(describeImport({ inserted: 1, duplicates: 1, invalid: 1 })).toBe(
      '1 entry added to the knowledge base; 1 duplicate skipped; 1 row without a question or answer skipped.',
    );
  });
});

// Sprint 15, story S15-1 (BUG-36): searching by entry number.
describe('entryMatches', async () => {
  const { entryMatches } = await import('./knowledgeBase');
  const e = (id: string, question = 'Do you encrypt data?', answer = 'Yes.', tags: string[] = []) => ({ id, question, answer, tags });
  const kb0101 = e('KB-0101');
  const kb0010 = e('KB-0010');
  const kb1010 = e('KB-1010');
  const text101 = e('KB-0002', 'Is room 101 locked?', 'Always.', ['physical']);

  it('finds an entry by its number, with or without the prefix and leading zeros (test 1)', () => {
    for (const q of ['KB-0101', 'kb-0101', 'KB0101', 'kb 101', '0101', ' 101 ']) {
      expect(entryMatches(kb0101, q), q).toBe(true);
      expect(entryMatches(kb0010, q), q).toBe(false);
      expect(entryMatches(kb1010, q), q).toBe(false);
    }
  });

  it('a bare number also finds text containing it (test 2)', () => {
    expect(entryMatches(text101, '101')).toBe(true);
    expect(entryMatches(text101, 'KB-0101')).toBe(false);
  });

  it('searches question, answer and tags as before, ignoring case (test 3)', () => {
    expect(entryMatches(text101, 'ROOM')).toBe(true);
    expect(entryMatches(text101, 'always')).toBe(true);
    expect(entryMatches(text101, 'Physical')).toBe(true);
    expect(entryMatches(text101, 'firewall')).toBe(false);
  });

  it('an empty query matches everything; "KB-" alone matches no number (test 4)', () => {
    expect(entryMatches(kb0101, '')).toBe(true);
    expect(entryMatches(kb0101, '   ')).toBe(true);
    expect(entryMatches(kb0101, 'KB-')).toBe(false);
    expect(entryMatches(e('KB-0003', 'What is KB-style search?'), 'kb-')).toBe(true);
  });

  it('treats pattern characters as text and survives a long query (test 5)', () => {
    expect(entryMatches(kb0101, '.*')).toBe(false);
    expect(entryMatches(e('KB-0004', 'Costs (in GBP) [approx]'), '(in GBP) [')).toBe(true);
    expect(entryMatches(kb0101, '9'.repeat(10_000))).toBe(false);
    expect(entryMatches(kb0101, 'x'.repeat(100_000))).toBe(false);
  });
});
