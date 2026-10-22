// Sprint 0, story S0-3: safe spreadsheet handling.
// Test numbers refer to docs/refinement/sprint-0.md. Uploaded files are untrusted.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  LIMITS,
  SpreadsheetError,
  parseSpreadsheet,
  neutraliseFormula,
  buildCsv,
  buildXlsx,
  escapeHtml,
  type UploadLike,
} from './spreadsheet';

function fileFrom(name: string, data: Uint8Array | string): UploadLike {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return {
    name,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  };
}

async function xlsxFrom(rows: (string | number)[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach((r) => ws.addRow(r));
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const sampleCsv = readFileSync(new URL('../../sample-questions.csv', import.meta.url), 'utf8');

describe('parseSpreadsheet: normal cases', () => {
  it('1. the sample CSV and the same data as .xlsx give the same questions', async () => {
    const fromCsv = await parseSpreadsheet(fileFrom('sample-questions.csv', sampleCsv));
    expect(fromCsv.rows.length).toBe(40);

    const asRows = [fromCsv.headers, ...fromCsv.rows.map((r) => fromCsv.headers.map((h) => r[h]))];
    const fromXlsx = await parseSpreadsheet(fileFrom('sample-questions.xlsx', await xlsxFrom(asRows)));
    expect(fromXlsx.headers).toEqual(fromCsv.headers);
    expect(fromXlsx.rows).toEqual(fromCsv.rows);
  });

  it('2. old .xls files are refused with advice to resave as .xlsx (ExcelJS decision, 22 Oct)', async () => {
    const err = await parseSpreadsheet(fileFrom('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).catch((e) => e);
    expect(err).toBeInstanceOf(SpreadsheetError);
    expect(err.message).toMatch(/\.xlsx/);
  });

  it('4. keeps column order so the question column can be found when it is not first', async () => {
    const r = await parseSpreadsheet(fileFrom('q.csv', 'Ref,Section,Question\n1,Security,Do you use MFA?\n'));
    expect(r.headers).toEqual(['Ref', 'Section', 'Question']);
    expect(r.rows[0].Question).toBe('Do you use MFA?');
  });

  it('turns numbers and dates in .xlsx cells into text', async () => {
    const r = await parseSpreadsheet(fileFrom('n.xlsx', await xlsxFrom([['Ref', 'Question'], [7, 'Uptime?']])));
    expect(r.rows[0].Ref).toBe('7');
  });
});

describe('parseSpreadsheet: edge cases', () => {
  it('3a. an empty file gives a friendly error', async () => {
    await expect(parseSpreadsheet(fileFrom('empty.csv', ''))).rejects.toThrow(/empty/i);
  });

  it('3b. a header-only file gives a friendly error', async () => {
    await expect(parseSpreadsheet(fileFrom('h.csv', 'Question,Answer\n'))).rejects.toThrow(/no rows/i);
  });

  it('3c. blank rows are skipped', async () => {
    const r = await parseSpreadsheet(fileFrom('b.csv', 'Question\nA?\n\n,\nB?\n'));
    expect(r.rows.map((x) => x.Question)).toEqual(['A?', 'B?']);
  });

  it('blank and duplicate headers get unique names', async () => {
    const r = await parseSpreadsheet(fileFrom('d.csv', 'Question,,Question\na,b,c\n'));
    expect(r.headers).toEqual(['Question', 'Column 2', 'Question (2)']);
  });
});

describe('parseSpreadsheet: failure cases', () => {
  it('5. a renamed executable is rejected', async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // "MZ" header
    await expect(parseSpreadsheet(fileFrom('evil.xlsx', exe))).rejects.toThrow(SpreadsheetError);
    await expect(parseSpreadsheet(fileFrom('evil.csv', exe))).rejects.toThrow(SpreadsheetError);
  });

  it('5b. an unsupported extension is rejected', async () => {
    await expect(parseSpreadsheet(fileFrom('notes.pdf', '%PDF-1.7'))).rejects.toThrow(/\.csv or \.xlsx/);
  });

  it('6a. a file over the size limit is rejected before it is read', async () => {
    let read = false;
    const big: UploadLike = { name: 'big.csv', size: LIMITS.maxBytes + 1, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } };
    await expect(parseSpreadsheet(big)).rejects.toThrow(/too large/i);
    expect(read).toBe(false);
  });

  it('6b. more rows than the limit are rejected', async () => {
    const csv = 'Question\n' + Array.from({ length: LIMITS.maxRows + 1 }, (_, i) => `Q${i}?`).join('\n');
    await expect(parseSpreadsheet(fileFrom('many.csv', csv))).rejects.toThrow(/rows/i);
  });

  it('6c. a cell longer than the limit is rejected, naming the row', async () => {
    const csv = `Question\nshort\n${'x'.repeat(LIMITS.maxCellChars + 1)}\n`;
    await expect(parseSpreadsheet(fileFrom('long.csv', csv))).rejects.toThrow(/row 3/i);
  });
});

describe('hostile input', () => {
  it('9. a header called __proto__ does not pollute object prototypes', async () => {
    const r = await parseSpreadsheet(fileFrom('p.csv', '__proto__,Question\n{"polluted":true},Q?\n'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.rows[0])).toBeNull();
    expect(r.rows[0].Question).toBe('Q?');
  });

  it('formula text in an uploaded cell is kept as plain text', async () => {
    const r = await parseSpreadsheet(fileFrom('f.xlsx', await xlsxFrom([['Question'], ['=1+1']])));
    expect(r.rows[0].Question).toBe('=1+1');
  });
});

describe('export escaping', () => {
  it.each(['=HYPERLINK("http://evil","click")', '+1', '-1+2', '@SUM(A1)', '\t=1', '\r=1'])(
    '7. neutralises a cell starting with a formula character: %j',
    (v) => {
      expect(neutraliseFormula(v).startsWith("'")).toBe(true);
    },
  );

  it('leaves ordinary text alone', () => {
    expect(neutraliseFormula('We use MFA.')).toBe('We use MFA.');
  });

  it('7. CSV export quotes and neutralises cells', () => {
    const csv = buildCsv(['#', 'Question'], [['1', '=HYPERLINK("http://evil","click")']]);
    expect(csv).toBe('"#","Question"\r\n"1","\'=HYPERLINK(""http://evil"",""click"")"');
  });

  it('7. Excel export stores formula-like text as text, not a formula', async () => {
    const bytes = await buildXlsx('RFI Responses', ['Question'], [['=1+1']]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer);
    const cell = wb.worksheets[0].getCell('A2');
    // In .xlsx a text cell is never evaluated, so no apostrophe is needed (it would show to the reader).
    expect(cell.formula).toBeUndefined();
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=1+1');
  });

  it('8. Word (HTML) export escapes markup and ampersands', () => {
    expect(escapeHtml('<script>alert(1)</script> & "q" &amp;')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &amp;amp;',
    );
  });
});
