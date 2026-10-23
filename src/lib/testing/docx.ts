/** Builds minimal .docx files for tests (Sprint 5). A .docx is a zip of XML parts. */
import JSZip from 'jszip';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export const p = (text: string, opts: { style?: string; num?: [numId: number, level: number] } = {}) =>
  `<w:p><w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${opts.num ? `<w:numPr><w:ilvl w:val="${opts.num[1]}"/><w:numId w:val="${opts.num[0]}"/></w:numPr>` : ''}</w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

export const table = (rows: string[][]) =>
  `<w:tbl>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;

/** A numbering part: numId 1 is "1.", "1.1." and "(a)" by level. */
export const NUMBERING = `<?xml version="1.0"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>
<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="(%3)"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

export async function makeDocx(body: string, opts: { numbering?: string; extra?: Record<string, string>; name?: string } = {}) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  if (opts.numbering) zip.file('word/numbering.xml', opts.numbering);
  for (const [path, content] of Object.entries(opts.extra ?? {})) zip.file(path, content);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return upload(bytes, opts.name ?? 'questions.docx');
}

export const upload = (bytes: Uint8Array, name: string) => ({
  name,
  size: bytes.byteLength,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});
