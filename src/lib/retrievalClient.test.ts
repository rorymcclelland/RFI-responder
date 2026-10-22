// Sprint 1, story S1-5: the app's side of hybrid retrieval.
import { describe, expect, it, vi } from 'vitest';
import { embedQuestions, matchQuestion, selectDraftSources, type MatchRow } from './retrievalClient';

const row = (q: string, similarity: number | null, keyword: number | null, fused: number, model: string | null = 'voyage-4'): MatchRow => ({
  id: q, ref: `KB-${q}`, question: q, answer: `Answer to ${q}.`, tags: [], source: '',
  similarity, keyword_rank: keyword, fused_score: fused, embedding_model: model,
});

describe('embedQuestions', () => {
  it('sends texts to the embed function in batches of 128 and joins the results in order', async () => {
    const invoke = vi.fn(async (_name: string, { body }: { body: { texts: string[] } }) =>
      ({ data: { model: 'voyage-4', vectors: body.texts.map((t) => [t.length]) }, error: null }));
    const client = { functions: { invoke } } as never;
    const texts = Array.from({ length: 130 }, (_, i) => 'x'.repeat(i + 1));
    const r = await embedQuestions(client, texts);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[0][1].body).toMatchObject({ kind: 'query' });
    expect(r).toMatchObject({ ok: true, model: 'voyage-4' });
    if (r.ok) expect(r.vectors.map((v) => v[0])).toEqual(texts.map((t) => t.length));
  });

  it('4. reports failure instead of throwing, so the caller can fall back to keywords', async () => {
    const invoke = vi.fn(async () => ({ data: null, error: { message: 'Voyage could not be reached' } }));
    const r = await embedQuestions({ functions: { invoke } } as never, ['a']);
    expect(r).toEqual({ ok: false, reason: 'Voyage could not be reached' });
  });
});

describe('matchQuestion', () => {
  it('calls match_kb_entries with the vector as text, the question and the model', async () => {
    const rpc = vi.fn(async () => ({ data: [row('a', 0.8, 0.1, 0.03)], error: null }));
    const rows = await matchQuestion({ rpc } as never, 'Do you use MFA?', [0.1, 0.2], 'voyage-4');
    expect(rpc).toHaveBeenCalledWith('match_kb_entries', {
      query_embedding: '[0.1,0.2]', query_text: 'Do you use MFA?', match_count: 5, model_name: 'voyage-4',
    });
    expect(rows).toHaveLength(1);
  });

  it('keyword-only when there is no vector', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await matchQuestion({ rpc } as never, 'q', null, null);
    expect(rpc.mock.calls[0]).toEqual(['match_kb_entries', expect.objectContaining({ query_embedding: null, model_name: null })]);
  });

  it('throws a readable error when the database refuses', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    await expect(matchQuestion({ rpc } as never, 'q', null, null)).rejects.toThrow(/Matching failed: permission denied/);
  });
});

describe('selectDraftSources', () => {
  it('uses the top entry and any others within 0.05 similarity of it, at most three', () => {
    const picked = selectDraftSources([row('a', 0.80, null, 0.03), row('b', 0.77, null, 0.02), row('c', 0.60, 0.1, 0.02)]);
    expect(picked.map((s) => s.entry.question)).toEqual(['a', 'b']);
    expect(picked[0].entry.id).toBe('KB-a');
  });

  it('keyword-only results: the top two that matched', () => {
    const picked = selectDraftSources([row('a', null, 0.4, 0.016, null), row('b', null, 0.2, 0.015, null), row('c', null, 0.1, 0.014, null)]);
    expect(picked.map((s) => s.entry.question)).toEqual(['a', 'b']);
  });

  it('no rows gives no sources', () => {
    expect(selectDraftSources([])).toEqual([]);
  });
});
