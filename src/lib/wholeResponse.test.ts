// Sprint 24 (S24-1, S24-2): the whole response's export state, and what was learned from a sent
// response, read from what the database stored. Test numbers refer to docs/refinement/sprint-24.md.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { responseExportState } from './sessions';
import { describeLearning, learnedFrom } from './responses';

describe('S24-1 (Q3): a response is sent only when every file is', () => {
  const sent = (at: string, changed: string | null = null) => ({ exportedAt: at, changedSinceExportAt: changed });
  const unsent = { exportedAt: null, changedSinceExportAt: null };

  it('no file, or any file unsent: not sent', () => {
    expect(responseExportState([])).toEqual(unsent);
    expect(responseExportState([sent('2026-11-01T10:00:00Z'), unsent])).toEqual(unsent);
  });

  it('every file sent: sent when the last was', () => {
    expect(responseExportState([sent('2026-11-01T10:00:00Z'), sent('2026-11-02T09:00:00Z')]))
      .toEqual({ exportedAt: '2026-11-02T09:00:00Z', changedSinceExportAt: null });
  });

  it('6. any file changed since: the response has changed since it was sent', () => {
    expect(responseExportState([sent('2026-11-01T10:00:00Z'), sent('2026-11-02T09:00:00Z', '2026-11-03T08:00:00Z')]).changedSinceExportAt)
      .toBe('2026-11-03T08:00:00Z');
  });
});

describe('S24-2 (F-71): what was learned, from what was stored', () => {
  const q = (status: string, learnOutcome: string | null) => ({ status, learnOutcome });

  it('1. says the same as at the moment of sending', () => {
    const atSending = { accepted: 3, skipped: 1, added: 1, confirmed: 1, not_learned_pricing: 1 };
    const stored = [q('accepted', 'added'), q('accepted', 'confirmed'), q('accepted', 'not_learned_pricing'), q('skipped', null)];
    expect(learnedFrom(stored)).toEqual({ ...atSending, sendings: 0 });
    expect(describeLearning(learnedFrom(stored))).toBe(describeLearning(atSending));
  });

  it('2. a try says nothing was learned from it', () => {
    expect(describeLearning(learnedFrom([q('accepted', 'not_learned_try'), q('accepted', 'not_learned_try')]))).toBe('Knowledge base: 2 not learned (a try).');
  });

  it('3. every outcome the database can store is said in the same words as the report', () => {
    // The outcomes are read from the newest migration that sets the column's check (QA review, L3).
    const dir = 'supabase/migrations';
    const latest = readdirSync(dir).sort().reverse().map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .find((sql) => /rfi_questions_learn_outcome_check\s+CHECK/.test(sql))!;
    const check = latest.slice(latest.search(/rfi_questions_learn_outcome_check\s+CHECK/)).split(';')[0];
    const outcomes = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(outcomes).toContain('not_learned_try');
    for (const o of outcomes) {
      const words = describeLearning(learnedFrom([q('accepted', o)]));
      expect(words, o).toBe(describeLearning({ accepted: 1, skipped: 0, [o]: 1 }));
      expect(words, o).not.toBe('Knowledge base: nothing new to learn from this response.');
    }
  });

  it('pins the words for a first sending', () => {
    expect(describeLearning(learnedFrom([q('accepted', 'added'), q('accepted', 'not_learned_pricing')])))
      .toBe('Knowledge base: 1 added as new entries; 1 not learned (pricing).');
  });

  it('after more than one sending, the report says it covers every sending (QA review, M3)', () => {
    const stored = [
      { status: 'accepted', learnOutcome: 'added', learnedAt: '2026-11-01T10:00:00Z' },
      { status: 'accepted', learnOutcome: 'proposed', learnedAt: '2026-11-03T09:00:00Z' },
    ];
    expect(learnedFrom(stored).sendings).toBe(2);
    expect(describeLearning(learnedFrom(stored))).toBe('Knowledge base, across every time it was marked as sent: 1 added as new entries; 1 proposed as replacements for existing entries, waiting for an admin to review.');
    // One sending: the words of the moment it was sent.
    expect(describeLearning(learnedFrom(stored.slice(0, 1)))).toBe('Knowledge base: 1 added as new entries.');
  });

  it('nothing stored: nothing new to learn', () => {
    expect(describeLearning(learnedFrom([q('skipped', null)]))).toBe('Knowledge base: nothing new to learn from this response.');
  });
});
