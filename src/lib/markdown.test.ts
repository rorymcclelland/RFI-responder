import { describe, expect, it } from 'vitest';
import { imageFile, parseInline, parseMarkdown, resolveLink, slug } from './markdown';

const REPO = 'https://github.com/example/repo';
const PAGES = ['README.md', 'admin.md', 'running-a-response.md'];

describe('parseMarkdown (S10-2)', () => {
  it('reads headings with GitHub anchors, paragraphs, lists, tables and images', () => {
    const blocks = parseMarkdown([
      '# Running a response', '', 'First line', 'second line.', '',
      '- one', '- two', '  - nested', '', '1. first', '2. second', '',
      '| A | B |', '|---|---|', '| x | y |', '', '![The overview](../screenshots/1-overview.png)',
    ].join('\n'));
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'table', 'image']);
    expect(blocks[0]).toMatchObject({ level: 1, id: 'running-a-response' });
    expect(blocks[1]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: 'First line second line.' }] });
    const list = blocks[2] as Extract<(typeof blocks)[number], { kind: 'list' }>;
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[1].children[0]).toMatchObject({ kind: 'list', items: [{ content: [{ kind: 'text', text: 'nested' }] }] });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[4]).toMatchObject({ kind: 'table', header: [[{ text: 'A' }], [{ text: 'B' }]], rows: [[[{ text: 'x' }], [{ text: 'y' }]]] });
    expect(blocks[5]).toEqual({ kind: 'image', alt: 'The overview', src: '../screenshots/1-overview.png' });
  });

  it('keeps HTML and script as text: it is never markup', () => {
    const blocks = parseMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)> **<b>bold</b>**');
    expect(blocks[0]).toEqual({ kind: 'paragraph', content: [{ kind: 'text', text: '<script>alert(1)</script>' }] });
    expect(blocks[1]).toMatchObject({ kind: 'paragraph', content: [{ kind: 'text', text: '<img src=x onerror=alert(1)> ' }, { kind: 'strong', children: [{ kind: 'text', text: '<b>bold</b>' }] }] });
  });

  it('reads every page of the guide without losing text', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(__dirname, '../../docs/guide');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      const blocks = parseMarkdown(text);
      expect(blocks[0], f).toMatchObject({ kind: 'heading', level: 1 });
      // Every word of the page survives (markup aside).
      const words = (s: string) => s.replace(/[*`#|\-[\]()!]/g, ' ').split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
      const rendered = JSON.stringify(blocks);
      for (const w of new Set(words(text))) expect(rendered, `${f}: ${w}`).toContain(w);
    }
  });
});

describe('heading anchors', () => {
  it('are unique on a page, as on GitHub', () => {
    const ids = parseMarkdown('# A\n\n## Notes\n\n## Notes\n\n## Notes').flatMap((b) => (b.kind === 'heading' ? [b.id] : []));
    expect(ids).toEqual(['a', 'notes', 'notes-1', 'notes-2']);
  });
});

describe('parseInline', () => {
  it('reads bold, code, links and images', () => {
    expect(parseInline('Choose **Accept**, see [the card](question-card.md#actions), run `npm test` ![x](../screenshots/a.png).')).toEqual([
      { kind: 'text', text: 'Choose ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'Accept' }] },
      { kind: 'text', text: ', see ' },
      { kind: 'link', href: 'question-card.md#actions', children: [{ kind: 'text', text: 'the card' }] },
      { kind: 'text', text: ', run ' },
      { kind: 'code', text: 'npm test' },
      { kind: 'text', text: ' ' },
      { kind: 'image', alt: 'x', src: '../screenshots/a.png' },
      { kind: 'text', text: '.' },
    ]);
  });
  it('leaves an unclosed marker as text', () => {
    expect(parseInline('a ** b [c](')).toEqual([{ kind: 'text', text: 'a ** b [c](' }]);
  });
});

describe('slug', () => {
  it('matches GitHub', () => {
    expect(slug('4. Review')).toBe('4-review');
    expect(slug('Confidence and similarity')).toBe('confidence-and-similarity');
  });
});

describe('resolveLink', () => {
  it('opens guide pages in the app', () => {
    expect(resolveLink('admin.md', 'README.md', PAGES, REPO)).toEqual({ kind: 'page', page: 'admin.md', anchor: null });
    expect(resolveLink('running-a-response.md#asking-a-colleague', 'admin.md', PAGES, REPO)).toEqual({ kind: 'page', page: 'running-a-response.md', anchor: 'asking-a-colleague' });
    expect(resolveLink('#roles', 'README.md', PAGES, REPO)).toEqual({ kind: 'page', page: 'README.md', anchor: 'roles' });
  });
  it('sends the web and the rest of the repository to a new tab', () => {
    expect(resolveLink('https://supabase.com/docs', 'admin.md', PAGES, REPO)).toEqual({ kind: 'external', href: 'https://supabase.com/docs' });
    expect(resolveLink('../technical/DEVELOPMENT.md', 'common-problems.md', PAGES, REPO))
      .toEqual({ kind: 'external', href: `${REPO}/blob/main/docs/technical/DEVELOPMENT.md` });
  });
  it('makes no link of anything else', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'missing.md', 'file.exe', 'vbscript:x',
      // Security review, Sprint 10 (L1): encoded "..", backslashes, protocol-relative and plain http.
      '%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/attacker/evil/x.md', '..\\..\\x.md', '//evil.example/x.md', 'http://example.com']) {
      expect(resolveLink(bad, 'README.md', PAGES, REPO), bad).toEqual({ kind: 'none' });
    }
  });
});

describe('imageFile', () => {
  it('finds only screenshots', () => {
    expect(imageFile('../screenshots/2-review.png')).toBe('2-review.png');
    expect(imageFile('https://example.com/x.png')).toBeNull();
    expect(imageFile('../screenshots/../../secret.png')).toBeNull();
  });
});
