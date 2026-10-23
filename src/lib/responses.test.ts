// Sprint 3: responses through the database functions; the database enforces the rules.
import { describe, expect, it, vi } from 'vitest';
import { archiveResponse, deleteResponse, describeLearning, recordExport, suggestExperts, toResponse, updateResponse } from './responses';

describe('responses', () => {
  it('maps an overview row', () => {
    const r = toResponse({
      id: 'r1', name: 'Acme', owner_id: 'u1', owner_name: 'Sarah', due_date: '2026-11-01', created_at: 'c', updated_at: 'u',
      exported_at: null, archived_at: null, outcome: null, stage: 'in_review', total: 10, decided: 4, accepted: 3, skipped: 1,
      pending: 6, gated_pending: 1, open_assignments: 2, overdue: false, at_risk: true,
    });
    expect(r).toMatchObject({ ownerName: 'Sarah', dueDate: '2026-11-01', stage: 'in_review', decided: 4, gatedPending: 1, atRisk: true });
  });

  it('calls the database functions with the right arguments and reports refusals', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: 3, skipped: 1, added: 1 }, error: null });
    await archiveResponse({ rpc } as never, 'r1', 'won');
    expect(rpc).toHaveBeenLastCalledWith('archive_response', { p_response: 'r1', p_outcome: 'won' });
    await deleteResponse({ rpc } as never, 'r1', 'Created by mistake');
    expect(rpc).toHaveBeenLastCalledWith('delete_response', { p_response: 'r1', p_reason: 'Created by mistake' });
    expect(await recordExport({ rpc } as never, 's1')).toMatchObject({ accepted: 3, added: 1 });
    const refused = vi.fn().mockResolvedValue({ data: null, error: { message: '2 question(s) are still pending' } });
    await expect(recordExport({ rpc: refused } as never, 's1')).rejects.toThrow(/Export not recorded: 2 question/);
  });

  it('says plainly when a change applied to nothing (row-level security)', async () => {
    const from = () => ({ update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) });
    await expect(updateResponse({ from } as never, 'r1', { dueDate: '2026-12-01' })).rejects.toThrow(/only the response owner or an admin/);
  });

  it('describes what learning did', () => {
    expect(describeLearning({ accepted: 5, skipped: 0, added: 2, confirmed: 2, not_learned_pricing: 1 }))
      .toBe('Knowledge base: 2 added as new entries; 2 confirmed existing entries unchanged; 1 not learned (pricing).');
    expect(describeLearning({ accepted: 0, skipped: 3 })).toBe('Knowledge base: nothing new to learn from this export.');
  });

  it('expert suggestions map reasons; a failure gives none rather than an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ user_id: 'u', display_name: 'Ada', score: 4, reasons: ['wrote KB-0001'] }], error: null });
    expect(await suggestExperts({ rpc } as never, 'q')).toEqual([{ userId: 'u', displayName: 'Ada', score: 4, reasons: ['wrote KB-0001'] }]);
    expect(await suggestExperts({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) } as never, 'q')).toEqual([]);
  });
});
