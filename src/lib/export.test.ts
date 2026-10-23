// Sprint 3: what goes into the exported response.
import { describe, expect, it } from 'vitest';
import { exportRows, NOT_ANSWERED } from '../exportUtils';
import type { RFIQuestion } from '../types';

const q = (position: number, status: RFIQuestion['status'], final = `Answer ${position}`, generated = final): RFIQuestion => ({
  id: String(position), sessionId: 's', position, question: `Q${position}`, generatedAnswer: generated, finalAnswer: final,
  confidence: 0.9, retrievalScore: 0.5, sources: [], status, gate: null, gateReason: null, draftKind: 'generated',
  language: 'en', processingNote: null, provenance: { embeddingModel: null, judgeModel: null, draftModel: null, promptVersion: null, calibrationSet: null },
  processed: true, approval: null, learnOutcome: null,
});

describe('exportRows', () => {
  it('keeps the RFI order, whatever order the review used', () => {
    expect(exportRows([q(3, 'accepted'), q(1, 'accepted'), q(2, 'accepted')]).map((r) => r.question)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('Q2: skipped questions are exported as "Not answered"; pending ones are not exported', () => {
    const rows = exportRows([q(1, 'accepted'), q(2, 'skipped'), q(3, 'pending')]);
    expect(rows.map((r) => [r.question, r.answer])).toEqual([['Q1', 'Answer 1'], ['Q2', NOT_ANSWERED]]);
  });

  it('removes references and marks edited answers', () => {
    const [row] = exportRows([q(1, 'accepted', 'We use AES-256.\n\n[References: KB-0001]', 'Old draft')]);
    expect(row.answer).toBe('We use AES-256.');
    expect(row.edited).toBe(true);
  });
});
