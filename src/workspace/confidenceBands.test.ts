// Sprint 17, S17-1 test 4: the filter's bands match the bulk buttons.
import { describe, expect, it } from 'vitest';
import { CONF_GROUPS, inGroup } from './confidenceBands';

const band = (c: number | null) => CONF_GROUPS.find((g) => inGroup(c, g))?.key;

describe('confidence bands', () => {
  it('Medium is 60 to 80%, as on the bulk button', () => {
    expect(band(0.59)).toBe('low');
    expect(band(0.6)).toBe('medium');
    expect(band(0.799)).toBe('medium');
    expect(band(0.8)).toBe('high');
    expect(band(1)).toBe('high');
    expect(band(0)).toBe('low');
    expect(band(null)).toBe('uncalibrated');
    expect(CONF_GROUPS.map((g) => g.label)).toEqual(['High ≥80%', 'Medium 60–80%', 'Low <60%', 'Not calibrated']);
  });
});
