// Sprint 1, story S1-6: fitting and checking a calibration curve.
import { describe, expect, it } from 'vitest';
import { isotonicFit, expectedCalibrationError, toBreakpoints, reliabilityBins } from './calibration-fit';

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
