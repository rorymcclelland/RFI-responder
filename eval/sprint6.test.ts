/**
 * Sprint 6, S6-1 test 7 and S6-2 test 1: evaluation caches follow the prompt and the reply
 * limit, unreadable replies are never cached, and calibration never learns from them.
 */
import { describe, expect, it, vi } from 'vitest';
import { UnreadableReplyError } from '../supabase/functions/_shared/answerability';
import { cachedCheck, gateCacheParts, judgeCacheParts, stopReasonCounts } from './lib';
import { usableForCalibration } from './calibration-fit';

const memory = <T>() => {
  const data = new Map<string, T>();
  return { data, get: (k: string) => data.get(k), set: (k: string, v: T) => void data.set(k, v) };
};

describe('S6-1 test 7: evaluation caches', () => {
  it('review finding 7: the gate cache path names the prompt version and the reply limit', () => {
    expect(gateCacheParts('claude-haiku-5-5').join('/')).toMatch(/claude-haiku-5-5\/gate-2026-10-24\.1-max512/);
  });

  it('the cache path names the judge prompt version and the reply limit', () => {
    const parts = judgeCacheParts('claude-haiku-5-5');
    expect(parts.join('/')).toMatch(/claude-haiku-5-5/);
    expect(parts.join('/')).toMatch(/judge-2026-10-24\.1/);
    expect(parts.join('/')).toMatch(/max1024/);
  });

  it('a readable reply is cached; an unreadable one is counted, not cached, and not retried again', async () => {
    const cache = memory<{ verdict: string }>();
    const good = await cachedCheck(cache, 'k1', async () => ({ verdict: 'yes' }));
    expect(good).toEqual({ ok: true, result: { verdict: 'yes' }, fresh: true });
    expect((await cachedCheck(cache, 'k1', async () => ({ verdict: 'no' }))).ok && cache.get('k1')).toEqual({ verdict: 'yes' });

    const fn = vi.fn().mockRejectedValue(new UnreadableReplyError(['max_tokens', 'refusal']));
    const bad = await cachedCheck(cache, 'k2', fn);
    expect(bad).toEqual({ ok: false, stopReasons: ['max_tokens', 'refusal'] });
    expect(cache.get('k2')).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a transport error is retried and then thrown, not counted as unreadable', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('socket hang up'));
    await expect(cachedCheck(memory(), 'k', fn, { attempts: 2, waitMs: 0 })).rejects.toThrow(/socket/);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stop reasons are counted for the report', () => {
    expect(stopReasonCounts([['max_tokens', 'max_tokens'], ['refusal', 'unknown verdict']])).toBe('max_tokens 2, refusal 1, unknown verdict 1');
    expect(stopReasonCounts([])).toBe('none');
  });
});

describe('S6-2 test 1: calibration never learns from unreadable verdicts', () => {
  it('drops rows without a score, and says how many', () => {
    const rows = [
      { id: 'a', topScore: 2.6, unreadable: false },
      { id: 'b', topScore: null, unreadable: true },
      { id: 'c', topScore: Number.NaN },
      { id: 'd', topScore: 0.4 },
    ];
    const { usable, dropped } = usableForCalibration(rows);
    expect(usable.map((r) => r.id)).toEqual(['a', 'd']);
    expect(dropped).toBe(2);
  });
});

describe('S6-1 test 6: the red team includes reply flooding', () => {
  it('has questions that ask the checker for very long replies, each with a clean twin', async () => {
    const { readFileSync } = await import('node:fs');
    const set = JSON.parse(readFileSync(new URL('./redteam-set.json', import.meta.url), 'utf8')) as { questions: { attack: string; clean: string; injected: string }[] };
    const flooding = set.questions.filter((q) => q.attack.startsWith('reply flooding'));
    expect(flooding.length).toBeGreaterThanOrEqual(2);
    for (const q of flooding) expect(q.injected.startsWith(q.clean)).toBe(true);
  });
});
