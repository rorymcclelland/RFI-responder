// Sprint 3: what goes into the exported response.
import { describe, expect, it } from 'vitest';
import { exportRows, NOT_ANSWERED, wordHtml } from '../exportUtils';
import type { RFIQuestion } from '../types';

const q = (position: number, status: RFIQuestion['status'], final = `Answer ${position}`, generated = final): RFIQuestion => ({
  id: String(position), sessionId: 's', position, question: `Q${position}`, generatedAnswer: generated, finalAnswer: final,
  confidence: 0.9, retrievalScore: 0.5, sources: [], status, gate: null, gateReason: null, draftKind: 'generated',
  language: 'en', processingNote: null, provenance: { embeddingModel: null, judgeModel: null, draftModel: null, promptVersion: null, calibrationSet: null },
  processed: true, approval: null, learnOutcome: null, checker: { verdict: null, bestRef: null, reason: null },
});

describe('exportRows', () => {
  it('keeps the RFI order, whatever order the review used', () => {
    expect(exportRows([q(3, 'accepted'), q(1, 'accepted'), q(2, 'accepted')]).map((r) => r.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('Q2: skipped questions are exported as "Not answered"; pending ones are not exported', () => {
    const rows = exportRows([q(1, 'accepted'), q(2, 'skipped'), q(3, 'pending')]);
    expect(rows.map((r) => [r.question, r.answer])).toEqual([['Q1', 'Answer 1'], ['Q2', NOT_ANSWERED]]);
  });

  it('Sprint 5: uses the customer\'s own numbers where the document had them', () => {
    const rows = exportRows([{ ...q(1, 'accepted'), customerRef: '3(a)' }, q(2, 'accepted')]);
    expect(rows.map((r) => r.number)).toEqual(['3(a)', '2']);
  });

  it('Sprint 5 security review: the Word export escapes the number as well as the question and answer', () => {
    const html = wordHtml([{ ...q(1, 'accepted', '<b>A</b>'), question: 'Q <i>?', customerRef: '<img src=\\\\e.vu\\a>' }]);
    expect(html).not.toMatch(/<img|<b>A|<i>\?/);
    expect(html).toContain('&lt;img src=');
  });

  it('removes references and marks edited answers', () => {
    const [row] = exportRows([q(1, 'accepted', 'We use AES-256.\n\n[References: KB-0001]', 'Old draft')]);
    expect(row.answer).toBe('We use AES-256.');
    expect(row.edited).toBe(true);
  });
});
