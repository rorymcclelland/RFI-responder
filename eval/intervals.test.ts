// Sprint 8, S8-1. Test numbers refer to docs/refinement/sprint-8.md.
import { describe, expect, it } from 'vitest';
import { bootstrap, clusteredProportion, formatInterval, wilson } from './intervals';

describe('S8-1 test 1: Wilson intervals for proportions', () => {
  it.each([
    [0, 33, 0, 0.1043],
    [100, 100, 0.963, 1],
    [7, 70, 0.0493, 0.1922],
  ])('%i of %i', (k, n, lo, hi) => {
    const i = wilson(k, n);
    expect(i.low).toBeCloseTo(lo, 3);
    expect(i.high).toBeCloseTo(hi, 3);
  });
  it('refuses impossible counts', () => {
    expect(() => wilson(3, 2)).toThrow();
    expect(() => wilson(0, 0)).toThrow();
    expect(() => wilson(-1, 5)).toThrow();
  });
});

describe('S8-1 test 2: the bootstrap repeats with a seed and contains the estimate', () => {
  const xs = Array.from({ length: 80 }, (_, i) => (i * 37) % 11);
  const mean = (s: number[]) => s.reduce((a, b) => a + b, 0) / s.length;
  it('gives the same interval twice with the same seed', () => {
    expect(bootstrap(xs, mean, { seed: 7 })).toEqual(bootstrap(xs, mean, { seed: 7 }));
    expect(bootstrap(xs, mean, { seed: 7 })).not.toEqual(bootstrap(xs, mean, { seed: 8 }));
  });
  it('contains the point estimate', () => {
    const i = bootstrap(xs, mean, { seed: 1 });
    expect(i.low).toBeLessThanOrEqual(mean(xs));
    expect(i.high).toBeGreaterThanOrEqual(mean(xs));
    expect(i.high - i.low).toBeGreaterThan(0);
  });
});

describe('S8-1 test 3: clustered figures', () => {
  it('give a wider interval than treating every item as independent', () => {
    // 10 drafts of 10 claims; two drafts wholly wrong: failures come in clusters.
    const clusters = Array.from({ length: 10 }, (_, i) => ({ k: i < 2 ? 0 : 10, n: 10 }));
    const c = clusteredProportion(clusters, { seed: 3 });
    const flat = wilson(80, 100);
    expect(c.method).toBe('bootstrap by cluster');
    expect(c.high - c.low).toBeGreaterThan(flat.high - flat.low);
  });
  it('with no failures, fall back to Wilson over clusters, since resampling would give no width', () => {
    const c = clusteredProportion(Array.from({ length: 46 }, () => ({ k: 5, n: 5 })), { seed: 3 });
    expect(c.method).toBe('Wilson over clusters (no failures to resample)');
    expect(c.low).toBeCloseTo(wilson(46, 46).low, 6);
    expect(c.high).toBe(1);
  });
});

describe('formatting', () => {
  it('writes percentages and plain numbers to the figure\'s precision', () => {
    expect(formatInterval({ low: 0, high: 0.10427 }, 'percent')).toBe('0.0 to 10.4%');
    expect(formatInterval({ low: 0.9912, high: 1 }, 'number')).toBe('0.991 to 1.000');
  });
});
