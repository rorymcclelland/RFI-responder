// Sprint 17, S17-2 test 5: the At risk and Overdue tiles filter the list.
import { describe, expect, it } from 'vitest';
import { filterOverview } from './overviewFilter';

const r = (id: string, o: Partial<{ stage: string; atRisk: boolean; overdue: boolean; ownerId: string; name: string; archivedAt: string | null }> = {}) =>
  ({ id, name: id, stage: 'in_review', atRisk: false, overdue: false, ownerId: 'me', archivedAt: null, ...o });

describe('filterOverview', () => {
  const all = [r('a', { atRisk: true }), r('b', { overdue: true }), r('c'), r('d', { archivedAt: '2026-10-01', atRisk: true })];
  const base = { tab: 'active' as const, stage: 'all' as const, flag: null, mine: false, search: '', me: 'me' };
  it('shows only those at risk, or only those overdue, among active responses', () => {
    expect(filterOverview(all as never, { ...base, flag: 'at_risk' }).map((x) => x.id)).toEqual(['a']);
    expect(filterOverview(all as never, { ...base, flag: 'overdue' }).map((x) => x.id)).toEqual(['b']);
    expect(filterOverview(all as never, base).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('combines with stage, mine and search', () => {
    expect(filterOverview([r('x', { atRisk: true, ownerId: 'other' })] as never, { ...base, flag: 'at_risk', mine: true })).toEqual([]);
    expect(filterOverview([r('Bluefin', { atRisk: true })] as never, { ...base, flag: 'at_risk', search: 'blue' })).toHaveLength(1);
    expect(filterOverview([r('y', { atRisk: true, stage: 'ready' })] as never, { ...base, flag: 'at_risk', stage: 'in_review' })).toEqual([]);
  });
});
