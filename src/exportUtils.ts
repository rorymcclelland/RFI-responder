import * as XLSX from 'xlsx';
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

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function exportCSV(questions: RFIQuestion[], sourceFileName = 'export') {
  const accepted = questions.filter((q) => q.status === 'accepted');
  const escape   = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [
    ['#', 'Question', 'Answer'].map(escape).join(','),
    ...accepted.map((q, i) =>
      [
        i + 1,
        escape(q.question),
        escape(stripKbReferences(q.finalAnswer)),
      ].join(',')
    ),
  ];
  triggerDownload(rows.join('\r\n'), `${stem(sourceFileName)}.csv`, 'text/csv;charset=utf-8;');
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export function exportExcel(questions: RFIQuestion[], sourceFileName = 'export') {
  const accepted = questions.filter((q) => q.status === 'accepted');

  const wsData = accepted.map((q, i) => ({
    '#': i + 1,
    Question: q.question,
    Answer: stripKbReferences(q.finalAnswer),
    'Was Edited': q.finalAnswer !== q.generatedAnswer ? 'Yes' : 'No',
  }));

  const ws = XLSX.utils.json_to_sheet(wsData);

  ws['!cols'] = [
    { wch: 5 },   // #
    { wch: 60 },  // Question
    { wch: 80 },  // Answer
    { wch: 12 },  // Was Edited
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RFI Responses');
  XLSX.writeFile(wb, `${stem(sourceFileName)}.xlsx`);
}

// ─── Word (HTML-based .doc — opens in Word/LibreOffice) ───────────────────────

export function exportWord(questions: RFIQuestion[], sourceFileName = 'export') {
  const accepted = questions.filter((q) => q.status === 'accepted');
  const date     = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const rows = accepted
    .map(
      (q, i) => `
      <tr>
        <td style="width:5%;padding:8px 6px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:12px;color:#64748b;font-weight:bold;">${i + 1}</td>
        <td style="width:40%;padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:13px;color:#1e293b;">${q.question.replace(/</g, '&lt;')}</td>
        <td style="padding:8px 10px;border:1px solid #e2e8f0;vertical-align:top;
                   font-size:13px;color:#334155;line-height:1.5;">
          ${stripKbReferences(q.finalAnswer).replace(/</g, '&lt;').replace(/\n/g, '<br>')}
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
      <p class="meta">Generated: ${date} &nbsp;·&nbsp; Source: ${sourceFileName}
         &nbsp;·&nbsp; ${accepted.length} accepted response${accepted.length !== 1 ? 's' : ''}
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

  triggerDownload('\ufeff' + html, `${stem(sourceFileName)}.doc`, 'application/msword');
}
