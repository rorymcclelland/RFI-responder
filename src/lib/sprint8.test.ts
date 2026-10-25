// Sprint 8. Test numbers refer to docs/refinement/sprint-8.md.
import { describe, expect, it } from 'vitest';
import { buildExcelExport } from '../exportUtils';
import type { RFIQuestion } from '../types';
import type { CalibrationTable } from '../../supabase/functions/_shared/calibration';

const q: RFIQuestion = {
  id: 'q', sessionId: 's', position: 0, customerRef: null, question: 'Q?', generatedAnswer: 'Drafted.', finalAnswer: 'Drafted.',
  confidence: 0.9, retrievalScore: 0.5, sources: [], status: 'accepted', gate: null, gateReason: null, draftKind: 'generated',
  language: 'en', processingNote: null,
  provenance: { embeddingModel: 'voyage-4', judgeModel: 'claude-haiku-5-5', draftModel: 'claude-haiku-5-5', promptVersion: 'draft-1', calibrationSet: 'set' },
  processed: true, approval: { by: 'u1', at: '2026-10-24T10:00:00Z', kind: 'individual', threshold: null }, learnOutcome: null,
  checker: { verdict: 'yes', bestRef: 'KB-0001', reason: 'r' },
};

describe('S8-5 test 1 (F-36): the Excel export has a title', () => {
  it('is the response file name, kept exactly, even with markup characters', async () => {
    const { default: ExcelJS } = await import('exceljs');
    for (const file of ['larkspur-data-platform-rfi.docx', 'Q&A <draft> "v2".xlsx']) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await buildExcelExport([q], new Map(), file)).buffer as ArrayBuffer);
      expect(wb.title).toBe(`RFI response: ${file}`);
    }
  });
});

describe('S8-3: the confidence tooltip gives the range', () => {
  const tables: Record<string, CalibrationTable> = {
    'voyage-4 + claude-haiku-5-5': { model: 'm', evaluationSet: 'set A', points: [], bands: [
      { probability: 0, n: 40, low: 0, high: 0.088 },
      { probability: 0.5, n: 4, low: 0.15, high: 0.85 },
      { probability: 0.9583, n: 120, low: 0.906, high: 0.982 },
      { probability: 0.8125, n: 16, low: 0.5699, high: 0.9341 },
    ] },
    'voyage-4': { model: 'voyage-4', evaluationSet: 's', points: [] },
  };
  it('1 and 2. gives the interval and count of the step nearest the confidence', async () => {
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(0.95, 'voyage-4', 'claude-haiku-5-5', 'set A', tables))
      .toBe('115 of 120 evaluation questions scored like this had the right entry (95% interval 91 to 98%).');
    expect(confidenceRange(0.81, 'voyage-4', 'claude-haiku-5-5', 'set A', tables))
      .toBe('13 of 16 evaluation questions scored like this had the right entry (95% interval 57 to 93%).');
    expect(confidenceRange(0.55, 'voyage-4', 'claude-haiku-5-5', 'set A', tables))
      .toBe('2 of 4 evaluation questions scored like this had the right entry (95% interval 15 to 85%).');
  });
  it('3. no table, no bands, no confidence or no model: no range', async () => {
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(null, 'voyage-4', 'claude-haiku-5-5', 'set A', tables)).toBeNull();
    expect(confidenceRange(0.9, 'voyage-4', null, 'set A', tables)).toBeNull();
    expect(confidenceRange(0.9, 'bge-m3', 'claude-haiku-5-5', 'set A', tables)).toBeNull();
    expect(confidenceRange(0.9, null, null, 'set A', tables)).toBeNull();
  });
  it('security review, Sprint 8: no range for a question scored with an earlier table', async () => {
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(0.95, 'voyage-4', 'claude-haiku-5-5', '2026-10-22.3 (calibrate split)', tables)).toBeNull();
    expect(confidenceRange(0.95, 'voyage-4', 'claude-haiku-5-5', null, tables)).toBeNull();
  });
  it('uses the tables the server uses: the shipped table has bands for the app\'s set-up', async () => {
    const { CALIBRATION_TABLES } = await import('../../supabase/functions/_shared/calibration-tables');
    const { confidenceRange } = await import('./format');
    const set = CALIBRATION_TABLES['voyage-4 + claude-haiku-5-5'].evaluationSet;
    expect(confidenceRange(0.99, 'voyage-4', 'claude-haiku-5-5', set, CALIBRATION_TABLES)).toMatch(/^\d+ of \d+ evaluation questions scored like this had the right entry \(95% interval \d+ to \d+%\)\.$/);
  });
});
