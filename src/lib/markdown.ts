/**
 * Sprint 10 (S10-2): a small Markdown reader for the user guide shown inside the app.
 *
 * The guide pages are the Markdown files in docs/guide, bundled at build time, so the app and the
 * repository cannot disagree. This turns a page into a tree of plain objects, which React renders
 * as elements: no text from a page is ever inserted as HTML, so a tag or script in a page shows as
 * text. It supports only what the guides use: headings, paragraphs, lists (one level of nesting),
 * tables, images, bold, code and links. Anything else is shown as its literal text.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; children: Inline[] }
  | { kind: 'image'; src: string; alt: string };

export interface ListItem { content: Inline[]; children: Block[] }

export type Block =
  | { kind: 'heading'; level: number; id: string; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'image'; src: string; alt: string };

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}

/** Bold, code, links and images within a line; everything else is text. */
export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^`([^`]+)`/))) {
      flush();
      out.push({ kind: 'code', text: m[1] });
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/))) {
      flush();
      out.push({ kind: 'strong', children: parseInline(m[1]) });
    } else if ((m = rest.match(/^!\[([^\]]*)\]\(([^)\s]+)\)/))) {
      flush();
      out.push({ kind: 'image', alt: m[1], src: m[2] });
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush();
      out.push({ kind: 'link', href: m[2], children: parseInline(m[1]) });
    } else {
      text += source[i];
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

/** The plain text of some inline content, for heading anchors. */
export function plainText(content: Inline[]): string {
  return content.map((c) => (c.kind === 'text' || c.kind === 'code' ? c.text : c.kind === 'image' ? c.alt : plainText(c.children))).join('');
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => parseInline(c.trim()));
const LIST_ITEM = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/;
const DELIMITER = /^\|(\s*:?-+:?\s*\|)+\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  // Repeated headings get -1, -2 and so on, as on GitHub, so every anchor is unique on the page.
  const used = new Map<string, number>();
  const uniqueId = (id: string) => {
    const n = used.get(id) ?? 0;
    used.set(id, n + 1);
    return n === 0 ? id : `${id}-${n}`;
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const content = parseInline(heading[2].trim());
      blocks.push({ kind: 'heading', level: heading[1].length, id: uniqueId(slug(plainText(content))), content });
      i += 1;
      continue;
    }
    const image = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      blocks.push({ kind: 'image', alt: image[1], src: image[2] });
      i += 1;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && DELIMITER.test(lines[i + 1].trim())) {
      const header = cells(line);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }
    const first = line.match(LIST_ITEM);
    if (first && first[1].length === 0) {
      const ordered = /^\d/.test(line.trim());
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m) {
          // A continuation line of the item above, indented.
          if (lines[i].trim() !== '' && /^\s+/.test(lines[i]) && items.length) {
            const last = items[items.length - 1];
            const target = last.children.length ? lastItemOf(last.children) : last;
            target.content.push({ kind: 'text', text: ' ' }, ...parseInline(lines[i].trim()));
            i += 1;
            continue;
          }
          break;
        }
        if (m[1].length === 0) {
          items.push({ content: parseInline(m[2]), children: [] });
        } else if (items.length) {
          // One level of nesting, as the guides use.
          const parent = items[items.length - 1];
          const nestedOrdered = /^\s*\d/.test(lines[i]);
          let nested = parent.children[parent.children.length - 1];
          if (!nested || nested.kind !== 'list') {
            nested = { kind: 'list', ordered: nestedOrdered, items: [] };
            parent.children.push(nested);
          }
          (nested as Extract<Block, { kind: 'list' }>).items.push({ content: parseInline(m[2]), children: [] });
        }
        i += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    // A paragraph: lines up to a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i]) && !lines[i].trim().startsWith('|')
      && !(LIST_ITEM.test(lines[i]) && !/^\s/.test(lines[i]))
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length === 0) {
      // A line no rule above takes (a stray table row, say): shown as text.
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', content: parseInline(para.join(' ')) });
  }
  return blocks;
}

function lastItemOf(children: Block[]): ListItem | { content: Inline[] } {
  const list = children[children.length - 1];
  return list.kind === 'list' && list.items.length ? list.items[list.items.length - 1] : { content: [] };
}

/**
 * The element id of a guide heading: prefixed, so a heading can never take an id the app uses
 * (security review, Sprint 10). Links between pages keep GitHub's anchors; this maps them.
 */
export function guideId(anchor: string): string {
  return `guide-${anchor}`;
}

/** Where a link in a guide page goes. */
export type LinkTarget =
  | { kind: 'page'; page: string; anchor: string | null }
  | { kind: 'external'; href: string }
  | { kind: 'none' };

/**
 * Links between guide pages open in the app; links to the web, and to repository pages outside the
 * guide (the technical reference), open in a new tab; anything else (a javascript: link, say) is not
 * a link at all.
 */
export function resolveLink(href: string, currentPage: string, pages: readonly string[], repoUrl: string): LinkTarget {
  if (/^https:\/\//i.test(href) || /^mailto:/i.test(href)) return { kind: 'external', href };
  // Any other scheme, and encoded or backslashed paths that a browser could read as ".." (security
  // review, Sprint 10, L1), are not links.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || /[%\\]/.test(href) || href.startsWith('//')) return { kind: 'none' };
  const [path, anchor = null] = href.split('#') as [string, string?];
  if (path === '') return { kind: 'page', page: currentPage, anchor };
  if (!path.endsWith('.md')) return { kind: 'none' };
  if (!path.includes('/')) return pages.includes(path) ? { kind: 'page', page: path, anchor } : { kind: 'none' };
  // A page elsewhere in the repository, relative to docs/guide.
  const parts = ['docs', 'guide'];
  for (const part of path.split('/')) {
    if (part === '..') {
      if (parts.length === 0) return { kind: 'none' };
      parts.pop();
    } else if (part !== '.' && part !== '') parts.push(part);
  }
  return { kind: 'external', href: `${repoUrl}/blob/main/${parts.join('/')}${anchor ? `#${anchor}` : ''}` };
}

/** The file name of an image a guide page uses, so the bundled copy can be found; null for anything else. */
export function imageFile(src: string): string | null {
  const m = src.match(/^\.\.\/screenshots\/([\w.-]+\.png)$/);
  return m ? m[1] : null;
}
