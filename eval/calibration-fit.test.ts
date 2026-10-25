// Sprint 1, story S1-6: fitting and checking a calibration curve.
import { describe, expect, it } from 'vitest';
import { isotonicFit, expectedCalibrationError, toBreakpoints, reliabilityBins } from './calibration-fit';
import { calibrationBands, crossValidate, leaveOneOut, stratifiedFolds } from './calibration-fit';

describe('isotonicFit (pool adjacent violators)', () => {
  it('leaves an already increasing sequence alone', () => {
    expect(isotonicFit([{ x: 1, y: 0 }, { x: 2, y: 0.5 }, { x: 3, y: 1 }]).map((p) => p.y)).toEqual([0, 0.5, 1]);
  });

  it('pools a violation into its average', () => {
    const fit = isotonicFit([{ x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: 1 }]);
    expect(fit.map((p) => p.y)).toEqual([0.5, 0.5, 1]);
  });

  it('sorts by x first and never decreases', () => {
    const pts = Array.from({ length: 200 }, (_, i) => ({ x: Math.sin(i) * 0.5 + 0.5, y: (i * 7919) % 3 === 0 ? 1 : 0 }));
    const fit = isotonicFit(pts);
    for (let i = 1; i < fit.length; i++) {
      expect(fit[i].x).toBeGreaterThanOrEqual(fit[i - 1].x);
      expect(fit[i].y).toBeGreaterThanOrEqual(fit[i - 1].y);
    }
  });
});

describe('toBreakpoints', () => {
  it('keeps one point per step, with scores increasing and probabilities never decreasing', () => {
    const bp = toBreakpoints(isotonicFit([{ x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.5, y: 1 }, { x: 0.6, y: 1 }]));
    expect(bp.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < bp.length; i++) {
      expect(bp[i].score).toBeGreaterThan(bp[i - 1].score);
      expect(bp[i].probability).toBeGreaterThanOrEqual(bp[i - 1].probability);
    }
  });
});

describe('expected calibration error', () => {
  it('is 0 when predictions match outcomes in every bin', () => {
    const items = [...Array(10).fill({ p: 0.9, correct: true }).map((x, i) => ({ ...x, correct: i < 9 })),
                   ...Array(10).fill({ p: 0.1, correct: false }).map((x, i) => ({ ...x, correct: i < 1 }))];
    expect(expectedCalibrationError(items, 10)).toBeCloseTo(0, 5);
  });

  it('is large when confident predictions are wrong', () => {
    expect(expectedCalibrationError(Array(10).fill({ p: 0.95, correct: false }), 10)).toBeCloseTo(0.95, 5);
  });

  it('reliability bins report predicted and observed rates with counts', () => {
    const bins = reliabilityBins([{ p: 0.85, correct: true }, { p: 0.82, correct: false }], 10);
    const b = bins.find((x) => x.count === 2)!;
    expect(b.meanPredicted).toBeCloseTo(0.835);
    expect(b.observed).toBeCloseTo(0.5);
  });
});

// Sprint 8, S8-2 and S8-3. Test numbers refer to docs/refinement/sprint-8.md.
describe('S8-2 cross-validation (F-16)', () => {
  type Row = { id: string; kind: string; split: string; topScore: number; topIsGold: boolean };
  const kinds = ['paraphrase', 'translation', 'near-miss', 'unanswerable'];
  const rows: Row[] = Array.from({ length: 120 }, (_, i) => {
    const kind = kinds[i % 4];
    const answerable = kind === 'paraphrase' || kind === 'translation';
    return { id: `q${i}`, kind, split: i % 8 < 4 ? 'calibrate' : 'test', topScore: answerable ? 0.5 + (i % 50) / 100 : 0.2 + (i % 30) / 100, topIsGold: answerable && i % 7 !== 0 };
  });
  const strata = (r: Row) => `${r.kind}/${r.split}`;

  it('1. every question is checked exactly once, and each fold holds near misses from both splits', () => {
    const folds = stratifiedFolds(rows, 5, strata, 11);
    expect(folds.flat().map((r) => r.id).sort()).toEqual(rows.map((r) => r.id).sort());
    for (const f of folds) {
      const near = f.filter((r) => r.kind === 'near-miss');
      expect(new Set(near.map((r) => r.split))).toEqual(new Set(['calibrate', 'test']));
    }
  });

  it('2. the folds repeat with the same seed', () => {
    const ids = (s: number) => stratifiedFolds(rows, 5, strata, s).map((f) => f.map((r) => r.id));
    expect(ids(11)).toEqual(ids(11));
    expect(ids(11)).not.toEqual(ids(12));
  });

  it('gives an out-of-fold prediction for every question, fitted without that question\'s fold', () => {
    const out = crossValidate(rows, 5, strata, 11);
    expect(out.predictions).toHaveLength(rows.length);
    expect(out.folds).toHaveLength(5);
    for (const f of out.folds) expect(f.ece).toBeGreaterThanOrEqual(0);
  });

  it('3. the leave-one-out check catches a fit where one question flips the near-miss count', () => {
    // A near miss pools with four right answers just below it: 4 of 5 is exactly 80%, so removing
    // any one of them (or the near miss) changes whether a near miss reaches the bulk line.
    const planted = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `w${i}`, kind: 'unanswerable', split: 'calibrate', topScore: 0.1 + i / 100, topIsGold: false })),
      { id: 'near', kind: 'near-miss', split: 'test', topScore: 0.9, topIsGold: false },
      ...Array.from({ length: 4 }, (_, i) => ({ id: `lever${i}`, kind: 'paraphrase', split: 'calibrate', topScore: 0.81 + i / 100, topIsGold: true })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, kind: 'paraphrase', split: 'calibrate', topScore: 0.91 + i / 100, topIsGold: true })),
    ];
    const loo = leaveOneOut(planted, 0.8);
    expect(loo.full).toBe(1);
    expect(loo.largestChange).toBeGreaterThanOrEqual(1);
    expect(leaveOneOut(planted.filter((r) => r.id !== 'near'), 0.8).largestChange).toBe(0);
  });
});

describe('S8-3 bands: how many evaluation questions sit behind each calibrated figure', () => {
  it('gives each step of the fit its count and 95% interval, merging steps with the same figure', () => {
    const pts = [{ x: 0.1, y: 0 }, { x: 0.2, y: 0 }, { x: 0.3, y: 1 }, { x: 0.4, y: 0 }, { x: 0.5, y: 1 }, { x: 0.6, y: 1 }];
    const b = calibrationBands(pts);
    expect(b.map((x) => [x.probability, x.n])).toEqual([[0, 2], [0.5, 2], [1, 2]]);
    expect(b[1].low).toBeLessThan(0.5);
    expect(b[1].high).toBeGreaterThan(0.5);
    expect(b[2].high).toBe(1);
  });
});
