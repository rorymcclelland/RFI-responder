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
