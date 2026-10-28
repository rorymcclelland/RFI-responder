/** Sprint 17 (S17-2): which responses the overview shows, for its tabs, tiles, filters and search. */
import type { Opportunity, ResponseStage } from '../types';

export type OverviewFlag = 'at_risk' | 'overdue' | null;

export function filterOverview(responses: Opportunity[], f: {
  tab: 'active' | 'archived'; stage: ResponseStage | 'all'; flag: OverviewFlag; mine: boolean; search: string; me: string;
}): Opportunity[] {
  const q = f.search.trim().toLowerCase();
  return responses.filter((r) =>
    (f.tab === 'archived' ? r.archivedAt !== null : r.archivedAt === null)
    && (f.stage === 'all' || r.stage === f.stage)
    && (f.flag !== 'at_risk' || r.atRisk)
    && (f.flag !== 'overdue' || r.overdue)
    && (!f.mine || r.ownerId === f.me)
    && (!q || r.name.toLowerCase().includes(q)));
}
