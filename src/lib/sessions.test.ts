// Bulk approval goes through the database function bulk_accept (Sprint 2, S2-2a), which
// enforces who may approve and what is held back; questions are inserted as text only and
// processed server-side in batches of ten.
import { describe, expect, it, vi } from 'vitest';
import { bulkAcceptInDb, describeBulk, exportNotice, insertQuestions, processInBatches } from './sessions';

describe('bulkAcceptInDb', () => {
  it('calls bulk_accept with the session and threshold, and returns what it did', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { accepted: 3, heldGated: 2, heldUncalibrated: 1, belowThreshold: 4 }, error: null });
    const r = await bulkAcceptInDb({ rpc } as never, 'session-1', 0.8);
    expect(rpc).toHaveBeenCalledWith('bulk_accept', { p_session: 'session-1', p_min_confidence: 0.8 });
    expect(r.accepted).toBe(3);
    expect(describeBulk(r, 0.8)).toBe(
      '3 approved; 4 below 80%; 2 held back for individual review (pricing, legal, unchecked, translated or Japanese, matched before every entry was indexed, or citing an entry that is unreviewed or overdue for review); 1 without calibrated confidence.',
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

describe('processInBatches at the usage caps (Sprint 4, S4-1)', () => {
  const refusal = (status: number, error: string) => {
    const e = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ error }), { status }),
    });
    return { data: null, error: e };
  };

  it('shows the server\'s reason and stops sending batches once the cap refuses', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: { processed: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, saved: true })) }, error: null })
      .mockResolvedValueOnce(refusal(429, "You have reached today's limit on processing questions. An admin can raise it under Governance, Usage and limits."));
    const ids = Array.from({ length: 30 }, (_, i) => `q${i}`);
    const r = await processInBatches({ functions: { invoke } } as never, 's1', ids, () => undefined);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(r.failed).toEqual(ids.slice(10));
    expect(r.reasons).toEqual(["You have reached today's limit on processing questions. An admin can raise it under Governance, Usage and limits."]);
  });

  it('reports questions held back part-way through a batch, with the limit', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      data: { processed: [{ id: 'a', saved: true }, { id: 'b', saved: false, note: 'limit' }], limit: "This month's AI budget has been reached" },
      error: null,
    });
    const r = await processInBatches({ functions: { invoke } } as never, 's1', ['a', 'b'], () => undefined);
    expect(r.failed).toEqual(['b']);
    expect(r.reasons).toEqual(["This month's AI budget has been reached"]);
  });

  it('says plainly when the functions server is not running (gateway 503)', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify({ message: 'name resolution failed' }), { status: 503 }),
      }),
    });
    const r = await processInBatches({ functions: { invoke } } as never, 's1', ['a'], () => undefined);
    expect(r.reasons).toEqual(['The AI service is not running (start it with: npx supabase functions serve)']);
  });

  it('falls back to the generic message when the reply has no reason', async () => {
    const invoke = vi.fn().mockResolvedValueOnce({ data: null, error: new Error('Failed to send a request') });
    const r = await processInBatches({ functions: { invoke } } as never, 's1', ['a'], () => undefined);
    expect(r.reasons).toEqual(['Failed to send a request']);
  });
});

describe('exportNotice (Sprint 11, S11-1)', () => {
  const at = '2026-10-25T10:00:00Z';
  it('says nothing before an export', () => {
    expect(exportNotice({ exportedAt: null, changedSinceExportAt: null }, 'review')).toBeNull();
  });
  it('warns on the export step that a change reopens the export', () => {
    expect(exportNotice({ exportedAt: at, changedSinceExportAt: null }, 'export')).toMatch(/reopens the export/);
    expect(exportNotice({ exportedAt: at, changedSinceExportAt: null }, 'review')).toBeNull();
  });
  it('after a change, asks for the export to be recorded again', () => {
    expect(exportNotice({ exportedAt: at, changedSinceExportAt: at }, 'review')).toMatch(/Record export again/);
  });
});
