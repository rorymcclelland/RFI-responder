import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUIDE_FILES, GUIDE_PAGES, REPO_URL, SCREENSHOTS, findPage, startPage } from './guide';
import { imageFile, resolveLink, type Block, type Inline } from './markdown';

const DIR = join(__dirname, '../../docs/guide');

function inlines(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const walk = (xs: Inline[]) => xs.forEach((x) => { out.push(x); if (x.kind === 'strong' || x.kind === 'link') walk(x.children); });
  for (const b of blocks) {
    if (b.kind === 'heading' || b.kind === 'paragraph') walk(b.content);
    if (b.kind === 'table') [b.header, ...b.rows].forEach((r) => r.forEach(walk));
    if (b.kind === 'list') b.items.forEach((i) => { walk(i.content); out.push(...inlines(i.children)); });
    if (b.kind === 'image') out.push({ kind: 'image', src: b.src, alt: b.alt });
  }
  return out;
}

describe('the guide in the app (S10-2)', () => {
  it('bundles every page in docs/guide, index first', () => {
    expect([...GUIDE_FILES].sort()).toEqual(readdirSync(DIR).filter((f) => f.endsWith('.md')).sort());
    expect(GUIDE_FILES[0]).toBe('README.md');
    expect(GUIDE_PAGES.every((p) => p.title.length > 0 && p.title !== p.file)).toBe(true);
  });

  it('reaches every page from the index, and every link between pages opens in the app', () => {
    const index = inlines(findPage('README.md').blocks).filter((x) => x.kind === 'link').map((x) => resolveLink((x as { href: string }).href, 'README.md', GUIDE_FILES, REPO_URL));
    for (const f of GUIDE_FILES.filter((f) => f !== 'README.md')) expect(index, f).toContainEqual({ kind: 'page', page: f, anchor: null });
    for (const page of GUIDE_PAGES) {
      for (const link of inlines(page.blocks).filter((x) => x.kind === 'link') as { href: string }[]) {
        const target = resolveLink(link.href, page.file, GUIDE_FILES, REPO_URL);
        expect(target.kind, `${page.file}: ${link.href}`).not.toBe('none');
        if (target.kind === 'page' && target.anchor) {
          expect(findPage(target.page).blocks.some((b) => b.kind === 'heading' && b.id === target.anchor), `${page.file}: ${link.href}`).toBe(true);
        }
      }
    }
  });

  it('bundles every screenshot a page shows', () => {
    for (const page of GUIDE_PAGES) {
      for (const img of inlines(page.blocks).filter((x) => x.kind === 'image') as { src: string }[]) {
        const file = imageFile(img.src);
        expect(file, `${page.file}: ${img.src}`).not.toBeNull();
        expect(SCREENSHOTS[file!], `${page.file}: ${img.src}`).toBeTruthy();
      }
    }
  });

  it('opens at the page for the person\'s role', () => {
    expect(startPage(true)).toBe('admin.md');
    expect(startPage(false)).toBe('getting-started.md');
    expect(GUIDE_FILES).toContain(startPage(true));
    expect(GUIDE_FILES).toContain(startPage(false));
  });
});
