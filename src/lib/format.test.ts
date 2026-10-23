// Sprint 3, F-17: never "100%".
import { describe, expect, it } from 'vitest';
import { formatConfidence } from './format';

describe('formatConfidence', () => {
  it('shows 99% or more as "99%+", never 100%', () => {
    expect(formatConfidence(1)).toBe('99%+');
    expect(formatConfidence(0.995)).toBe('99%+');
  });
  it('rounds the rest, without rounding up into 99', () => {
    expect(formatConfidence(0.98)).toBe('98%');
    expect(formatConfidence(0.989)).toBe('98%');
    expect(formatConfidence(0.634)).toBe('63%');
  });
  it('null stays null (not calibrated)', () => {
    expect(formatConfidence(null)).toBeNull();
  });
});
