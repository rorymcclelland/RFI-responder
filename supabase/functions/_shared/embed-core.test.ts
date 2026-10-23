// Sprint 1, stories S1-2 (test 5) and S1-3 (tests 2 to 4): request checks and filling missing vectors.
import { describe, expect, it, vi } from 'vitest';
import { validateEmbedRequest, embedPendingEntries, MAX_TEXTS, MAX_CHARS } from './embed-core';
import { EMBEDDING_DIMENSION, EmbeddingError, type EmbeddingProvider } from './embeddings.ts';

describe('validateEmbedRequest (S1-2 test 5)', () => {
  it('accepts a list of texts and a kind', () => {
    expect(validateEmbedRequest({ texts: ['a', 'b'], kind: 'query' })).toEqual({ texts: ['a', 'b'], kind: 'query' });
  });

  it.each([
    ['no body', null],
    ['texts not a list', { texts: 'a', kind: 'query' }],
    ['empty list', { texts: [], kind: 'query' }],
    ['a non-string text', { texts: [1], kind: 'query' }],
    ['unknown kind', { texts: ['a'], kind: 'other' }],
    [`${MAX_TEXTS + 1} texts`, { texts: Array(MAX_TEXTS + 1).fill('a'), kind: 'query' }],
    [`a text of ${MAX_CHARS + 1} characters`, { texts: ['x'.repeat(MAX_CHARS + 1)], kind: 'query' }],
  ])('refuses %s with status 400', (_label, body) => {
    expect(() => validateEmbedRequest(body)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

function fakeProvider(model = 'voyage-4'): EmbeddingProvider & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    name: 'voyage', model, calls,
    async embed(texts) {
      calls.push(texts);
      return { model, vectors: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0.1)) };
    },
  };
}

function fakeDb(rows: { id: string; question: string; answer: string; embedding_model: string | null }[]) {
  const saved: { id: string; model: string }[] = [];
  return {
    saved,
    async fetchPending(model: string, limit: number) {
      return rows.filter((r) => r.embedding_model !== model && !saved.some((s) => s.id === r.id)).slice(0, limit);
    },
    async save(updates: { id: string; embedding: number[]; model: string }[]) {
      for (const u of updates) {
        saved.push({ id: u.id, model: u.model });
        const row = rows.find((r) => r.id === u.id)!;
        row.embedding_model = u.model;
      }
    },
  };
}

describe('embedPendingEntries (S1-3)', () => {
  it('2. embeds only entries without a vector from the configured model, as documents', async () => {
    const db = fakeDb([
      { id: '1', question: 'Q1', answer: 'A1', embedding_model: null },
      { id: '2', question: 'Q2', answer: 'A2', embedding_model: 'voyage-4' },
    ]);
    const p = fakeProvider();
    const r = await embedPendingEntries({ db, provider: p, batchSize: 10 });
    expect(r).toEqual({ embedded: 1, model: 'voyage-4', limited: false });
    expect(p.calls).toEqual([['Q1\nA1']]);
  });

  it('S4-1: a cap reached part-way embeds only what was allowed and stops', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ id: `e${i}`, question: `q${i}`, answer: 'a', embedding_model: null }));
    const db = fakeDb(rows);
    const p = fakeProvider();
    let left = 15;
    const reserve = async (n: number) => {
      const allowed = Math.min(n, left);
      left -= allowed;
      return allowed;
    };
    const r = await embedPendingEntries({ db, provider: p, batchSize: 10, reserve });
    expect(r).toEqual({ embedded: 15, model: 'voyage-4', limited: true });
    expect(p.calls.map((c) => c.length)).toEqual([10, 5]);
  });

  it('S4-1: nothing allowed means no provider call', async () => {
    const db = fakeDb([{ id: 'e1', question: 'q', answer: 'a', embedding_model: null }]);
    const p = fakeProvider();
    const r = await embedPendingEntries({ db, provider: p, reserve: async () => 0 });
    expect(r).toEqual({ embedded: 0, model: 'voyage-4', limited: true });
    expect(p.calls).toEqual([]);
  });

  it('3. after a model change every entry is re-embedded, in batches', async () => {
    const db = fakeDb(Array.from({ length: 5 }, (_, i) => ({ id: String(i), question: `Q${i}`, answer: 'A', embedding_model: 'voyage-4' })));
    const p = fakeProvider('bge-m3');
    const r = await embedPendingEntries({ db, provider: p, batchSize: 2 });
    expect(r.embedded).toBe(5);
    expect(p.calls.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(db.saved.every((s) => s.model === 'bge-m3')).toBe(true);
  });

  it('4. a provider failure stops the run and reports how many were saved before it', async () => {
    const db = fakeDb(Array.from({ length: 4 }, (_, i) => ({ id: String(i), question: `Q${i}`, answer: 'A', embedding_model: null })));
    let n = 0;
    const p: EmbeddingProvider = {
      name: 'voyage', model: 'voyage-4',
      embed: vi.fn(async (texts: string[]) => {
        if (n++ === 1) throw new EmbeddingError('Voyage could not be reached', 503);
        return { model: 'voyage-4', vectors: texts.map(() => Array(EMBEDDING_DIMENSION).fill(0)) };
      }),
    };
    await expect(embedPendingEntries({ db, provider: p, batchSize: 2 })).rejects.toMatchObject({
      status: 503, message: expect.stringMatching(/2 entries were embedded before/),
    });
  });

  it('stops after a maximum number of batches so one call cannot run forever', async () => {
    const db = fakeDb(Array.from({ length: 50 }, (_, i) => ({ id: String(i), question: 'Q', answer: 'A', embedding_model: null })));
    const r = await embedPendingEntries({ db, provider: fakeProvider(), batchSize: 2, maxBatches: 3 });
    expect(r.embedded).toBe(6);
  });
});
