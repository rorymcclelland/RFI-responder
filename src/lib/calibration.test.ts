// Sprint 1, story S1-6 test 1: turning a similarity into a calibrated confidence.
import { describe, expect, it } from 'vitest';
import { calibratedConfidence, type CalibrationTable } from './calibration';

const table: CalibrationTable = {
  model: 'test-model',
  evaluationSet: 'test',
  points: [
    { score: 0.3, probability: 0.05 },
    { score: 0.5, probability: 0.4 },
    { score: 0.7, probability: 0.9 },
  ],
};
const tables = { 'test-model': table };

describe('calibratedConfidence', () => {
  it('returns the probability at a breakpoint', () => {
    expect(calibratedConfidence(0.5, 'test-model', tables)).toBeCloseTo(0.4);
  });

  it('interpolates linearly between breakpoints', () => {
    expect(calibratedConfidence(0.6, 'test-model', tables)).toBeCloseTo(0.65);
  });

  it('holds the end values outside the range, and stays within 0 to 1', () => {
    expect(calibratedConfidence(0.1, 'test-model', tables)).toBeCloseTo(0.05);
    expect(calibratedConfidence(0.99, 'test-model', tables)).toBeCloseTo(0.9);
  });

  it('4. returns null for an unknown model, a missing score or keyword-only results', () => {
    expect(calibratedConfidence(0.6, 'other-model', tables)).toBeNull();
    expect(calibratedConfidence(null, 'test-model', tables)).toBeNull();
    expect(calibratedConfidence(0.6, null, tables)).toBeNull();
  });

  it('is monotonic: a higher similarity never gives a lower confidence', () => {
    let last = -1;
    for (let s = 0; s <= 1; s += 0.01) {
      const c = calibratedConfidence(s, 'test-model', tables)!;
      expect(c).toBeGreaterThanOrEqual(last);
      last = c;
    }
  });
});
