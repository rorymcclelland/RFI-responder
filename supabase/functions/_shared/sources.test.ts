// Sprint 1, story S1-5 (moved server-side in Sprint 2): which matches a draft is built from.
import { describe, expect, it } from 'vitest';
import { selectDraftSources, type MatchRow } from './sources';

const row = (q: string, similarity: number | null, keyword: number | null, fused: number, model: string | null = 'voyage-4'): MatchRow => ({
  id: q, ref: `KB-${q}`, question: q, answer: `Answer to ${q}.`, tags: [], source: '',
  similarity, keyword_rank: keyword, fused_score: fused, embedding_model: model,
});

describe('selectDraftSources', () => {
  it('uses the top entry and any others within 0.05 similarity of it, at most three', () => {
    const picked = selectDraftSources([row('a', 0.80, null, 0.03), row('b', 0.77, null, 0.02), row('c', 0.60, 0.1, 0.02)]);
    expect(picked.map((s) => s.entry.question)).toEqual(['a', 'b']);
    expect(picked[0].entry.id).toBe('KB-a');
  });

  it('keyword-only results: the top two that matched', () => {
    const picked = selectDraftSources([row('a', null, 0.4, 0.016, null), row('b', null, 0.2, 0.015, null), row('c', null, 0.1, 0.014, null)]);
    expect(picked.map((s) => s.entry.question)).toEqual(['a', 'b']);
  });

  it('no rows gives no sources', () => {
    expect(selectDraftSources([])).toEqual([]);
  });
});
