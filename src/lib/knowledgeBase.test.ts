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
