// Sprint 8, S8-1: reading counts out of the Markdown reports, and refusing to guess.
import { describe, expect, it } from 'vitest';
import { countFromPercent, parseCount, tableCell } from './report-parse';

const md = `Intro.

| Split | Check | Pricing and legal gated | Lookalikes wrongly gated |
|---|---|---|---|
| all | classifier | 100 of 100 (100.0%) | 5 of 70 (7.1%) |
| all | combined | 100 of 100 (100.0%) | 7 of 70 (10.0%) |

| Measure | All |
|---|---|
| Verdict changed between runs | 7.2% |
`;

describe('report-parse', () => {
  it('finds a cell by the row\'s leading cells and the column header', () => {
    expect(tableCell(md, ['all', 'combined'], 'Lookalikes wrongly gated')).toBe('7 of 70 (10.0%)');
    expect(tableCell(md, 'Verdict changed between runs', 'All')).toBe('7.2%');
  });
  it('S8-1 test 4: a figure that is not there is an error, not a guess', () => {
    expect(() => tableCell(md, 'Nothing', 'All')).toThrow(/No row/);
    expect(() => tableCell(md, 'Verdict changed between runs', 'Missing')).toThrow(/No row/);
  });
  it('reads "k of n" counts', () => {
    expect(parseCount('7 of 70 (10.0%)')).toEqual({ k: 7, n: 70 });
    expect(parseCount('0 of 4')).toEqual({ k: 0, n: 4 });
    expect(() => parseCount('10.0%')).toThrow();
  });
  it('recovers a count from a percentage only when exactly one count gives it', () => {
    expect(countFromPercent('7.2%', 181)).toBe(13);
    expect(countFromPercent('1.7%', 181)).toBe(3);
    expect(countFromPercent('1.9%', 363)).toBe(7);
    expect(() => countFromPercent('7.3%', 181)).toThrow(/No count/);
    expect(() => countFromPercent('50%', 1000)).toThrow(/more than one/);
  });
});
