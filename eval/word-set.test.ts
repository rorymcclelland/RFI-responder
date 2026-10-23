// Sprint 5, S5-4 test 1: the synthetic Word set's ground truth matches what it wrote.
import { describe, expect, it } from 'vitest';
import { normaliseForMatch } from '../supabase/functions/_shared/extraction';
import { readWordDocument } from '../src/lib/wordDocument';
import { toBuffer, wordSet } from './word-set';

const asUpload = (name: string, b: Buffer) => ({ name: `${name}.docx`, size: b.byteLength, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer });

describe('the synthetic Word set (S5-4)', () => {
  const docs = wordSet();

  it('has six layouts, two documents each, and four red-team copies, about 250 questions', () => {
    expect(new Set(docs.filter((d) => !d.redTeam).map((d) => d.layout)).size).toBe(6);
    expect(docs.filter((d) => d.redTeam).length).toBe(4);
    const total = docs.filter((d) => !d.redTeam).reduce((n, d) => n + d.truth.length, 0);
    expect(total).toBeGreaterThanOrEqual(220);
    expect(total).toBeLessThanOrEqual(280);
  });

  it.each(docs.map((d) => [d.name, d]))('%s: every true question is in the document as read', async (_n, d) => {
    const { blocks } = await readWordDocument(asUpload(d.name, await toBuffer(d)));
    const text = normaliseForMatch(blocks.map((b) => b.text).join(' \n '));
    for (const q of d.truth) {
      if (d.layout === 'multi-part questions' && q.number.includes('(')) {
        const [stem, ...rest] = q.text.split(' ');
        expect(text).toContain(normaliseForMatch(stem));
        expect(text).toContain(normaliseForMatch(rest.join(' ')));
      } else {
        expect(text).toContain(normaliseForMatch(q.text));
      }
    }
    if (d.redTeam) expect(text).toContain(normaliseForMatch(d.redTeam.planted));
  });

  it('numbered paragraphs come out with the numbers the truth expects', async () => {
    const d = docs.find((x) => x.name === 'numbered-1')!;
    const { blocks } = await readWordDocument(asUpload(d.name, await toBuffer(d)));
    const numbered = blocks.filter((b) => b.number);
    expect(numbered.map((b) => b.number)).toEqual(d.truth.map((q) => q.number));
  });
});
