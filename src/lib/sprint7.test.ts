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
    // Security review, Sprint 7 (finding 3): accepted before the database refused it.
    [{ draftKind: 'insufficient_evidence' as const, generatedAnswer: 'Insufficient evidence.', finalAnswer: 'Insufficient evidence.' }, 'placeholder accepted unedited'],
    [{ draftKind: 'person_required' as const, generatedAnswer: 'Pricing.', finalAnswer: ' Pricing. ' }, 'placeholder accepted unedited'],
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
    expect(head).toBe('"#","Question","Answer","answer_origin","model","prompt_version","approved_by","approved_at","approval"');
    expect(first).toContain('"model-drafted, approved unedited","claude-haiku-5-5","draft-2026-10-23.1","Sarah Chen","2026-10-24T10:00:00Z","individual"');
    expect(second).toMatch(/^"2","'=HYPERLINK/);
  });
});

describe('Security review, Sprint 7 (findings 2 and 3)', () => {
  it('the Word table gives the approval time and prompt version, like the other formats', () => {
    const html = wordHtml([q({})], 'f', names);
    expect(html).toContain('<th>Prompt version</th>');
    expect(html).toContain('<td>draft-2026-10-23.1</td>');
    expect(html).toContain('<td>2026-10-24T10:00:00Z</td>');
  });

  it('a question with no draft needs a written answer before it can be accepted', async () => {
    const { needsWrittenAnswer } = await import('./format');
    expect(needsWrittenAnswer(q({ status: 'pending', draftKind: 'insufficient_evidence', generatedAnswer: 'Insufficient evidence.', finalAnswer: 'Insufficient evidence.' }))).toBe(true);
    expect(needsWrittenAnswer(q({ status: 'pending', draftKind: 'person_required', generatedAnswer: 'Pricing.', finalAnswer: '' }))).toBe(true);
    expect(needsWrittenAnswer(q({ status: 'pending', draftKind: 'insufficient_evidence', generatedAnswer: 'Insufficient evidence.', finalAnswer: 'Written.' }))).toBe(false);
    expect(needsWrittenAnswer(q({ status: 'pending' }))).toBe(false);
  });
});

describe('Security review, Sprint 7 (finding 7): the card says why a drafted question is left out of bulk approval', () => {
  it('names the checker verdict, or the missing verdict, and says nothing otherwise', async () => {
    const { bulkHoldReason } = await import('./format');
    const pending = (over: Partial<RFIQuestion>) => q({ status: 'pending', ...over });
    expect(bulkHoldReason(pending({ checker: { verdict: 'partly', bestRef: null, reason: null } })))
      .toBe('Not included in bulk approval: the checker said the entries answer it only in part. Accept it on its own if the draft is right.');
    expect(bulkHoldReason(pending({ checker: { verdict: 'no', bestRef: null, reason: null } })))
      .toBe('Not included in bulk approval: the checker said the entries do not answer it. Accept it on its own if the draft is right.');
    expect(bulkHoldReason(pending({ checker: { verdict: null, bestRef: null, reason: null } })))
      .toBe('Not included in bulk approval: the checker gave a score but no verdict. Accept it on its own if the draft is right.');
    expect(bulkHoldReason(pending({}))).toBeNull();
    // Sprint 9 (F-40): similarity alone now has its own reason.
    expect(bulkHoldReason(pending({ checker: { verdict: null, bestRef: null, reason: null }, provenance: { ...base.provenance, judgeModel: null } })))
      .toBe('Not included in bulk approval: no checker is configured, so confidence comes from similarity alone. Accept it on its own if the draft is right.');
    expect(bulkHoldReason(pending({ gate: 'pricing', checker: { verdict: 'partly', bestRef: null, reason: null } }))).toBeNull();
    expect(bulkHoldReason(q({ checker: { verdict: 'partly', bestRef: null, reason: null } }))).toBeNull();
  });
});

describe('Sprint 11 (S11-10): a skip is recorded in the provenance', () => {
  it('says who skipped and when', () => {
    const names = new Map([['u3', 'Priya Sharma']]);
    const [r] = provenanceRows([q({ status: 'skipped', approval: null, skip: { by: 'u3', at: '2026-10-25T12:00:00Z' } })], names);
    expect(r.origin).toBe('not answered');
    expect(r.approvedBy).toBe('');
    expect(r.approval).toBe('skipped by Priya Sharma, 2026-10-25T12:00:00Z');
  });
});
