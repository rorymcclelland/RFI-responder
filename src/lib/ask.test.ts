// Sprint 18, S18-4 (K-3): asking the knowledge base, in the app. Test numbers: docs/refinement/sprint-18.md.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));
const { askKnowledge, askSummary } = await import('./ask');

const client = (r: { data?: unknown; error?: unknown }) => ({ functions: { invoke: vi.fn(async () => ({ data: r.data ?? null, error: r.error ?? null })) } });

describe('askKnowledge', () => {
  it('sends the trimmed question and returns the result', async () => {
    const c = client({ data: { result: { question: 'Q?', draft: 'A.' } } });
    expect(await askKnowledge(c as never, '  Q?  ')).toMatchObject({ draft: 'A.' });
    expect(c.functions.invoke).toHaveBeenCalledWith('ask-knowledge', { body: { question: 'Q?' } });
  });
  it('refuses an empty or over-long question without calling the server (test 4)', async () => {
    const c = client({});
    await expect(askKnowledge(c as never, '   ')).rejects.toThrow('Type a question');
    await expect(askKnowledge(c as never, 'x'.repeat(2001))).rejects.toThrow('2000 characters');
    expect(c.functions.invoke).not.toHaveBeenCalled();
  });
  it("shows the server's own message, such as the daily limit (test 3)", async () => {
    const limit = "You have reached today's limit on processing questions. An admin can raise it under Governance, Usage and limits.";
    const c = client({ error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: limit }), { status: 429 }) } });
    await expect(askKnowledge(c as never, 'Q?')).rejects.toThrow(limit);
  });
});

describe('askSummary', () => {
  it('says what would happen in a response', () => {
    expect(askSummary({ draftKind: 'person_required', gate: 'pricing', gateReason: null })).toMatch(/pricing/);
    expect(askSummary({ draftKind: 'insufficient_evidence', gate: null, gateReason: null })).toMatch(/does not answer this/);
    expect(askSummary({ draftKind: 'generated', gate: 'legal', gateReason: 'A legal question.' })).toBe('In a response this draft would be held for a person to approve individually: A legal question.');
    expect(askSummary({ draftKind: 'generated', gate: null, gateReason: null })).toBe('In a response, a person would approve it before it is sent.');
  });
});
