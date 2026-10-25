// BUG-29 (found while writing the Sprint 10 guide): the inbox showed changes the database had
// refused. An assignment change now reports a refusal, and approving others' assignments on the same
// question is reported by count, since only the response owner or an admin may change them.
import { describe, expect, it, vi } from 'vitest';
import { saveAssignmentNotes, setAssignmentStatus } from './assignments';

/** A fake supabase-js client: each update call resolves to the next result in `results`. */
function fakeClient(results: { data: { id: string }[] | null; error: { message: string } | null }[]) {
  const calls: { patch: Record<string, unknown>; filters: [string, string, unknown][] }[] = [];
  const from = vi.fn(() => ({
    update: (patch: Record<string, unknown>) => {
      const call = { patch, filters: [] as [string, string, unknown][] };
      calls.push(call);
      const chain = {
        eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return chain; },
        neq: (c: string, v: unknown) => { call.filters.push(['neq', c, v]); return chain; },
        select: () => Promise.resolve(results.shift()!),
      };
      return chain;
    },
  }));
  return { client: { from } as never, calls };
}

const a = { id: 'a1', questionId: 'q1', sessionId: 's1' };

describe('setAssignmentStatus', () => {
  it('moves your own assignment on', async () => {
    const { client, calls } = fakeClient([{ data: [{ id: 'a1' }], error: null }]);
    expect(await setAssignmentStatus(client, a, 'in_review')).toEqual({ othersApproved: 0, othersRefused: null });
    expect(calls[0].patch.status).toBe('in_review');
    expect(calls[0].filters).toEqual([['eq', 'id', 'a1']]);
  });

  it('reports a refusal, or a change that saved nothing, instead of hiding it', async () => {
    await expect(setAssignmentStatus(fakeClient([{ data: null, error: { message: 'denied' } }]).client, a, 'answered')).rejects.toThrow(/not saved: denied/);
    await expect(setAssignmentStatus(fakeClient([{ data: [], error: null }]).client, a, 'answered')).rejects.toThrow(/not saved/);
  });

  it('approving tries the other assignments on the question too, and says how many it could change', async () => {
    const { client, calls } = fakeClient([{ data: [{ id: 'a1' }], error: null }, { data: [{ id: 'a2' }], error: null }]);
    expect(await setAssignmentStatus(client, a, 'approved')).toEqual({ othersApproved: 1, othersRefused: null });
    expect(calls[1].filters).toEqual([['eq', 'question_id', 'q1'], ['eq', 'session_id', 's1'], ['neq', 'id', 'a1']]);
    expect(calls[0].patch.completed_at).toBeDefined();
  });

  it('a specialist who is not the owner approves only their own: the others are left, not shown as approved', async () => {
    const { client } = fakeClient([{ data: [{ id: 'a1' }], error: null }, { data: [], error: null }]);
    expect(await setAssignmentStatus(client, a, 'approved')).toEqual({ othersApproved: 0, othersRefused: null });
  });
});

describe('setAssignmentStatus, others refused (security review, Sprint 10, L2)', () => {
  it('says why the other assignments were not approved when the database refuses them', async () => {
    const { client } = fakeClient([{ data: [{ id: 'a1' }], error: null }, { data: null, error: { message: 'assignment is closed' } }]);
    expect(await setAssignmentStatus(client, a, 'approved')).toEqual({ othersApproved: 0, othersRefused: 'assignment is closed' });
  });
});

describe('saveAssignmentNotes', () => {
  it('saves, and reports a refusal', async () => {
    await expect(saveAssignmentNotes(fakeClient([{ data: [{ id: 'a1' }], error: null }]).client, 'a1', 'Checked.')).resolves.toBeUndefined();
    await expect(saveAssignmentNotes(fakeClient([{ data: [], error: null }]).client, 'a1', 'Checked.')).rejects.toThrow(/not saved/);
  });
});
