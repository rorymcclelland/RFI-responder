import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GuideContent from './GuideContent';
import { parseMarkdown } from '../lib/markdown';

const ctx = { page: 'README.md', pages: ['README.md', 'admin.md'], repoUrl: 'https://github.com/example/repo', screenshots: { '1-overview.png': '/assets/1-overview.png' }, onOpen: () => {} };
const html = (md: string) => renderToStaticMarkup(createElement(GuideContent, { blocks: parseMarkdown(md), ctx }));

describe('GuideContent (S10-2)', () => {
  it('escapes HTML and script in a page', () => {
    const out = html('<script>alert(1)</script>\n\n**<img src=x onerror=alert(1)>** `<b>`');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img src="x"');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;b&gt;');
  });

  it('opens the web in a new tab without giving it the app', () => {
    const out = html('[Supabase](https://supabase.com) and [the reference](../technical/DATA-MODEL.md)');
    expect(out).toContain('<a href="https://supabase.com" target="_blank" rel="noopener noreferrer"');
    expect(out).toContain('href="https://github.com/example/repo/blob/main/docs/technical/DATA-MODEL.md" target="_blank" rel="noopener noreferrer"');
  });

  it('keeps links between guide pages in the app, and makes no link of anything else', () => {
    const out = html('[Admin](admin.md#people) [bad](javascript:alert(1)) [gone](missing.md)');
    expect(out).toContain('<a href="#guide-people"');
    expect(out).not.toContain('target="_blank"');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('bad');
    expect(out).toContain('gone');
  });

  it('shows only bundled screenshots, and gives headings their anchors', () => {
    const out = html('# Getting started\n\n![The overview](../screenshots/1-overview.png)\n\n![Elsewhere](https://example.com/x.png)');
    expect(out).toContain('<h1 id="guide-getting-started"');
    expect(out).toContain('<img src="/assets/1-overview.png" alt="The overview"');
    expect(out).not.toContain('example.com');
    expect(out).toContain('Elsewhere');
  });

  it('renders tables and nested lists', () => {
    const out = html('| A | B |\n|---|---|\n| **x** | y |\n\n- one\n  - two');
    expect(out).toMatch(/<table[^>]*>.*<th[^>]*>A<\/th>.*<strong[^>]*>x<\/strong>/s);
    expect(out).toMatch(/<ul[^>]*><li>one<ul[^>]*><li>two<\/li><\/ul><\/li><\/ul>/);
  });
});
