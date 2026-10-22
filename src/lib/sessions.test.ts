// Found in the end-to-end run on 22 October 2026: bulk accept changed the screen but
// never saved, so reopening a response lost every bulk decision.
import { describe, expect, it, vi } from 'vitest';
import { bulkAcceptInDb } from './sessions';

function fakeClient(result: { error: null | { message: string } }) {
  const calls: unknown[][] = [];
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const m of ['update', 'eq', 'gte']) {
    chain[m] = (...a: unknown[]) => { calls.push([m, ...a]); return chain; };
  }
  (chain as unknown as PromiseLike<unknown>).then = ((res: (v: unknown) => unknown) => Promise.resolve(result).then(res)) as never;
  const from = vi.fn((table: string) => { calls.push(['from', table]); return chain; });
  return { client: { from } as never, calls };
}

describe('bulkAcceptInDb', () => {
  it('accepts pending questions of this session at or above the threshold, in one update', async () => {
    const { client, calls } = fakeClient({ error: null });
    await bulkAcceptInDb(client, 'session-1', 0.8);
    expect(calls).toEqual([
      ['from', 'rfi_questions'],
      ['update', { status: 'accepted' }],
      ['eq', 'session_id', 'session-1'],
      ['eq', 'status', 'pending'],
      ['gte', 'confidence', 0.8],
    ]);
  });

  it('accept-all uses no threshold', async () => {
    const { client, calls } = fakeClient({ error: null });
    await bulkAcceptInDb(client, 'session-1', null);
    expect(calls.some((c) => c[0] === 'gte')).toBe(false);
  });

  it('reports a failure instead of hiding it', async () => {
    const { client } = fakeClient({ error: { message: 'permission denied' } });
    await expect(bulkAcceptInDb(client, 'session-1', 0.8)).rejects.toThrow(/not saved: permission denied/);
  });
});

describe('saveQuestionPatch and insertQuestions (F-9)', () => {
  it('1. saves status and final answer, and reports a refusal', async () => {
    const { saveQuestionPatch } = await import('./sessions');
    const okClient = fakeClient({ error: null });
    await saveQuestionPatch(okClient.client, 'q1', { status: 'accepted', finalAnswer: 'Yes.' });
    expect(okClient.calls).toEqual([['from', 'rfi_questions'], ['update', { status: 'accepted', final_answer: 'Yes.' }], ['eq', 'id', 'q1']]);
    const bad = fakeClient({ error: { message: 'permission denied' } });
    await expect(saveQuestionPatch(bad.client, 'q1', { status: 'skipped' })).rejects.toThrow(/not saved: permission denied/);
  });

  it('does nothing when there is nothing to save', async () => {
    const { saveQuestionPatch } = await import('./sessions');
    const c = fakeClient({ error: null });
    await saveQuestionPatch(c.client, 'q1', {});
    expect(c.calls).toEqual([]);
  });

  it('2. inserts in batches and reports a failed batch', async () => {
    const { insertQuestions } = await import('./sessions');
    const calls: number[] = [];
    let n = 0;
    const client = { from: () => ({ insert: async (rows: unknown[]) => { calls.push(rows.length); return { error: n++ === 1 ? { message: 'too big' } : null }; } }) } as never;
    await expect(insertQuestions(client, Array.from({ length: 60 }, (_, i) => ({ id: String(i) })), 25))
      .rejects.toThrow(/25 of 60 questions were saved.*too big/);
    expect(calls).toEqual([25, 25]);
  });
});
