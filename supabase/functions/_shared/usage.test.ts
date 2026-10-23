// Sprint 4, S4-1: metering AI calls and turning a quota reservation into an answer for the person.
import { describe, expect, it, vi } from 'vitest';
import type { ClaudeClient } from './claude.ts';
import type { EmbeddingProvider } from './embeddings.ts';
import { finishUsage, meteredClaude, meteredEmbedder, meteredFetch, quotaMessage, reserveQuota, type UsageRow } from './usage.ts';

const fakeClaude: ClaudeClient = {
  async json<T>() {
    return { data: { ok: true } as T, model: 'claude-haiku-5-5', usage: { inputTokens: 1200, outputTokens: 80 }, stopReason: 'end_turn' };
  },
};

describe('meteredClaude', () => {
  it('records one row per call with the tokens the provider reported', async () => {
    const sink: UsageRow[] = [];
    const c = meteredClaude(fakeClaude, 'draft', sink);
    await c.json({ model: 'claude-haiku-5-5', system: 's', user: 'u', schema: {}, maxTokens: 10 });
    await c.json({ model: 'claude-haiku-5-5', system: 's', user: 'u', schema: {}, maxTokens: 10 });
    expect(sink).toEqual([
      { kind: 'draft', provider: 'anthropic', model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 80 },
      { kind: 'draft', provider: 'anthropic', model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 80 },
    ]);
  });

  it('records nothing when the call fails (no reply, no tokens to count)', async () => {
    const sink: UsageRow[] = [];
    const failing: ClaudeClient = { json: () => Promise.reject(new Error('down')) };
    await expect(meteredClaude(failing, 'gate', sink).json({ model: 'm', system: '', user: '', schema: {}, maxTokens: 1 })).rejects.toThrow();
    expect(sink).toEqual([]);
  });
});

describe('meteredEmbedder', () => {
  it('uses the provider token count, or estimates from length when the provider gives none', async () => {
    const sink: UsageRow[] = [];
    const voyage: EmbeddingProvider = { name: 'voyage', model: 'voyage-4', embed: async () => ({ model: 'voyage-4', vectors: [[0]], tokens: 42 }) };
    const ollama: EmbeddingProvider = { name: 'ollama', model: 'qwen3-embedding:0.6b', embed: async () => ({ model: 'qwen3-embedding:0.6b', vectors: [[0]] }) };
    await meteredEmbedder(voyage, sink).embed(['abcd'], 'query');
    await meteredEmbedder(ollama, sink).embed(['abcdefgh'], 'query');
    expect(sink).toEqual([
      { kind: 'embed', provider: 'voyage', model: 'voyage-4', input_tokens: 42, output_tokens: 0 },
      { kind: 'embed', provider: 'ollama', model: 'qwen3-embedding:0.6b', input_tokens: 2, output_tokens: 0 },
    ]);
  });
});

describe('meteredFetch (Voyage rerank)', () => {
  it('records the total tokens from the reply without consuming its body', async () => {
    const sink: UsageRow[] = [];
    const inner = async () => new Response(JSON.stringify({ data: [], usage: { total_tokens: 300 } }), { status: 200 });
    const f = meteredFetch(inner, { kind: 'rerank', provider: 'voyage', model: 'rerank-2.5' }, sink);
    const res = await f('https://api.voyageai.com/v1/rerank');
    expect(await res.json()).toEqual({ data: [], usage: { total_tokens: 300 } });
    expect(sink).toEqual([{ kind: 'rerank', provider: 'voyage', model: 'rerank-2.5', input_tokens: 300, output_tokens: 0 }]);
  });
});

describe('reserveQuota', () => {
  const rpc = (result: unknown, error: unknown = null) => ({ rpc: async () => ({ data: result, error }) });

  it('returns what was allowed', async () => {
    expect(await reserveQuota(rpc({ allowed: 4, reason: 'daily_questions', reservation: 'r1' }), 'u', 'questions', 10)).toEqual({ allowed: 4, reason: 'daily_questions', reservation: 'r1' });
  });

  it('refuses with 429 and a plain reason when nothing is allowed', async () => {
    await expect(reserveQuota(rpc({ allowed: 0, reason: 'monthly_budget' }), 'u', 'questions', 3))
      .rejects.toMatchObject({ status: 429, message: quotaMessage('monthly_budget') });
  });

  it('fails closed with 503 when the reservation cannot be made', async () => {
    await expect(reserveQuota(rpc(null, { message: 'db down' }), 'u', 'embed', 3)).rejects.toMatchObject({ status: 503 });
  });

  it('messages say what happened and who can change it', () => {
    expect(quotaMessage('daily_questions')).toMatch(/today's limit.*admin/i);
    expect(quotaMessage('daily_embed')).toMatch(/today's limit.*admin/i);
    expect(quotaMessage('daily_extract')).toMatch(/today's limit on reading Word documents.*admin/i);
    expect(quotaMessage('monthly_budget')).toMatch(/budget.*admin/i);
  });
});

describe('finishUsage (security review, finding 6)', () => {
  const row: UsageRow = { kind: 'draft', provider: 'anthropic', model: 'claude-haiku-5-5', input_tokens: 10, output_tokens: 2 };
  const db = (insertError: unknown) => {
    const inserted: unknown[] = [];
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    return {
      inserted, rpc,
      client: { from: () => ({ insert: (rows: unknown[]) => { inserted.push(...rows); return Promise.resolve({ error: insertError }); } }), rpc },
    };
  };

  it('records the calls, then releases the reservations', async () => {
    const d = db(null);
    expect(await finishUsage(d.client, 'u1', 'process-questions', 's1', [row], ['r1', null, 'r2'])).toBe(true);
    expect(d.inserted).toEqual([{ ...row, user_id: 'u1', function: 'process-questions', session_id: 's1' }]);
    expect(d.rpc.mock.calls).toEqual([['settle_reservation', { p_reservation: 'r1' }], ['settle_reservation', { p_reservation: 'r2' }]]);
  });

  it('keeps the reservations when the usage cannot be written, so the budget still counts them', async () => {
    const d = db({ message: 'insert failed' });
    expect(await finishUsage(d.client, 'u1', 'embed', null, [row], ['r1'])).toBe(false);
    expect(d.rpc).not.toHaveBeenCalled();
  });

  it('releases a reservation when no call was made (nothing to record)', async () => {
    const d = db(null);
    expect(await finishUsage(d.client, 'u1', 'embed', null, [], ['r1'])).toBe(true);
    expect(d.rpc).toHaveBeenCalledWith('settle_reservation', { p_reservation: 'r1' });
  });
});
