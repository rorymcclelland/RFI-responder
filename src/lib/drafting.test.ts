// Sprint 0, story S0-1: drafts and scores must be deterministic and honest.
// Test numbers refer to docs/refinement/sprint-0.md.
import { describe, expect, it } from 'vitest';
import { draftAnswer, scoreQuestion, NO_MATCH_TEXT } from './drafting';
import type { KnowledgeEntry } from '../types';

const kb: KnowledgeEntry[] = [
  {
    id: 'KB-1',
    question: 'How do you encrypt data at rest?',
    answer:
      'All data at rest is encrypted using AES-256 across storage and backups. Keys are held in a managed key service with quarterly rotation. Access to keys is logged and reviewed.',
    tags: ['encryption', 'AES-256'],
    source: 'Synthetic policy A',
  },
  {
    id: 'KB-2',
    question: 'What is your incident response process?',
    answer:
      'Security incidents are triaged within one hour by the on-call security engineer. Customers affected by a confirmed breach are notified within 72 hours.',
    tags: ['incident response'],
    source: 'Synthetic policy B',
  },
];

describe('scoreQuestion (S0-1)', () => {
  it('1. gives the same draft and score for the same question twice', () => {
    const a = scoreQuestion('How is data encrypted at rest?', kb);
    const b = scoreQuestion('How is data encrypted at rest?', kb);
    expect(a).toEqual(b);
  });

  it('2. scores 0 and says so when nothing in the KB matches', () => {
    const r = scoreQuestion('Describe the catering arrangements for the annual picnic', kb);
    expect(r.confidence).toBe(0);
    expect(r.generatedAnswer).toBe(NO_MATCH_TEXT);
    expect(r.sources.every((s) => s.score === 0)).toBe(true);
  });

  it('3. confidence is derived from the top retrieval score alone, with no random component', () => {
    const r = scoreQuestion('How do you encrypt data at rest?', kb);
    expect(r.sources[0].entry.id).toBe('KB-1');
    expect(r.retrievalScore).toBe(r.sources[0].score);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    // Repeating 50 times must never vary (the old code mixed in Math.random).
    const seen = new Set(Array.from({ length: 50 }, () => scoreQuestion('How do you encrypt data at rest?', kb).confidence));
    expect(seen.size).toBe(1);
  });

  it('confidence never exceeds 1 and is never negative', () => {
    for (const q of ['encrypt', 'incident breach notify customers', '', '!!!']) {
      const { confidence } = scoreQuestion(q, kb);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe('draftAnswer (S0-1)', () => {
  it('uses only text from matched sources and lists their references', () => {
    const r = scoreQuestion('How do you encrypt data at rest?', kb);
    const draft = draftAnswer(r.sources);
    expect(draft).toContain('AES-256');
    expect(draft).toMatch(/\[References: KB-1/);
  });

  it('adds no invented commitments (the old canned closers promised NDAs and reviews)', () => {
    const r = scoreQuestion('How do you encrypt data at rest?', kb);
    const draft = draftAnswer(r.sources);
    expect(draft).not.toMatch(/NDA|committed to|continuously improving|security team is available/i);
  });

  it('ignores sources with a zero score', () => {
    const draft = draftAnswer([{ entry: kb[1], score: 0 }]);
    expect(draft).toBe(NO_MATCH_TEXT);
  });
});
