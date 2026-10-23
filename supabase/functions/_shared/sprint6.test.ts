/**
 * Sprint 6, S6-1: the checker's replies are never cut off, and never silently become "no".
 * Test numbers refer to docs/refinement/sprint-6.md.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ClaudeClient, ClaudeResult } from './claude';
import { claudeJudge, JUDGE_MAX_TOKENS, UnreadableReplyError, type CandidateEntry } from './answerability';
import { classifierGate, GATE_MAX_TOKENS } from './gates';
import { meteredClaude, type UsageRow } from './usage';
import { safeNote } from './safe-text';
import { processQuestions, type ProcessDeps } from './process-core';
import type { MatchRow } from './sources';

const entries: CandidateEntry[] = [
  { ref: 'KB-0021', question: 'What logging do you have?', answer: 'A centralised SIEM.', similarity: 0.62 },
  { ref: 'KB-0094', question: 'How do you manage SIEM?', answer: 'Rules are tuned.', similarity: 0.55 },
];

type Reply = { data: unknown; stopReason?: string };
/** A Claude client that gives the replies in order (the last one repeats). */
function scripted(replies: Reply[]): ClaudeClient & { json: ReturnType<typeof vi.fn> } {
  let i = 0;
  return {
    json: vi.fn(async (): Promise<ClaudeResult<unknown>> => {
      const r = replies[Math.min(i++, replies.length - 1)];
      return { data: r.data, stopReason: r.stopReason ?? 'end_turn', model: 'claude-haiku-5-5', usage: { inputTokens: 100, outputTokens: 50 } };
    }),
  } as ClaudeClient & { json: ReturnType<typeof vi.fn> };
}

const cut = { data: null, stopReason: 'max_tokens' };
const yes = { data: { verdict: 'yes', best_ref: 'KB-0021', reason: 'KB-0021 names the SIEM.' } };

describe('S6-1 judge replies', () => {
  it('asks for enough room and a one-sentence reason', async () => {
    const client = scripted([yes]);
    await claudeJudge({ client, model: 'm' }).check('q', entries);
    const req = client.json.mock.calls[0][0];
    expect(JUDGE_MAX_TOKENS).toBeGreaterThanOrEqual(1024);
    expect(req.maxTokens).toBe(JUDGE_MAX_TOKENS);
    expect(req.system).toMatch(/one sentence/i);
  });

  it('1. a cut-off reply is retried once and a good second reply is used', async () => {
    const client = scripted([cut, yes]);
    const r = await claudeJudge({ client, model: 'm' }).check('q', entries);
    expect(client.json).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ verdict: 'yes', bestRef: 'KB-0021', reason: 'KB-0021 names the SIEM.', attempts: 2 });
  });

  it('2. two unreadable replies make the check fail, naming the stop reasons', async () => {
    const client = scripted([cut, cut]);
    const err = await claudeJudge({ client, model: 'm' }).check('q', entries).catch((e) => e);
    expect(err).toBeInstanceOf(UnreadableReplyError);
    expect(err.stopReasons).toEqual(['max_tokens', 'max_tokens']);
    expect(client.json).toHaveBeenCalledTimes(2);
  });

  it('3. a readable "no" is a "no", with no retry', async () => {
    const client = scripted([{ data: { verdict: 'no', best_ref: 'KB-0094', reason: 'Neither entry names a product.' } }]);
    const r = await claudeJudge({ client, model: 'm' }).check('q', entries);
    expect(r.verdict).toBe('no');
    expect(r.attempts).toBe(1);
    expect(client.json).toHaveBeenCalledTimes(1);
  });

  it('4. text that is not JSON, a refusal, or an unknown verdict count as unreadable', async () => {
    for (const bad of [
      { data: null, stopReason: 'end_turn (text was not JSON)' },
      { data: null, stopReason: 'refusal' },
      { data: { verdict: 'certainly', best_ref: 'KB-0021', reason: 'x' } },
    ]) {
      const err = await claudeJudge({ client: scripted([bad, bad]), model: 'm' }).check('q', entries).catch((e) => e);
      expect(err).toBeInstanceOf(UnreadableReplyError);
    }
  });

  it('an unknown entry in an otherwise readable reply keeps the verdict and drops the entry', async () => {
    const r = await claudeJudge({ client: scripted([{ data: { verdict: 'yes', best_ref: 'KB-9999', reason: 'x' } }]), model: 'm' }).check('q', entries);
    expect(r).toMatchObject({ verdict: 'yes', bestRef: null, attempts: 1 });
  });

  it('the reason is trimmed and made safe to show', async () => {
    const long = 'A'.repeat(500);
    const r = await claudeJudge({ client: scripted([{ data: { verdict: 'partly', best_ref: 'KB-0021', reason: long } }]), model: 'm' }).check('q', entries);
    expect(r.reason!.length).toBeLessThanOrEqual(300);
  });
});

describe('S6-1 gate classifier replies (test 5)', () => {
  it('uses a larger limit, retries once, and still fails safe', async () => {
    expect(GATE_MAX_TOKENS).toBeGreaterThanOrEqual(512);
    const good = { data: { category: 'none', reason: 'How security runs.' } };
    const once = scripted([cut, good]);
    expect((await classifierGate(once, 'm', 'q')).category).toBeNull();
    expect(once.json).toHaveBeenCalledTimes(2);
    expect(once.json.mock.calls[0][0].maxTokens).toBe(GATE_MAX_TOKENS);

    const twice = scripted([cut, cut]);
    expect((await classifierGate(twice, 'm', 'q')).category).toBe('legal');
    expect(twice.json).toHaveBeenCalledTimes(2);

    const clean = scripted([good]);
    await classifierGate(clean, 'm', 'q');
    expect(clean.json).toHaveBeenCalledTimes(1);
  });
});

describe('S6-1 retries are recorded and priced (test 8)', () => {
  it('records one usage row per attempt', async () => {
    const rows: UsageRow[] = [];
    await claudeJudge({ client: meteredClaude(scripted([cut, yes]), 'judge', rows), model: 'm' }).check('q', entries);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === 'judge')).toBe(true);
  });
});

describe('S6-1 in processing (test 2, end to end)', () => {
  const row = (ref: string, similarity: number): MatchRow => ({
    id: ref, ref, question: `Question for ${ref}`, answer: 'We use a centralised SIEM.', tags: [], source: 'synthetic', similarity, keyword_rank: 0,
    fused_score: similarity, embedding_model: 'voyage-4',
  });
  const deps = (judge: ClaudeClient): ProcessDeps => ({
    embed: async (texts) => ({ model: 'voyage-4', vectors: texts.map(() => [0.1]) }),
    match: async () => [row('KB-0001', 0.62)],
    checker: claudeJudge({ client: judge, model: 'claude-haiku-5-5' }),
    classifier: null,
    drafter: null,
    tables: { 'voyage-4 + claude-haiku-5-5': { model: 'x', evaluationSet: 'set', points: [{ score: 0, probability: 0 }, { score: 3, probability: 1 }] } },
    now: () => '2026-10-24T00:00:00.000Z',
  });

  it('an unreadable check leaves the question uncalibrated, with a note, never a "no"', async () => {
    const [r] = await processQuestions([{ id: 'q1', question: 'Which SIEM do you use?' }], deps(scripted([cut, cut])));
    expect(r.confidence).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.processing_note).toMatch(/unreadable answer twice/);
  });

  it('a readable check stores the verdict and the reason', async () => {
    const [r] = await processQuestions([{ id: 'q1', question: 'Which SIEM do you use?' }], deps(scripted([{ data: { verdict: 'yes', best_ref: 'KB-0001', reason: 'KB-0001 names it.' } }])));
    expect(r.verdict).toBe('yes');
    expect(r.judge_reason).toBe('KB-0001 names it.');
    expect(r.confidence).not.toBeNull();
  });
});

describe('Sprint 6 security review', () => {
  it('finding 4: trimming never splits a character (no lone surrogates reach the database)', () => {
    const t = safeNote('a'.repeat(298) + '😀😀');
    expect(Array.from(t).length).toBeLessThanOrEqual(300);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(t)).toBe(false);
  });

  it('finding 7: the classifier says when its answer is the fail-safe', async () => {
    expect(await classifierGate(scripted([cut, cut]), 'm', 'q')).toMatchObject({ category: 'legal', unreadable: true });
    expect((await classifierGate(scripted([{ data: { category: 'legal', reason: 'liability' } }]), 'm', 'q')).unreadable).toBeUndefined();
  });
});
