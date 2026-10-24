// Sprint 7, S7-3 (F-27): exported answers carry a machine-readable record of how they were produced.
// Test numbers refer to docs/refinement/sprint-7.md.
import { describe, expect, it } from 'vitest';
import { answerOrigin, buildCsvExport, buildExcelExport, provenanceRows, wordHtml } from '../exportUtils';
import type { RFIQuestion } from '../types';

const base: RFIQuestion = {
  id: 'q', sessionId: 's', position: 0, customerRef: null, question: 'Q?', generatedAnswer: 'Drafted.', finalAnswer: 'Drafted.',
  confidence: 0.9, retrievalScore: 0.5, sources: [], status: 'accepted', gate: null, gateReason: null, draftKind: 'generated',
  language: 'en', processingNote: null,
  provenance: { embeddingModel: 'voyage-4', judgeModel: 'claude-haiku-5-5', draftModel: 'claude-haiku-5-5', promptVersion: 'draft-2026-10-23.1', calibrationSet: 'set' },
  processed: true, approval: { by: 'u1', at: '2026-10-24T10:00:00Z', kind: 'individual', threshold: null }, learnOutcome: null,
  checker: { verdict: 'yes', bestRef: 'KB-0001', reason: 'r' },
};
const q = (over: Partial<RFIQuestion>, position = 0): RFIQuestion => ({ ...base, id: `q${position}`, position, question: `Q${position}?`, ...over });
const names = new Map([['u1', 'Sarah Chen']]);

describe('S7-3 test 1: each origin from what was recorded', () => {
  it.each([
    [{}, 'model-drafted, approved unedited'],
    [{ finalAnswer: 'Changed.' }, 'model-drafted, edited by a person'],
    [{ draftKind: 'assembled' as const }, 'assembled from knowledge-base entries, approved unedited'],
    [{ draftKind: 'assembled' as const, finalAnswer: 'Changed.' }, 'assembled from knowledge-base entries, edited by a person'],
    [{ draftKind: 'insufficient_evidence' as const, generatedAnswer: 'Insufficient evidence.', finalAnswer: 'Written.' }, 'written by a person'],
    [{ draftKind: 'person_required' as const, generatedAnswer: 'Pricing.', finalAnswer: 'Written.' }, 'written by a person'],
    [{ status: 'skipped' as const }, 'not answered'],
    [{ draftKind: null, processed: false }, 'not recorded (processed before provenance was kept)'],
  ])('%o is "%s"', (over, origin) => {
    expect(answerOrigin(q(over))).toBe(origin);
  });
});

describe('S7-3 provenance rows', () => {
  it('give the number, origin, model, prompt version, approver and time, in the RFI\'s order', () => {
    const rows = provenanceRows([q({ customerRef: '2(a)' }, 1), q({ finalAnswer: 'Changed.', approval: { by: 'u9', at: '2026-10-24T11:00:00Z', kind: 'bulk', threshold: 0.8 } }, 0)], names);
    expect(rows).toEqual([
      { number: '1', origin: 'model-drafted, edited by a person', model: 'claude-haiku-5-5', promptVersion: 'draft-2026-10-23.1', approvedBy: 'a team member', approvedAt: '2026-10-24T11:00:00Z', approval: 'bulk at 80%' },
      { number: '2(a)', origin: 'model-drafted, approved unedited', model: 'claude-haiku-5-5', promptVersion: 'draft-2026-10-23.1', approvedBy: 'Sarah Chen', approvedAt: '2026-10-24T10:00:00Z', approval: 'individual' },
    ]);
  });
  it('leave the model empty for a person-written answer', () => {
    const [r] = provenanceRows([q({ draftKind: 'insufficient_evidence', generatedAnswer: 'x', finalAnswer: 'y', provenance: { ...base.provenance, draftModel: null } })], names);
    expect(r).toMatchObject({ origin: 'written by a person', model: '' });
  });
});

describe('S7-3 test 2: Excel', () => {
  it('has document properties and a Provenance sheet with a row per question', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const bytes = await buildExcelExport([q({}, 0), q({ status: 'skipped' }, 1)], names);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.creator).toBe('RFI Respond');
    expect(wb.keywords).toBe('ai-generated: yes; generator: RFI Respond');
    expect(wb.description).toMatch(/1 of 1 answered questions were drafted by a model \(claude-haiku-5-5\)/);
    const sheet = wb.getWorksheet('Provenance')!;
    expect(sheet.getRow(1).values).toEqual([undefined, '#', 'Answer origin', 'Model', 'Prompt version', 'Approved by', 'Approved at', 'Approval']);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(3).getCell(2).value).toBe('not answered');
  });
});

describe('S7-3 test 3: Word', () => {
  it('has meta tags in the head and a provenance table at the end, escaped', () => {
    const html = wordHtml([q({}, 0), q({ provenance: { ...base.provenance, draftModel: 'm"><script>x</script>' } }, 1)], 'file.docx', names);
    expect(html).toContain('<meta name="generator" content="RFI Respond">');
    expect(html).toContain('<meta name="ai-generated" content="yes">');
    expect(html).toContain('<meta name="ai-models" content="claude-haiku-5-5, m&quot;&gt;&lt;script&gt;x&lt;/script&gt;">');
    expect(html).not.toContain('<script>');
    expect(html.indexOf('How each answer was produced')).toBeGreaterThan(html.indexOf('</tbody>'));
    expect(html).toContain('model-drafted, approved unedited');
  });
  it('says "no" when no answer was model-drafted', () => {
    expect(wordHtml([q({ draftKind: 'insufficient_evidence', generatedAnswer: 'x', finalAnswer: 'y' })], 'f', names)).toContain('<meta name="ai-generated" content="no">');
  });
});

describe('S7-3 tests 4 and 5: CSV', () => {
  it('has an answer_origin column, and neutralises formula-like values', () => {
    const csv = buildCsvExport([q({}, 0), q({ question: '=HYPERLINK("x")' }, 1)], names);
    const [head, first, second] = csv.trim().split(/\r?\n/);
    expect(head).toBe('"#","Question","Answer","answer_origin"');
    expect(first).toMatch(/,"?model-drafted, approved unedited"?$/);
    expect(second).toMatch(/^"2","'=HYPERLINK/);
  });
});
