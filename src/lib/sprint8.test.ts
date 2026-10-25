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
    'voyage-4 + claude-haiku-5-5': { model: 'm', evaluationSet: 's', points: [], bands: [
      { probability: 0, n: 40, low: 0, high: 0.088 },
      { probability: 0.5, n: 4, low: 0.15, high: 0.85 },
      { probability: 0.9583, n: 120, low: 0.906, high: 0.982 },
    ] },
    'voyage-4': { model: 'voyage-4', evaluationSet: 's', points: [] },
  };
  it('1 and 2. gives the interval and count of the step nearest the confidence', async () => {
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(0.95, 'voyage-4', 'claude-haiku-5-5', tables))
      .toBe('Of evaluation questions scored like this, between 91% and 98% had the right entry (95% interval, 120 questions).');
    expect(confidenceRange(0.55, 'voyage-4', 'claude-haiku-5-5', tables))
      .toBe('Of evaluation questions scored like this, between 15% and 85% had the right entry (95% interval, 4 questions).');
  });
  it('3. no table, no bands, no confidence or no model: no range', async () => {
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(null, 'voyage-4', 'claude-haiku-5-5', tables)).toBeNull();
    expect(confidenceRange(0.9, 'voyage-4', null, tables)).toBeNull();
    expect(confidenceRange(0.9, 'bge-m3', 'claude-haiku-5-5', tables)).toBeNull();
    expect(confidenceRange(0.9, null, null, tables)).toBeNull();
  });
  it('uses the tables the server uses: the shipped table has bands for the app\'s set-up', async () => {
    const { CALIBRATION_TABLES } = await import('../../supabase/functions/_shared/calibration-tables');
    const { confidenceRange } = await import('./format');
    expect(confidenceRange(0.99, 'voyage-4', 'claude-haiku-5-5', CALIBRATION_TABLES)).toMatch(/^Of evaluation questions scored like this, between \d+% and \d+% had the right entry \(95% interval, \d+ questions\)\.$/);
  });
});
