// Sprint 5, S5-1: reading a Word document safely. Test numbers refer to docs/refinement/sprint-5.md.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { makeDocx, NUMBERING, p, table, upload } from './testing/docx';
import { readWordDocument, WordDocumentError, WORD_LIMITS } from './wordDocument';

describe('readWordDocument (S5-1)', () => {
  it('1. numbered paragraphs come out in order, with their numbers', async () => {
    const doc = await makeDocx(
      p('Security', { style: 'Heading1' }) +
      p('Do you encrypt data at rest?', { num: [1, 0] }) +
      p('Describe your key management.', { num: [1, 1] }) +
      p('And key rotation?', { num: [1, 1] }) +
      p('Do you use MFA?', { num: [1, 0] }) +
      p('(this part has a letter)', { num: [1, 2] }),
      { numbering: NUMBERING },
    );
    const { blocks } = await readWordDocument(doc);
    expect(blocks.map((b) => [b.number ?? null, b.text])).toEqual([
      [null, 'Security'],
      ['1.', 'Do you encrypt data at rest?'],
      ['1.1.', 'Describe your key management.'],
      ['1.2.', 'And key rotation?'],
      ['2.', 'Do you use MFA?'],
      ['(a)', '(this part has a letter)'],
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  });

  it('2. a table gives one block per cell, with its row and column', async () => {
    const doc = await makeDocx(table([['Ref', 'Question', 'Answer'], ['A1', 'Is data backed up daily?', ''], ['A2', 'Who can approve access?', '']]));
    const { blocks } = await readWordDocument(doc);
    const cells = blocks.filter((b) => b.kind === 'cell');
    expect(cells.find((c) => c.text === 'Is data backed up daily?')).toMatchObject({ table: 1, row: 2, col: 2 });
    expect(cells.filter((c) => c.text !== '').length).toBe(7);
    expect(blocks.some((b) => b.text === '')).toBe(false);
  });

  it('3. headings keep their level; empty paragraphs are dropped; tabs and breaks become spaces', async () => {
    const doc = await makeDocx(p('Section 2', { style: 'Heading2' }) + p('') +
      '<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t><w:tab/><w:t>end</w:t></w:r></w:p>');
    const { blocks } = await readWordDocument(doc);
    expect(blocks).toEqual([
      expect.objectContaining({ kind: 'heading', level: 2, text: 'Section 2' }),
      expect.objectContaining({ kind: 'paragraph', text: 'Line one line two end' }),
    ]);
  });

  it('4. .doc, .docm and a renamed non-zip file are refused with a plain message', async () => {
    await expect(readWordDocument(upload(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'old.doc'))).rejects.toThrow(/older Word format.*\.docx/);
    await expect(readWordDocument(await makeDocx(p('x'), { name: 'macro.docm' }))).rejects.toThrow(/macros/);
    await expect(readWordDocument(upload(new TextEncoder().encode('just text'), 'fake.docx'))).rejects.toThrow(/not a Word document/);
    const withMacros = await makeDocx(p('x'), { extra: { 'word/vbaProject.bin': 'binary' } });
    await expect(readWordDocument(withMacros)).rejects.toThrow(/macros/);
  });

  it('5a. hostile: a zip bomb is refused before it is inflated', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', `<w:document><w:body>${'<w:p></w:p>'.repeat(3_000_000)}</w:body></w:document>`);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    expect(bytes.byteLength).toBeLessThan(WORD_LIMITS.maxBytes);
    await expect(readWordDocument(upload(bytes, 'bomb.docx'))).rejects.toThrow(/too large when unpacked|compressed too far/);
  });

  it('5b. hostile: too much text is refused; markup inside text stays text', async () => {
    // Varied text (repeated letters would compress so far that the zip-bomb ratio check refuses first).
    let seed = 7;
    const word = () => { seed = (seed * 48271) % 2147483647; return seed.toString(36); };
    const long = await makeDocx(Array.from({ length: 60 }, () => p(Array.from({ length: 600 }, word).join(' '))).join(''));
    await expect(readWordDocument(long)).rejects.toThrow(/200,000 characters/);
    const sneaky = await makeDocx(p('&lt;script&gt;alert(1)&lt;/script&gt; Do you &amp; your vendors comply?'));
    const { blocks } = await readWordDocument(sneaky);
    expect(blocks[0].text).toBe('<script>alert(1)</script> Do you & your vendors comply?');
  });

  it('6. tracked deletions are ignored; tracked insertions are kept', async () => {
    const doc = await makeDocx('<w:p><w:r><w:t>Do you </w:t></w:r><w:del><w:r><w:delText>never </w:delText></w:r></w:del>' +
      '<w:ins><w:r><w:t>always </w:t></w:r></w:ins><w:r><w:t>log access?</w:t></w:r></w:p>');
    expect((await readWordDocument(doc)).blocks[0].text).toBe('Do you always log access?');
  });

  it('a file over the size limit is refused before reading', async () => {
    await expect(readWordDocument({ name: 'big.docx', size: WORD_LIMITS.maxBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) }))
      .rejects.toBeInstanceOf(WordDocumentError);
  });

  it('a document with no text is refused', async () => {
    await expect(readWordDocument(await makeDocx(p('')))).rejects.toThrow(/no text/);
  });
});

describe('Sprint 5 security review: hostile Word files (finding 3, finding 1)', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const numberingWith = (lvl: string) =>
    `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">${lvl}</w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const timed = async <T>(f: () => Promise<T>) => { const t = Date.now(); const r = await f().catch((e: Error) => e); return { r, ms: Date.now() - t }; };

  it('a huge list start is capped, so numbering stays fast and short', async () => {
    const doc = await makeDocx(p('Q one?', { num: [1, 0] }).repeat(10), {
      numbering: numberingWith('<w:start w:val="10000000000"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1"/>'),
    });
    const { r, ms } = await timed(() => readWordDocument(doc));
    expect(ms).toBeLessThan(1000);
    expect((r as { blocks: { number?: string }[] }).blocks.every((b) => !b.number || b.number.length <= 20)).toBe(true);
  });

  it('thousands of unclosed numbering elements are read in linear time', async () => {
    const doc = await makeDocx(p('Q?', { num: [1, 0] }), { numbering: `<w:numbering ${W}>` + '<w:abstractNum w:abstractNumId="1">'.repeat(20_000) });
    const { ms } = await timed(() => readWordDocument(doc));
    expect(ms).toBeLessThan(1500);
  });

  it('a zip that declares a small size but inflates to a large one is stopped while inflating', async () => {
    const big = `<?xml version="1.0"?><w:document ${W}><w:body>${p('Q?')}${'<w:p></w:p>'.repeat(3_000_000)}</w:body></w:document>`;
    const zip = new JSZip();
    zip.file('word/document.xml', big);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    // Rewrite the declared uncompressed size of the document part to 2,000 bytes (local header and central directory).
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < bytes.length - 4; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50) view.setUint32(i + 22, 2000, true);
      if (sig === 0x02014b50) view.setUint32(i + 24, 2000, true);
    }
    const { r, ms } = await timed(() => readWordDocument(upload(bytes, 'liar.docx')));
    expect(r).toBeInstanceOf(WordDocumentError);
    expect((r as Error).message).toMatch(/too large when unpacked|not a Word document/);
    expect(ms).toBeLessThan(3000);
  });

  it('a list number with markup or over 20 characters is dropped, not passed on', async () => {
    const markup = await makeDocx(p('Q markup?', { num: [1, 0] }), {
      numbering: numberingWith('<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="&amp;lt;img src=//e.vu/%1&amp;gt;"/>'),
    });
    expect((await readWordDocument(markup)).blocks[0].number).toBeUndefined();
    const long = await makeDocx(p('Q long?', { num: [1, 0] }), {
      numbering: numberingWith('<w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="Requirement %1.%1.%1.%1:"/>'),
    });
    const { blocks } = await readWordDocument(long);
    expect(blocks[0]).toMatchObject({ text: 'Q long?' });
    expect(blocks[0].number).toBeUndefined();
  });
});
