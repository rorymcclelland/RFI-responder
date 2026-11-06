// Sprint 3: responses through the database functions; the database enforces the rules.
import { describe, expect, it, vi } from 'vitest';
import { archiveResponse, deleteResponse, describeLearning, inAppWords, recordResponseExport, sendPreview, suggestExperts, toResponse, updateResponse } from './responses';

describe('inAppWords (Sprint 21 QA review, finding 10)', () => {
  it('says the database\'s refusals in the app\'s words', () => {
    expect(inAppWords('2 question(s) are still pending; accept or skip every question before exporting'))
      .toBe('2 question(s) are still to do; approve each question or leave it unanswered before marking the response as sent');
    expect(inAppWords('Only the response owner or an admin can record an export')).toBe('Only the response owner or an admin can mark the response as sent');
    expect(inAppWords('Record the export before archiving as won or lost; use withdrawn for a response that was never sent'))
      .toMatch(/^Mark the response as sent before archiving/);
  });
});

// Sprint 21 (S21-1): what the Mark as sent confirmation says beforehand.
describe('sendPreview', () => {
  type Q = { id: string; status: string; gate?: string | null; src: 'draft' | 'edited' | 'person' };
  const qs: Q[] = [
    { id: 'a', status: 'accepted', src: 'edited' },
    { id: 'b', status: 'accepted', src: 'person' },
    { id: 'c', status: 'accepted', src: 'draft' },
    { id: 'd', status: 'accepted', gate: 'pricing', src: 'person' },
    { id: 'e', status: 'skipped', src: 'person' },
  ];
  it('counts edited and written answers, never pricing, and the open assignments', () => {
    expect(sendPreview(qs, [{ status: 'pending' }, { status: 'in_review' }, { status: 'closed' }, { status: 'answered' }, { status: 'approved' }], (q) => q.src))
      .toEqual({ written: 2, drafts: 1, pricing: 1, openAssignments: 2 });
  });
  it('on a second marking, counts only the answers changed since (the rest were considered before)', () => {
    const again = qs.map((q) => ({ ...q, learnedAt: q.id === 'a' ? null : '2026-11-01T10:00:00Z' }));
    expect(sendPreview(again, [], (q) => q.src)).toEqual({ written: 1, drafts: 0, pricing: 0, openAssignments: 0 });
  });
  it('counts nothing for an empty response', () => {
    expect(sendPreview([] as Q[], [], (q) => q.src)).toEqual({ written: 0, drafts: 0, pricing: 0, openAssignments: 0 });
  });
});

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
    expect(await recordResponseExport({ rpc } as never, 'r1')).toMatchObject({ accepted: 3, added: 1 });
    expect(rpc).toHaveBeenLastCalledWith('record_response_export', { p_response: 'r1' });
    const refused = vi.fn().mockResolvedValue({ data: null, error: { message: '2 question(s) in this response are still to do' } });
    await expect(recordResponseExport({ rpc: refused } as never, 'r1')).rejects.toThrow(/Not marked as sent: 2 question/);
  });

  it('says plainly when a change applied to nothing (row-level security)', async () => {
    const from = () => ({ update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }) });
    await expect(updateResponse({ from } as never, 'r1', { dueDate: '2026-12-01' })).rejects.toThrow(/only the response owner or an admin/);
  });

  it('describes what learning did', () => {
    expect(describeLearning({ accepted: 5, skipped: 0, added: 2, confirmed: 2, not_learned_pricing: 1 }))
      .toBe('Knowledge base: 2 added as new entries; 2 confirmed existing entries unchanged; 1 not learned (pricing).');
    expect(describeLearning({ accepted: 0, skipped: 3 })).toBe('Knowledge base: nothing new to learn from this response.');
    // Sprint 4 security review: a non-admin's replacement is proposed, not applied.
    expect(describeLearning({ accepted: 2, skipped: 0, proposed: 1, not_confirmed_source: 1 })).toBe(
      "Knowledge base: 1 proposed as replacements for existing entries, waiting for an admin to review; 1 did not confirm their entries (the entries need an admin's review).",
    );
    // Sprint 12 (S12-3).
    expect(describeLearning({ accepted: 1, skipped: 0, translated: 1 })).toBe(
      'Knowledge base: 1 added as translations of existing entries, waiting for an admin to review.',
    );
  });

  it('expert suggestions map reasons; a failure gives none rather than an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ user_id: 'u', display_name: 'Ada', score: 4, reasons: ['wrote KB-0001'] }], error: null });
    expect(await suggestExperts({ rpc } as never, 'q')).toEqual([{ userId: 'u', displayName: 'Ada', score: 4, reasons: ['wrote KB-0001'] }]);
    expect(await suggestExperts({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) } as never, 'q')).toEqual([]);
  });
});
