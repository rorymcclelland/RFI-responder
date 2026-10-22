// Bulk approval goes through the database function bulk_accept (Sprint 2, S2-2a), which
// enforces who may approve and what is held back; questions are inserted as text only and
// processed server-side in batches of ten.
import { describe, expect, it, vi } from 'vitest';
import { bulkAcceptInDb, describeBulk, insertQuestions, processInBatches } from './sessions';

describe('bulkAcceptInDb', () => {
  it('calls bulk_accept with the session and threshold, and returns what it did', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: 3, heldGated: 2, heldUncalibrated: 1, belowThreshold: 4 }, error: null });
    const r = await bulkAcceptInDb({ rpc } as never, 'session-1', 0.8);
    expect(rpc).toHaveBeenCalledWith('bulk_accept', { p_session: 'session-1', p_min_confidence: 0.8 });
    expect(r.accepted).toBe(3);
    expect(describeBulk(r, 0.8)).toBe(
      '3 accepted; 4 below 80%; 2 held back for individual review (pricing, legal, unchecked or translated); 1 without calibrated confidence.',
    );
  });

  it('reports a refusal instead of hiding it', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Only the response owner or an admin can approve questions in bulk' } });
    await expect(bulkAcceptInDb({ rpc } as never, 'session-1', 0.8)).rejects.toThrow(/not saved: Only the response owner/);
  });
});

describe('insertQuestions', () => {
  it('inserts only the question text, in batches, and returns the new ids in order', async () => {
    const inserted: unknown[] = [];
    const from = vi.fn(() => ({
      insert: (rows: { question: string }[]) => {
        inserted.push(...rows);
        return { select: () => Promise.resolve({ data: rows.map((r) => ({ id: `id-${r.question}` })), error: null }) };
      },
    }));
    const ids = await insertQuestions({ from } as never, 's1', [{ position: 0, question: 'a' }, { position: 1, question: 'b' }, { position: 2, question: 'c' }], 2);
    expect(ids).toEqual(['id-a', 'id-b', 'id-c']);
    expect(from).toHaveBeenCalledTimes(2);
    expect(inserted[0]).toEqual({ session_id: 's1', position: 0, question: 'a' });
  });

  it('says how many were saved before a failure (F-9)', async () => {
    let n = 0;
    const from = () => ({
      insert: () => ({ select: () => Promise.resolve(n++ === 0 ? { data: [{ id: '1' }, { id: '2' }], error: null } : { data: null, error: { message: 'denied' } }) }),
    });
    await expect(insertQuestions({ from } as never, 's1', Array.from({ length: 3 }, (_, i) => ({ position: i, question: String(i) })), 2))
      .rejects.toThrow(/Only 2 of 3 questions were saved: denied/);
  });
});

describe('processInBatches', () => {
  it('sends ten at a time, reports progress, and returns questions that failed', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { processed: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, saved: i !== 3 })) }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Edge Function returned a non-2xx status code' } });
    const progress: number[] = [];
    const ids = Array.from({ length: 12 }, (_, i) => `q${i}`);
    const r = await processInBatches({ functions: { invoke } } as never, 's1', ids, (done) => progress.push(done));
    expect(invoke.mock.calls[0]).toEqual(['process-questions', { body: { sessionId: 's1', questionIds: ids.slice(0, 10) } }]);
    expect(progress).toEqual([10, 12]);
    expect(r.failed).toEqual(['q3', 'q10', 'q11']);
    expect(r.reasons).toEqual(['Edge Function returned a non-2xx status code']);
  });
});
