// Sprint 9, S9-2 test 1: the duplicates sweep reproduces the published threshold and figures.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chooseThreshold, duplicateStats, type DupRow } from './duplicates-sweep';

const rows = (JSON.parse(readFileSync(new URL('../docs/evals/answerability-2026-10-23.json', import.meta.url), 'utf8')) as { results: (DupRow & { method: string })[] })
  .results.filter((r) => r.method === 'voyage-4 + claude-haiku-5-5');

describe('S9-2 duplicates sweep (F-35)', () => {
  it('1. chooses 0.55 and gives the published 1.9% wrong, 53.0% caught', () => {
    expect(chooseThreshold(rows, 0.02, ['yes', 'partly'])).toBe(0.55);
    const s = duplicateStats(rows, 0.55, ['yes', 'partly']);
    expect([(s.wrongRate * 100).toFixed(1), (s.caughtRate * 100).toFixed(1)]).toEqual(['1.9', '53.0']);
  });
  it('every lower threshold that catches more breaks the 2% bar, with or without "partly"', () => {
    for (const verdicts of [['yes', 'partly'], ['yes']]) {
      for (const t of [0.4, 0.45, 0.5, 0.52]) expect(duplicateStats(rows, t, verdicts).wrongRate).toBeGreaterThan(0.02);
    }
  });
  it('leaves unreadable checks out, as the app never supersedes without a verdict', () => {
    const extra: DupRow = { kind: 'unanswerable', topIsGold: false, verdict: null, similarity: 0.99, unreadable: true };
    expect(duplicateStats([...rows, extra], 0.55, ['yes', 'partly']).n).toBe(duplicateStats(rows, 0.55, ['yes', 'partly']).n);
  });
});
