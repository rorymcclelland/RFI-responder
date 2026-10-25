// Sprint 8. Test numbers refer to docs/refinement/sprint-8.md.
import { describe, expect, it } from 'vitest';
import { buildExcelExport } from '../exportUtils';
import type { RFIQuestion } from '../types';

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
