// Sprint 3: what goes into the exported response.
import { describe, expect, it } from 'vitest';
import { buildCsvExport, buildExcelExport, exportedAnswer, exportRows, NOT_ANSWERED, provenanceRows, wordHtml } from '../exportUtils';
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

describe('Sprint 13 (S13-1): exports send only the answer', () => {
  const LABEL_EN = '[Translated from English knowledge-base entries. A Japanese speaker should review it before it is sent.]';
  const LABEL_JA = '[Translated from Japanese knowledge-base entries. Someone who reads Japanese should check it against them before it is sent.]';
  const translated = (final: string, generated = final, label = LABEL_EN): RFIQuestion =>
    ({ ...q(1, 'accepted', final, generated), gate: 'translation', language: label === LABEL_EN ? 'ja' : 'en' });

  it('1. a translated draft accepted unedited loses the label and the reference list; provenance records the translation', () => {
    const draft = `鍵は90日ごとに更新しています。\n\n[References: KB-0004]\n\n${LABEL_EN}`;
    const qs = [translated(draft)];
    expect(exportRows(qs)[0].answer).toBe('鍵は90日ごとに更新しています。');
    expect(provenanceRows(qs)[0].translation).toBe('drafted from English entries');
    const ja = [translated(`Keys rotate every 90 days.\n\n[References: KB-0102]\n\n${LABEL_JA}`, undefined, LABEL_JA)];
    expect(exportRows(ja)[0].answer).toBe('Keys rotate every 90 days.');
    expect(provenanceRows(ja)[0].translation).toBe('drafted from Japanese entries');
  });

  it('2. an English draft loses only its reference list', () => {
    expect(exportRows([q(1, 'accepted', 'We use AES-256.\n\n[References: KB-0001, KB-0002]\n')])[0].answer).toBe('We use AES-256.');
  });

  it('3. an approver\'s own bracketed text is kept', () => {
    for (const text of ['Reports are shared [References: on request] under NDA.', 'We follow it. [Translated from our parent company\'s policy]']) {
      expect(exportRows([q(1, 'accepted', text, 'Old draft')])[0].answer).toBe(text);
    }
  });

  it('4. an edited translation keeps what the person wrote, and the provenance still records the translation', () => {
    const generated = `鍵は更新しています。\n\n[References: KB-0004]\n\n${LABEL_EN}`;
    const [p] = provenanceRows([translated('鍵は90日ごとに自動で更新しています。', generated)]);
    expect(exportRows([translated('鍵は90日ごとに自動で更新しています。', generated)])[0].answer).toBe('鍵は90日ごとに自動で更新しています。');
    expect(p.translation).toBe('drafted from English entries');
  });

  it('5. a Japanese draft from Japanese entries, and an English one, have no translation recorded', () => {
    expect(provenanceRows([{ ...q(1, 'accepted', '回答です。'), gate: 'japanese', language: 'ja' }])[0].translation).toBe('');
    expect(provenanceRows([q(1, 'accepted')])[0].translation).toBe('');
  });

  it('6. every export format carries the field', async () => {
    const qs = [translated(`回答です。\n\n[References: KB-0004]\n\n${LABEL_EN}`)];
    expect(buildCsvExport(qs).split('\n')[0]).toContain('translation');
    expect(buildCsvExport(qs)).toContain('drafted from English entries');
    expect(wordHtml(qs)).toContain('<th>Translation</th>');
    expect(wordHtml(qs)).toContain('drafted from English entries');
    expect(wordHtml(qs)).not.toContain('Translated from English knowledge-base entries');
    const xlsx = await buildExcelExport(qs);
    expect(xlsx).toBeTruthy();
  });

  it('the labels are exactly the ones the drafter writes', async () => {
    const { TRANSLATION_LABEL, TRANSLATION_LABEL_FROM_JA } = await import('../../supabase/functions/_shared/drafting');
    expect([TRANSLATION_LABEL, TRANSLATION_LABEL_FROM_JA]).toEqual([LABEL_EN, LABEL_JA]);
    const { TRANSLATION_LABELS } = await import('../exportUtils');
    expect(TRANSLATION_LABELS).toEqual({ en: LABEL_EN, ja: LABEL_JA });
  });
});

describe('Sprint 13 security review', () => {
  const LABEL_EN = '[Translated from English knowledge-base entries. A Japanese speaker should review it before it is sent.]';
  const LABEL_JA = '[Translated from Japanese knowledge-base entries. Someone who reads Japanese should check it against them before it is sent.]';
  const accepted = (o: Partial<RFIQuestion>): RFIQuestion => ({ ...q(1, 'accepted'), ...o });

  it('M1: a translated draft under a legal or unchecked gate still records the translation', () => {
    for (const gate of ['legal', 'unchecked'] as const) {
      const text = `回答です。\n\n[References: KB-0001]\n\n${LABEL_EN}`;
      const qs = [accepted({ gate, generatedAnswer: text, finalAnswer: text, language: 'ja' })];
      expect(exportRows(qs)[0].answer).toBe('回答です。');
      expect(provenanceRows(qs)[0].translation).toBe('drafted from English entries');
    }
  });

  it('M1: a draft gated translated with no label (written in the other language) is a translated draft', () => {
    expect(provenanceRows([accepted({ gate: 'translation', generatedAnswer: '回答です。', finalAnswer: '回答です。' })])[0].translation).toBe('translated draft');
  });

  it('L2: an answer a person wrote is never called a translation', () => {
    for (const draftKind of ['insufficient_evidence', 'person_required'] as const) {
      expect(provenanceRows([accepted({ gate: 'translation', draftKind, generatedAnswer: 'No draft.', finalAnswer: 'Written by a person.' })])[0].translation).toBe('');
    }
  });

  it('L3: the label never reaches the customer, wherever a person left it, and both labels go', () => {
    expect(exportedAnswer(`回答です。\n\n[References: KB-0001]\n\n${LABEL_EN}\n\nKind regards.`)).toBe('回答です。\n\n[References: KB-0001]\n\nKind regards.');
    expect(exportedAnswer(`Answer.\n\n[References: KB-0102]\n\n${LABEL_EN}\n\n${LABEL_JA}`)).toBe('Answer.');
    expect(exportedAnswer(`Answer.\r\n\r\n[References: KB-0102]\r\n\r\n${LABEL_JA}\r\n`)).toBe('Answer.');
  });

  it('S13-1 test 6: the Excel Provenance sheet carries the Translation column and value', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const text = `回答です。\n\n[References: KB-0001]\n\n${LABEL_EN}`;
    const bytes = await buildExcelExport([accepted({ gate: 'translation', generatedAnswer: text, finalAnswer: text })]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    const prov = wb.getWorksheet('Provenance')!;
    expect(prov.getRow(1).getCell(8).value).toBe('Translation');
    expect(prov.getRow(2).getCell(8).value).toBe('drafted from English entries');
    expect(String(wb.getWorksheet('RFI Responses')!.getRow(2).getCell(3).value)).toBe('回答です。');
  });
});
