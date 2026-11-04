// Sprint 23 (S23-1): Try it. Test numbers refer to docs/refinement/sprint-23.md.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TRY_FILE, sampleQuestions, showInLists, startNewTry, startTry, tryName } from './tryIt';

const csv = readFileSync('sample-data/try-it-questionnaire.csv', 'utf8');

describe('the sample questionnaire', () => {
  it('has about twelve questions, each with its reference, in order', async () => {
    const qs = await sampleQuestions(csv);
    expect(qs.length).toBeGreaterThanOrEqual(10);
    expect(qs.length).toBeLessThanOrEqual(15);
    expect(qs.map((q) => q.position)).toEqual(qs.map((_, i) => i));
    expect(qs.every((q) => /^CB-\d\d$/.test(q.customerRef) && q.question.endsWith('?'))).toBe(true);
  });

  it('holds what the demo needs to show: a pricing question, a legal one, and one the knowledge base cannot answer', async () => {
    const text = (await sampleQuestions(csv)).map((q) => q.question).join('\n');
    expect(text).toMatch(/licence fee|price/i);
    expect(text).toMatch(/liability/i);
    expect(text).toMatch(/Coral Bay Retail Supplier Charter/);
  });

  it('names no real company: the sample is fictional', () => {
    expect(tryName('Sam Visitor')).toBe('Try it: Coral Bay Retail (fictional): security questionnaire, Sam Visitor');
    expect(tryName('  ')).toContain('a visitor');
  });
});

/** A fake client recording what is inserted, with an open try or none. */
function fakeClient(start: { id: string; session?: string } | null, insertError: { code?: string; message?: string } | null = null) {
  const inserted: { table: string; row: unknown }[] = [];
  let open = start;
  // Archiving the try puts it away, as the database does.
  const rpc = vi.fn(async () => { open = null; return { error: null }; });
  const from = (table: string) => {
    const read = {
      select: () => read, eq: () => read, is: () => read, order: () => read, limit: () => read,
      maybeSingle: async () => {
        if (table === 'opportunities') return { data: open ? { id: open.id } : null, error: null };
        return { data: open?.session ? { id: open.session } : null, error: null };
      },
      insert: (rows: unknown) => {
        inserted.push({ table, row: rows });
        const id = table === 'opportunities' ? 'new-response' : table === 'rfi_sessions' ? 'new-session' : null;
        return {
          select: () => ({
            single: async () => (insertError && table === 'opportunities' ? { data: null, error: insertError } : { data: { id }, error: null }),
            then: (ok: (v: unknown) => void) => ok({ data: (rows as unknown[]).map((_, i) => ({ id: `q${i}` })), error: null }),
          }),
        };
      },
    };
    return read;
  };
  return { client: { from, rpc } as never, inserted, rpc };
}

describe('S23-1 starting a try', () => {
  it('1. makes a try you own: the response marked as a try, its file, and the sample\'s questions', async () => {
    const f = fakeClient(null);
    const t = await startTry(f.client, 'me', 'Sam Visitor');
    expect(t).toMatchObject({ responseId: 'new-response', sessionId: 'new-session', created: true });
    expect(f.inserted[0]).toEqual({ table: 'opportunities', row: { name: tryName('Sam Visitor'), trial: true } });
    expect(f.inserted[1]).toMatchObject({ table: 'rfi_sessions', row: { file_name: TRY_FILE, opportunity_id: 'new-response' } });
    expect(f.inserted[2].table).toBe('rfi_questions');
    expect(t.questionIds.length).toBe((await sampleQuestions(csv)).length);
  });

  it('6. opens your open try rather than making another', async () => {
    const f = fakeClient({ id: 'mine', session: 'its-file' });
    expect(await startTry(f.client, 'me', 'Sam')).toEqual({ responseId: 'mine', sessionId: 'its-file', questionIds: [], created: false });
    expect(f.inserted).toEqual([]);
  });

  it('6. Start a new try archives your open try as withdrawn, then makes one', async () => {
    const f = fakeClient({ id: 'mine', session: 'its-file' });
    const t = await startNewTry(f.client, 'me', 'Sam');
    expect(f.rpc).toHaveBeenCalledWith('archive_response', { p_response: 'mine', p_outcome: 'withdrawn' });
    expect(t).toMatchObject({ responseId: 'new-response', created: true });
    expect(f.inserted[0].table).toBe('opportunities');
  });

  it('6. a second open try refused by the database is said in the app\'s words', async () => {
    const f = fakeClient(null, { code: '23505', message: 'duplicate key value violates unique constraint "opportunities_one_open_try"' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(startTry(f.client, 'me', 'Sam')).rejects.toThrow('You already have a try open. Open it from Responses, or start a new one.');
    spy.mockRestore();
  });
});

describe('S23-1 5 (Q2): who sees a try in the lists', () => {
  it('your own tries and every ordinary response; an admin sees every try', () => {
    expect(showInLists({ trial: false, ownerId: 'x' }, 'me', false)).toBe(true);
    expect(showInLists({ trial: true, ownerId: 'me' }, 'me', false)).toBe(true);
    expect(showInLists({ trial: true, ownerId: 'x' }, 'me', false)).toBe(false);
    expect(showInLists({ trial: true, ownerId: 'x' }, 'me', true)).toBe(true);
  });
});
