import { buildCsv, buildXlsx, escapeHtml } from './lib/spreadsheet';
import { RFIQuestion } from './types';

function triggerDownload(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function stem(filename: string) {
  return filename.replace(/\.[^.]+$/, '') || 'rfi-responses';
}

function stripKbReferences(answer: string) {
  return answer.replace(/\[References?:.*?\]\s*/gi, '').trimEnd();
}

/** Shown for a question the owner chose to skip (Sprint 3, Q2). */
export const NOT_ANSWERED = 'Not answered';

/**
 * The rows of the exported response: every decided question in the RFI's own order (not the
 * review order), with skipped questions marked "Not answered" and references removed. The number is
 * the customer's own when the question came from a document that had one (Sprint 5).
 */
export function exportRows(questions: RFIQuestion[]) {
  return questions
    .filter((q) => q.status === 'accepted' || q.status === 'skipped')
    .sort((a, b) => a.position - b.position)
    .map((q, i) => ({
      number: q.customerRef || String(i + 1),
      question: q.question,
      answer: q.status === 'accepted' ? stripKbReferences(q.finalAnswer) : NOT_ANSWERED,
      edited: q.status === 'accepted' && q.finalAnswer !== q.generatedAnswer,
    }));
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportCSV(questions: RFIQuestion[], sourceFileName = 'export') {
  const csv = buildCsv(
    ['#', 'Question', 'Answer'],
    exportRows(questions).map((r) => [r.number, r.question, r.answer]),
  );
  triggerDownload('\ufeff' + csv, `${stem(sourceFileName)}.csv`, 'text/csv;charset=utf-8;');
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export async function exportExcel(questions: RFIQuestion[], sourceFileName = 'export') {
  const bytes = await buildXlsx(
    'RFI Responses',
    ['#', 'Question', 'Answer', 'Was Edited'],
    exportRows(questions).map((r) => [r.number, r.question, r.answer, r.edited ? 'Yes' : 'No']),
    [5, 60, 80, 12],
  );
  triggerDownload(bytes, `${stem(sourceFileName)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ─── Word (HTML-based .doc — opens in Word/LibreOffice) ───────────────────────

/** The Word export's HTML. Every value from a document or a person is escaped (Sprint 5 security review). */
export function wordHtml(questions: RFIQuestion[], sourceFileName = 'export'): string {
  const exported = exportRows(questions);
  const answered = exported.filter((r) => r.answer !== NOT_ANSWERED).length;
  const date     = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = exported
    .map(
      (r) => `
      <tr>
        <td style="width:5%;padding:8px 6px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:12px;color:#64748b;font-weight:bold;">${escapeHtml(r.number)}</td>
        <td style="width:40%;padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:13px;color:#1e293b;">${escapeHtml(r.question)}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:13px;color:#334155;line-height:1.5;">
          ${escapeHtml(r.answer).replace(/\n/g, '<br>')}
        </td>
      </tr>`
    )
    .join('');

  const html = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office'
          xmlns:w='urn:schemas-microsoft-com:office:word'
          xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>RFI Response</title>
      <!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
      <style>
        body { font-family: Calibri, Arial, sans-serif; font-size: 13px; color: #1e293b; margin: 40px; }
        h1   { font-size: 20px; color: #0f172a; margin-bottom: 4px; }
        p.meta { font-size: 12px; color: #64748b; margin: 0 0 24px; }
        table { border-collapse: collapse; width: 100%; }
        thead th { background: #f1f5f9; padding: 8px 10px; border: 1px solid #e2e8f0;
                   font-size: 12px; color: #475569; text-align: left; font-weight: 600; }
      </style>
    </head>
    <body>
      <h1>RFI Response Document</h1>
      <p class="meta">Generated: ${date} &nbsp;·&nbsp; Source: ${escapeHtml(sourceFileName)}
         &nbsp;·&nbsp; ${answered} of ${exported.length} question${exported.length !== 1 ? 's' : ''} answered
      </p>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Question</th><th>Response</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>`;
  return html;
}

export function exportWord(questions: RFIQuestion[], sourceFileName = 'export') {
  triggerDownload('\ufeff' + wordHtml(questions, sourceFileName), `${stem(sourceFileName)}.doc`, 'application/msword');
}
