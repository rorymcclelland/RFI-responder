import { approvalLabel, needsWrittenAnswer } from './lib/format';
import { buildCsv, buildWorkbook, escapeHtml } from './lib/spreadsheet';
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

// ─── Provenance (Sprint 7, F-27) ──────────────────────────────────────────────
//
// Every exported file records, in a machine-readable form, how each answer was produced: drafted
// by a model, assembled from entries, or written by a person; edited or not; and who approved it.
// The answers themselves are unchanged (Rory, refinement Q2). This is a step towards marking under
// EU AI Act Article 50(2), not a claim of compliance (docs/governance/FRAMEWORKS.md).

export type AnswerOrigin =
  | 'model-drafted, approved unedited' | 'model-drafted, edited by a person'
  | 'assembled from knowledge-base entries, approved unedited' | 'assembled from knowledge-base entries, edited by a person'
  | 'written by a person' | 'placeholder accepted unedited' | 'not answered' | 'not recorded (processed before provenance was kept)';

/** How one answer was produced, from what the database recorded. */
export function answerOrigin(q: RFIQuestion): AnswerOrigin {
  if (q.status !== 'accepted') return 'not answered';
  const edited = q.finalAnswer !== q.generatedAnswer;
  if (q.draftKind === 'generated') return edited ? 'model-drafted, edited by a person' : 'model-drafted, approved unedited';
  if (q.draftKind === 'assembled') return edited ? 'assembled from knowledge-base entries, edited by a person' : 'assembled from knowledge-base entries, approved unedited';
  if (q.draftKind === 'insufficient_evidence' || q.draftKind === 'person_required') {
    // Security review, Sprint 7 (finding 3): the database now refuses this; earlier records say so plainly.
    return needsWrittenAnswer(q) ? 'placeholder accepted unedited' : 'written by a person';
  }
  return 'not recorded (processed before provenance was kept)';
}

const modelDrafted = (o: AnswerOrigin) => o.startsWith('model-drafted');

export interface ProvenanceRow { number: string; origin: AnswerOrigin; model: string; promptVersion: string; approvedBy: string; approvedAt: string; approval: string }

/** One row per exported question, in the RFI's order. */
export function provenanceRows(questions: RFIQuestion[], names: Map<string, string> = new Map()): ProvenanceRow[] {
  const decided = questions.filter((q) => q.status === 'accepted' || q.status === 'skipped').sort((a, b) => a.position - b.position);
  return decided.map((q, i) => {
    const origin = answerOrigin(q);
    const drafted = modelDrafted(origin);
    return {
      number: q.customerRef || String(i + 1),
      origin,
      model: drafted ? q.provenance.draftModel ?? '' : '',
      promptVersion: drafted ? q.provenance.promptVersion ?? '' : '',
      approvedBy: q.status === 'accepted' && q.approval ? (q.approval.by ? names.get(q.approval.by) ?? 'a team member' : 'a team member') : '',
      approvedAt: q.status === 'accepted' && q.approval ? q.approval.at : '',
      // Sprint 11 (S11-10): a skip is a decision too; say who made it and when.
      approval: q.status === 'accepted' && q.approval ? approvalLabel(q.approval) || 'individual'
        : q.status === 'skipped' && q.skip ? `skipped by ${q.skip.by ? names.get(q.skip.by) ?? 'a team member' : 'a team member'}, ${q.skip.at}` : '',
    };
  });
}

/** "yes" when every answer was model-drafted unedited, "no" when none was model-drafted, else "partially". */
function aiGenerated(rows: ProvenanceRow[]): 'yes' | 'partially' | 'no' {
  const answered = rows.filter((r) => r.origin !== 'not answered');
  const drafted = answered.filter((r) => modelDrafted(r.origin));
  if (drafted.length === 0) return 'no';
  return drafted.length === answered.length && drafted.every((r) => r.origin === 'model-drafted, approved unedited') ? 'yes' : 'partially';
}
const modelsUsed = (rows: ProvenanceRow[]) => [...new Set(rows.map((r) => r.model).filter(Boolean))];

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** CSV has no file properties, so the provenance is in columns (Sprint 7, F-27). */
export function buildCsvExport(questions: RFIQuestion[], names: Map<string, string> = new Map()): string {
  const prov = provenanceRows(questions, names);
  return buildCsv(
    ['#', 'Question', 'Answer', 'answer_origin', 'model', 'prompt_version', 'approved_by', 'approved_at', 'approval'],
    exportRows(questions).map((r, i) => [r.number, r.question, r.answer, prov[i].origin, prov[i].model, prov[i].promptVersion,
      prov[i].approvedBy, prov[i].approvedAt, prov[i].approval]),
  );
}

export function exportCSV(questions: RFIQuestion[], sourceFileName = 'export', names: Map<string, string> = new Map()) {
  triggerDownload('\ufeff' + buildCsvExport(questions, names), `${stem(sourceFileName)}.csv`, 'text/csv;charset=utf-8;');
}

// ─── Excel ────────────────────────────────────────────────────────────────────

/** The answers, a Provenance sheet, and document properties saying how they were produced. */
export async function buildExcelExport(questions: RFIQuestion[], names: Map<string, string> = new Map(), sourceFileName = 'export') {
  const prov = provenanceRows(questions, names);
  const answered = prov.filter((r) => r.origin !== 'not answered');
  const drafted = answered.filter((r) => modelDrafted(r.origin));
  const models = modelsUsed(prov);
  return buildWorkbook([
    { name: 'RFI Responses', headers: ['#', 'Question', 'Answer', 'Was Edited'],
      rows: exportRows(questions).map((r) => [r.number, r.question, r.answer, r.edited ? 'Yes' : 'No']), columnWidths: [5, 60, 80, 12] },
    { name: 'Provenance', headers: ['#', 'Answer origin', 'Model', 'Prompt version', 'Approved by', 'Approved at', 'Approval'],
      rows: prov.map((r) => [r.number, r.origin, r.model, r.promptVersion, r.approvedBy, r.approvedAt, r.approval]), columnWidths: [8, 48, 20, 22, 22, 26, 20] },
  ], {
    creator: 'RFI Respond',
    keywords: `ai-generated: ${aiGenerated(prov)}; generator: RFI Respond`,
    subject: 'RFI response',
    title: `RFI response: ${sourceFileName}`,
    description: `${drafted.length} of ${answered.length} answered questions were drafted by a model${models.length ? ` (${models.join(', ')})` : ''}; every answer was approved by a person. Details per answer on the Provenance sheet.`,
  });
}

export async function exportExcel(questions: RFIQuestion[], sourceFileName = 'export', names: Map<string, string> = new Map()) {
  triggerDownload(await buildExcelExport(questions, names, sourceFileName), `${stem(sourceFileName)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

// ─── Word (HTML-based .doc — opens in Word/LibreOffice) ───────────────────────

/** The Word export's HTML. Every value from a document or a person is escaped (Sprint 5 security review). */
export function wordHtml(questions: RFIQuestion[], sourceFileName = 'export', names: Map<string, string> = new Map()): string {
  const exported = exportRows(questions);
  const prov = provenanceRows(questions, names);
  const provRows = prov.map((r) => `<tr><td>${escapeHtml(r.number)}</td><td>${escapeHtml(r.origin)}</td><td>${escapeHtml(r.model)}</td><td>${escapeHtml(r.promptVersion)}</td><td>${escapeHtml(r.approvedBy)}</td><td>${escapeHtml(r.approvedAt)}</td><td>${escapeHtml(r.approval)}</td></tr>`).join('');
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
      <meta name="generator" content="RFI Respond">
      <meta name="ai-generated" content="${aiGenerated(prov)}">
      <meta name="ai-models" content="${escapeHtml(modelsUsed(prov).join(', '))}">
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
      <h2 style="font-size:14px;color:#0f172a;margin:32px 0 8px;">How each answer was produced</h2>
      <table class="provenance">
        <thead><tr><th>#</th><th>Origin</th><th>Model</th><th>Prompt version</th><th>Approved by</th><th>Approved at</th><th>Approval</th></tr></thead>
        <tbody>${provRows}</tbody>
      </table>
    </body>
    </html>`;
  return html;
}

export function exportWord(questions: RFIQuestion[], sourceFileName = 'export', names: Map<string, string> = new Map()) {
  triggerDownload('\ufeff' + wordHtml(questions, sourceFileName, names), `${stem(sourceFileName)}.doc`, 'application/msword');
}
