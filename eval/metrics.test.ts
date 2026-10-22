// Sprint 1, story S1-4 test 1: retrieval metrics on hand-made rankings.
import { describe, expect, it } from 'vitest';
import { recallAt, meanReciprocalRank, cosine, rankBy, reciprocalRankFusion, auroc } from './metrics';

describe('retrieval metrics', () => {
  const rankings = [
    { gold: 'a', ranked: ['a', 'b', 'c'] }, // rank 1
    { gold: 'b', ranked: ['c', 'a', 'd', 'e', 'b'] }, // rank 5
    { gold: 'z', ranked: ['a', 'b'] }, // missing
  ];

  it('recall@k counts gold within the top k', () => {
    expect(recallAt(rankings, 1)).toBeCloseTo(1 / 3);
    expect(recallAt(rankings, 5)).toBeCloseTo(2 / 3);
  });

  it('MRR averages 1/rank, counting a miss as 0', () => {
    expect(meanReciprocalRank(rankings)).toBeCloseTo((1 + 1 / 5 + 0) / 3);
  });

  it('empty input gives 0, not NaN', () => {
    expect(recallAt([], 5)).toBe(0);
    expect(meanReciprocalRank([])).toBe(0);
  });

  it('cosine similarity of identical, orthogonal and opposite vectors', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });

  it('rankBy sorts ids by score, highest first, ties by id for stability', () => {
    expect(rankBy({ b: 0.5, a: 0.5, c: 0.9 })).toEqual(['c', 'a', 'b']);
  });

  it('reciprocal rank fusion rewards agreement between two rankings', () => {
    const fused = reciprocalRankFusion([['x', 'y', 'z'], ['y', 'x', 'w']], 60);
    expect(fused.slice(0, 2).sort()).toEqual(['x', 'y']);
    expect(fused.indexOf('z')).toBeGreaterThan(1);
  });

  it('AUROC: perfect, random-like and inverted separation', () => {
    expect(auroc([0.9, 0.8], [0.1, 0.2])).toBe(1);
    expect(auroc([0.1, 0.2], [0.9, 0.8])).toBe(0);
    expect(auroc([0.5], [0.5])).toBe(0.5);
  });
});
