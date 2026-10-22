/**
 * Reading and writing spreadsheets safely.
 *
 * Uploaded files come from customers and are treated as hostile (project rule 6):
 * - only .csv and .xlsx are accepted, checked by content as well as by name;
 * - size, row and cell-length limits are enforced, the size before reading;
 * - rows are built on prototype-less objects, so a header such as "__proto__"
 *   cannot pollute JavaScript objects;
 * - formulas are never evaluated or exported as formulas.
 *
 * Library choice (decision 0002): ExcelJS for .xlsx, PapaParse for .csv. ExcelJS
 * cannot read the old binary .xls format, so .xls files are refused with advice.
 * ExcelJS is loaded on demand because it is large.
 */
import Papa from 'papaparse';

export const LIMITS = {
  /** 5 MB: far above any real questionnaire, small enough to parse in the browser. */
  maxBytes: 5 * 1024 * 1024,
  /** Data rows, excluding the header row. */
  maxRows: 2000,
  /** Characters in any single cell. */
  maxCellChars: 5000,
} as const;

/** An error whose message is safe and useful to show the user. */
export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

/** The parts of a browser File this module needs (lets tests pass plain objects). */
export interface UploadLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type Row = Record<string, string>;

export interface ParsedSheet {
  headers: string[];
  /** Prototype-less objects keyed by header. */
  rows: Row[];
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04": every .xlsx is a zip archive

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i + 1).toLowerCase();
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((b, i) => bytes[i] === b);
}

/** Make headers non-empty and unique, keeping their order. */
function normaliseHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h.trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** Turn a grid of cell text (header first) into checked rows. */
function toSheet(grid: string[][]): ParsedSheet {
  const nonBlank = grid.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonBlank.length === 0) throw new SpreadsheetError('The file is empty.');
  const [headerRow, ...dataRows] = nonBlank;
  if (dataRows.length === 0) throw new SpreadsheetError('The file has a header row but no rows of questions.');
  if (dataRows.length > LIMITS.maxRows) {
    throw new SpreadsheetError(`The file has more than ${LIMITS.maxRows} rows. Split it into smaller files.`);
  }

  const headers = normaliseHeaders(headerRow);
  const rows = dataRows.map((cells, i) => {
    const row: Row = Object.create(null);
    headers.forEach((h, c) => {
      const value = (cells[c] ?? '').trim();
      if (value.length > LIMITS.maxCellChars) {
        // +2: spreadsheet rows count from 1 and the header is row 1.
        throw new SpreadsheetError(
          `Row ${i + 2}, column "${h}" is longer than ${LIMITS.maxCellChars} characters.`,
        );
      }
      row[h] = value;
    });
    return row;
  });
  return { headers, rows };
}

function parseCsv(bytes: Uint8Array): string[][] {
  if (bytes.subarray(0, 8192).includes(0)) {
    throw new SpreadsheetError('This does not look like a CSV text file.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SpreadsheetError('The CSV file is not valid UTF-8 text. Save it as "CSV UTF-8" and try again.');
  }
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
    // Header + limit + 1 is enough to know the limit was exceeded.
    preview: LIMITS.maxRows + 2,
  });
  return result.data.map((r) => r.map((c) => String(c ?? '')));
}

type CellValue = unknown;

/** Plain text for any ExcelJS cell value; formulas give their cached result, never the formula. */
function cellText(v: CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    if ('error' in o) return '';
    return '';
  }
  return String(v);
}

async function parseXlsx(bytes: Uint8Array): Promise<string[][]> {
  if (!startsWith(bytes, ZIP_MAGIC)) throw new SpreadsheetError('This does not look like an Excel (.xlsx) file.');
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  } catch {
    throw new SpreadsheetError('The Excel file could not be read. It may be damaged or password-protected.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new SpreadsheetError('The file is empty.');
  if (ws.actualRowCount > LIMITS.maxRows + 1) {
    throw new SpreadsheetError(`The file has more than ${LIMITS.maxRows} rows. Split it into smaller files.`);
  }
  const width = ws.actualColumnCount;
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    grid.push(cells);
  });
  return grid;
}

/** Read an uploaded .csv or .xlsx file into headers and rows, enforcing LIMITS. */
export async function parseSpreadsheet(file: UploadLike): Promise<ParsedSheet> {
  const ext = extensionOf(file.name);
  if (ext === 'xls') {
    throw new SpreadsheetError('Old Excel files (.xls) are not supported. Open it in Excel and save it as .xlsx.');
  }
  if (ext !== 'csv' && ext !== 'xlsx') {
    throw new SpreadsheetError('Please upload a .csv or .xlsx file.');
  }
  if (file.size > LIMITS.maxBytes) {
    throw new SpreadsheetError(`The file is too large (limit ${LIMITS.maxBytes / 1024 / 1024} MB).`);
  }
  if (file.size === 0) throw new SpreadsheetError('The file is empty.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const grid = ext === 'csv' ? parseCsv(bytes) : await parseXlsx(bytes);
  return toSheet(grid);
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Spreadsheet programs treat a cell starting with one of these as a formula.
 * Exported answers are prefixed with an apostrophe so a CSV opened in Excel
 * shows the text instead of running it (OWASP "CSV injection").
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutraliseFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}

export function buildCsv(headers: string[], rows: string[][]): string {
  const quote = (s: string) => `"${neutraliseFormula(s).replace(/"/g, '""')}"`;
  return [headers, ...rows].map((r) => r.map(quote).join(',')).join('\r\n');
}

/** Build an .xlsx file. Every cell is written as text, so nothing is ever evaluated as a formula. */
export async function buildXlsx(
  sheetName: string,
  headers: string[],
  rows: string[][],
  columnWidths: number[] = [],
): Promise<Uint8Array> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers).font = { bold: true };
  for (const r of rows) {
    // Plain strings become string cells; ExcelJS only writes a formula when given { formula }.
    ws.addRow(r).alignment = { wrapText: true, vertical: 'top' };
  }
  columnWidths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
