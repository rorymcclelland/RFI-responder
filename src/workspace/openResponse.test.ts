// Sprint 16, S16-1 (BUG-39): opening a response. Test numbers: docs/refinement/sprint-16.md.
import { describe, expect, it, vi } from 'vitest';
import { loadResponseSessions, firstView } from './openResponse';

function client(linked: { data: unknown; error: unknown }, orphans: { data: unknown; error: unknown } = { data: [], error: null }) {
  const calls: string[] = [];
  const chain = (result: { data: unknown; error: unknown }) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order']) c[m] = vi.fn(() => c);
    c.limit = vi.fn(async () => result);
    return c;
  };
  let n = 0;
  return { calls, from: vi.fn(() => { calls.push('rfi_sessions'); return chain(n++ === 0 ? linked : orphans); }) };
}

const row = { id: 's1', opportunity_id: 'o1', file_name: 'q.csv', status: 'in_progress', question_count: 4, accepted_count: 1, created_at: '2026-10-28T10:00:00Z' };

describe('loadResponseSessions', () => {
  it('reads the response\'s sessions, newest first, and the unlinked ones', async () => {
    const r = await loadResponseSessions(client({ data: [row], error: null }) as never, 'o1');
    expect(r.linked).toEqual([{ id: 's1', opportunityId: 'o1', fileName: 'q.csv', status: 'in_progress', questionCount: 4, acceptedCount: 1, createdAt: '2026-10-28T10:00:00Z' }]);
    expect(r.orphans).toEqual([]);
  });

  it('3. a failed read is an error, never an empty response', async () => {
    await expect(loadResponseSessions(client({ data: null, error: { message: 'timeout' } }) as never, 'o1')).rejects.toThrow(/could not be loaded/);
    await expect(loadResponseSessions(client({ data: [row], error: null }, { data: null, error: { message: 'x' } }) as never, 'o1')).rejects.toThrow(/could not be loaded/);
  });
});

describe('firstView', () => {
  it('1. a response with sessions opens its newest one, never the upload step', () => {
    expect(firstView([{ id: 's2' }, { id: 's1' }] as never)).toEqual({ open: { id: 's2' } });
  });
  it('2. a response with no sessions goes to the upload step', () => {
    expect(firstView([])).toEqual('upload');
  });
});
