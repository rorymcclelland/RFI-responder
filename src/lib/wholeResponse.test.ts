// Sprint 24 (S24-1, S24-2): the whole response's export state, and what was learned from a sent
// response, read from what the database stored. Test numbers refer to docs/refinement/sprint-24.md.
import { describe, expect, it } from 'vitest';
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
    expect(learnedFrom(stored)).toEqual(atSending);
    expect(describeLearning(learnedFrom(stored))).toBe(describeLearning(atSending));
  });

  it('2. a try says nothing was learned from it', () => {
    expect(describeLearning(learnedFrom([q('accepted', 'not_learned_try'), q('accepted', 'not_learned_try')]))).toBe('Knowledge base: 2 not learned (a try).');
  });

  it('3. every outcome stored since Sprint 3 is said in the same words as the report', () => {
    const outcomes = ['added', 'superseded', 'proposed', 'translated', 'confirmed', 'not_learned_pricing', 'not_learned_japanese',
      'not_learned_empty', 'not_learned_unchecked', 'not_learned_try', 'not_confirmed_source'];
    for (const o of outcomes) {
      const words = describeLearning(learnedFrom([q('accepted', o)]));
      expect(words, o).toBe(describeLearning({ accepted: 1, skipped: 0, [o]: 1 }));
      expect(words, o).not.toBe('Knowledge base: nothing new to learn from this response.');
    }
  });

  it('nothing stored: nothing new to learn', () => {
    expect(describeLearning(learnedFrom([q('skipped', null)]))).toBe('Knowledge base: nothing new to learn from this response.');
  });
});
