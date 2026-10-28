/**
 * Reading Word documents (.docx) safely (Sprint 5, S5-1).
 *
 * A .docx file is a zip of XML parts. Uploaded files come from customers and are treated as
 * hostile (project rule 6), with the same approach as spreadsheet.ts:
 * - only .docx is accepted, checked by content as well as by name; .doc (old binary) and
 *   macro-enabled files are refused with advice;
 * - the file size is checked before reading, and the sizes the zip declares are checked before
 *   anything is inflated, so a zip bomb is refused cheaply;
 * - only the main document and its numbering definitions are read; embedded objects, images,
 *   external links and alternative content are never opened or fetched;
 * - the text is extracted with a small tokenizer, never turned into HTML, so markup in the text
 *   stays text;
 * - at most 200,000 characters of text.
 *
 * The output is an ordered list of blocks: paragraphs (with their list number, worked out from
 * the numbering definitions), headings (with their level) and table cells (with table, row and
 * column). Tracked deletions are left out, as the reader of the document sees it. Numbering that
 * comes only from a paragraph style is not resolved (any number typed into the text is kept).
 */
import type JSZip from 'jszip';

export const WORD_LIMITS = {
  /** Same as spreadsheets: 5 MB. */
  maxBytes: 5 * 1024 * 1024,
  /** Unpacked size of the main document part. */
  maxDocumentXml: 20 * 1024 * 1024,
  /** Unpacked size of every part together. */
  maxTotalUnpacked: 50 * 1024 * 1024,
  /** Unpacked size divided by file size; real documents are far below this. */
  maxRatio: 100,
  /** Characters of text (S5 refinement, Q6). */
  maxChars: 200_000,
} as const;

export class WordDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WordDocumentError';
  }
}

export interface UploadLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface WordBlock {
  id: string;
  kind: 'paragraph' | 'heading' | 'cell';
  text: string;
  /** The list number as the reader sees it ("3.2.", "(a)"), when the paragraph is in a numbered list. */
  number?: string;
  /** Heading level (1 to 9). */
  level?: number;
  /** Table cells: which table (from 1), row and column (from 1). */
  table?: number;
  row?: number;
  col?: number;
}

export interface WordDocument {
  blocks: WordBlock[];
  chars: number;
}

export async function readWordDocument(file: UploadLike): Promise<WordDocument> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.doc')) {
    throw new WordDocumentError('This is the older Word format (.doc). Open it in Word, save it as .docx, then upload that.');
  }
  if (name.endsWith('.docm') || name.endsWith('.dotm')) {
    throw new WordDocumentError('Documents with macros (.docm) cannot be used. Save a copy as .docx without macros.');
  }
  if (file.size > WORD_LIMITS.maxBytes) {
    throw new WordDocumentError(`The file is too large (limit ${WORD_LIMITS.maxBytes / 1024 / 1024} MB).`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const notWord = () => new WordDocumentError('This file is not a Word document (.docx).');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw notWord();

  // Loaded on demand, like ExcelJS for spreadsheets, so the main bundle stays small.
  const { default: Zip } = await import('jszip');
  let zip: JSZip;
  try {
    zip = await Zip.loadAsync(bytes, { checkCRC32: false, createFolders: false });
  } catch {
    throw notWord();
  }
  const documentPart = zip.file('word/document.xml');
  if (!documentPart) throw notWord();
  if (zip.file(/vbaProject\.bin$/i).length > 0) {
    throw new WordDocumentError('Documents with macros cannot be used. Save a copy as .docx without macros.');
  }

  // Declared sizes, read from the zip directory before anything is inflated.
  const unpacked = (f: JSZip.JSZipObject) => (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? Infinity;
  const total = Object.values(zip.files).reduce((n, f) => n + (f.dir ? 0 : unpacked(f)), 0);
  if (unpacked(documentPart) > WORD_LIMITS.maxDocumentXml || total > WORD_LIMITS.maxTotalUnpacked) {
    throw new WordDocumentError('The document is too large when unpacked.');
  }
  if (total / Math.max(1, bytes.length) > WORD_LIMITS.maxRatio) {
    throw new WordDocumentError('The document is compressed too far to be safe to open.');
  }

  // The declared sizes can lie (security review), so inflation is counted as it happens and stopped
  // at the limit, whatever the zip claims.
  const xml = await inflateCapped(documentPart, WORD_LIMITS.maxDocumentXml);
  const numberingPart = zip.file('word/numbering.xml');
  const numbering = numberingPart ? parseNumbering(await inflateCapped(numberingPart, 1024 * 1024)) : new Map();
  const blocks = extractBlocks(xml, numbering);
  const chars = blocks.reduce((n, b) => n + b.text.length, 0);
  if (chars > WORD_LIMITS.maxChars) {
    throw new WordDocumentError('The document has more than 200,000 characters of text; split it into smaller files.');
  }
  if (blocks.length === 0) throw new WordDocumentError('The document has no text to read.');
  return { blocks, chars };
}

/** Inflates one part, counting the real output and stopping as soon as it passes the limit. */
function inflateCapped(file: JSZip.JSZipObject, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let stopped = false;
    const stream = (file as unknown as { internalStream(type: 'uint8array'): StreamHelper }).internalStream('uint8array');
    stream
      .on('data', (chunk: Uint8Array) => {
        if (stopped) return;
        total += chunk.length;
        if (total > limit) {
          stopped = true;
          stream.pause();
          reject(new WordDocumentError('The document is too large when unpacked.'));
          return;
        }
        chunks.push(chunk);
      })
      .on('error', () => {
        if (!stopped) reject(new WordDocumentError('This file is not a Word document (.docx).'));
        stopped = true;
      })
      .on('end', () => {
        if (stopped) return;
        const all = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { all.set(c, at); at += c.length; }
        resolve(new TextDecoder('utf-8').decode(all));
      })
      .resume();
  });
}
interface StreamHelper {
  on(event: 'data', f: (chunk: Uint8Array) => void): StreamHelper;
  on(event: 'error', f: (e: unknown) => void): StreamHelper;
  on(event: 'end', f: () => void): StreamHelper;
  pause(): StreamHelper;
  resume(): StreamHelper;
}

// ─── XML helpers ────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const attr = (attrs: string, name: string) => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
};

const TOKEN = /<(\/?)([A-Za-z][\w.]*:[\w.]+|[A-Za-z][\w.]*)([^>]*?)(\/?)>|([^<]+)/g;

// ─── Numbering ──────────────────────────────────────────────────────────────

interface Level { start: number; format: string; text: string }
type Numbering = Map<string, Level[]>;

/** Reads numbering definitions in one pass with the tokenizer (no backtracking patterns: security review). */
function parseNumbering(xml: string): Numbering {
  const abstracts = new Map<string, Level[]>();
  const numToAbstract = new Map<string, string>();
  let abstractId: string | null = null;
  let level: { ilvl: number; def: Level } | null = null;
  let numId: string | null = null;
  for (const m of xml.matchAll(TOKEN)) {
    const [, closing, tag, attrs = ''] = m;
    if (!tag) continue;
    const val = () => attr(attrs, 'w:val');
    switch (tag) {
      case 'w:abstractNum':
        abstractId = closing ? null : attr(attrs, 'w:abstractNumId') ?? null;
        if (abstractId !== null && !abstracts.has(abstractId)) abstracts.set(abstractId, []);
        break;
      case 'w:lvl':
        if (closing) {
          if (level && abstractId !== null) abstracts.get(abstractId)![level.ilvl] = level.def;
          level = null;
        } else {
          const ilvl = Number(attr(attrs, 'w:ilvl'));
          level = Number.isInteger(ilvl) && ilvl >= 0 && ilvl <= 8 ? { ilvl, def: { start: 1, format: 'decimal', text: '' } } : null;
        }
        break;
      case 'w:start':
        if (level) level.def.start = Math.min(Math.max(Number(val()) || 1, 0), 10_000); // capped (security review)
        break;
      case 'w:numFmt':
        if (level) level.def.format = val() ?? 'decimal';
        break;
      case 'w:lvlText':
        if (level) level.def.text = (val() ?? '').slice(0, 40);
        break;
      case 'w:num':
        numId = closing ? null : attr(attrs, 'w:numId') ?? null;
        break;
      case 'w:abstractNumId':
        if (numId !== null && val() !== undefined) numToAbstract.set(numId, val()!);
        break;
    }
  }
  const nums: Numbering = new Map();
  for (const [n, a] of numToAbstract) if (abstracts.has(a)) nums.set(n, abstracts.get(a)!);
  return nums;
}

/** A list number is passed on only if it looks like one: short, and letters, digits and . ( ) - only. */
export const SAFE_NUMBER = /^[\p{L}\p{N}.()\- ]{1,20}$/u;

function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter': return letters(n).toLowerCase();
    case 'upperLetter': return letters(n);
    case 'lowerRoman': return roman(n).toLowerCase();
    case 'upperRoman': return roman(n);
    default: return String(n);
  }
}
const letters = (n: number) => {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
};
const roman = (n: number) => {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
  return s;
};

// ─── Blocks ─────────────────────────────────────────────────────────────────

function extractBlocks(xml: string, numbering: Numbering): WordBlock[] {
  const blocks: WordBlock[] = [];
  const counters = new Map<string, number[]>();
  const push = (b: Omit<WordBlock, 'id'>) => {
    const text = b.text.replace(/\s+/g, ' ').trim();
    if (text) blocks.push({ id: `b${blocks.length + 1}`, ...b, text });
  };

  let inText = false;
  let para: { text: string; style?: string; numId?: string; ilvl?: number } | null = null;
  let tableDepth = 0;
  let tableCount = 0;
  let row = 0;
  let col = 0;
  let cellText: string[] | null = null;

  for (const m of xml.matchAll(TOKEN)) {
    const [, closing, tag, attrs = '', selfClosing, text] = m;
    if (text !== undefined) {
      if (inText && para) para.text += decodeXml(text);
      continue;
    }
    const open = !closing;
    switch (tag) {
      case 'w:t':
        inText = open && !selfClosing;
        break;
      case 'w:tab':
      case 'w:br':
      case 'w:cr':
        if (para && open) para.text += ' ';
        break;
      case 'w:p':
        if (open && !selfClosing) para = { text: '' };
        else if (closing && para) {
          finishParagraph(para);
          para = null;
        }
        break;
      case 'w:pStyle':
        if (para) para.style = attr(attrs, 'w:val');
        break;
      case 'w:numId':
        if (para) para.numId = attr(attrs, 'w:val');
        break;
      case 'w:ilvl':
        if (para) para.ilvl = Number(attr(attrs, 'w:val') ?? 0);
        break;
      case 'w:tbl':
        if (open) {
          tableDepth++;
          if (tableDepth === 1) { tableCount++; row = 0; }
        } else tableDepth--;
        break;
      case 'w:tr':
        if (open && tableDepth === 1) { row++; col = 0; }
        break;
      case 'w:tc':
        if (tableDepth !== 1) break;
        if (open) { col++; cellText = []; }
        else if (cellText) {
          push({ kind: 'cell', text: cellText.join(' '), table: tableCount, row, col });
          cellText = null;
        }
        break;
    }
  }
  return blocks;

  function finishParagraph(pp: { text: string; style?: string; numId?: string; ilvl?: number }) {
    if (cellText) {
      cellText.push(pp.text);
      return;
    }
    const heading = pp.style ? /^heading\s*(\d)$/i.exec(pp.style) : null;
    if (heading) {
      push({ kind: 'heading', text: pp.text, level: Number(heading[1]) });
      return;
    }
    let number: string | undefined;
    const levels = pp.numId && pp.numId !== '0' ? numbering.get(pp.numId) : undefined;
    if (levels && pp.text.trim()) {
      const lvl = Math.min(Math.max(pp.ilvl ?? 0, 0), 8);
      const c = counters.get(pp.numId!) ?? [];
      c[lvl] = (c[lvl] ?? (levels[lvl]?.start ?? 1) - 1) + 1;
      c.length = lvl + 1; // deeper levels restart
      counters.set(pp.numId!, c);
      const def = levels[lvl];
      if (def && def.format !== 'bullet' && def.format !== 'none') {
        const formatted = def.text.replace(/%(\d)/g, (_, k: string) => {
          const i = Number(k) - 1;
          return formatNumber(c[i] ?? levels[i]?.start ?? 1, levels[i]?.format ?? 'decimal');
        }).trim();
        // Markup or anything long is dropped, never passed on (security review, finding 1).
        if (SAFE_NUMBER.test(formatted)) number = formatted;
      }
    }
    push({ kind: 'paragraph', text: pp.text, ...(number ? { number } : {}) });
  }
}
