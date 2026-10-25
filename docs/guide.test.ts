/**
 * Sprint 10, S10-1: the user guide must describe the app as it is.
 * 1. Every bold phrase in the guide is a label the app shows (the guide's convention: bold is used
 *    only for words copied from the screen), so a renamed button fails here.
 * 2. Every link to a heading in another page (or the same page) finds that heading.
 * 3. Every reason a question is held from bulk approval, every badge and every answer heading is
 *    explained, so a new one cannot ship undocumented.
 * 4. Every error message the guide quotes is one the code can give.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const GUIDE = join(ROOT, 'docs/guide');
const read = (p: string) => readFileSync(p, 'utf8');
const PAGES = readdirSync(GUIDE).filter((f) => f.endsWith('.md'));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}
// The app's own code, and the Edge Functions' messages that it shows.
const SRC = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'supabase/functions/_shared'))].map(read).join('\n');

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');
}
const anchors = (markdown: string) => new Set([...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1])));

describe('slug', () => {
  it('follows GitHub', () => {
    expect(slug('Asking a colleague')).toBe('asking-a-colleague');
    expect(slug('4. Review')).toBe('4-review');
    expect(slug('What the knowledge base learns')).toBe('what-the-knowledge-base-learns');
  });
});

describe.each(PAGES)('docs/guide/%s', (page) => {
  const text = read(join(GUIDE, page));

  it('bolds only labels the app shows', () => {
    for (const [, label] of text.matchAll(/\*\*([^*]+)\*\*/g)) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(new RegExp(`(^|[^\\w])${escaped}([^\\w]|$)`).test(SRC), `${page}: **${label}** is not in the app`).toBe(true);
    }
  });

  it('links to headings that exist', () => {
    for (const [, file, anchor] of text.matchAll(/\]\(([^)#\s]*)#([^)\s]+)\)/g)) {
      const target = file ? normalize(join(GUIDE, file)) : join(GUIDE, page);
      expect(existsSync(target), `${page} links to ${file}`).toBe(true);
      expect(anchors(read(target)).has(anchor), `${page} links to ${relative(GUIDE, target)}#${anchor}`).toBe(true);
    }
  });
});

describe('the guide covers the app', () => {
  const card = read(join(GUIDE, 'question-card.md'));
  const running = read(join(GUIDE, 'running-a-response.md'));
  const component = read(join(ROOT, 'src/RFIQuestionCard.tsx'));

  it('explains every badge on the question card', () => {
    const block = component.match(/const GATE_BADGE[\s\S]*?\n};/)![0];
    const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(6);
    for (const l of labels) expect(card, l).toContain(`| ${l} |`);
  });

  it('explains every answer heading and checker verdict', () => {
    const headings = [...read(join(ROOT, 'src/lib/answerLabel.ts')).match(/ANSWER_HEADING[\s\S]*?\n};/)![0].matchAll(/: '([^']+)'/g)].map((m) => m[1]);
    for (const h of headings) expect(card, h).toContain(`**${h}**`);
    for (const v of ['Yes', 'Partly', 'No', 'Not available']) expect(card, v).toContain(`**${v}**`);
  });

  it('explains every reason bulk approval holds a question', () => {
    // A new field in BulkResult needs a line here and a line in the guide.
    const WHERE: Record<string, string> = {
      heldGated: 'pricing, legal or translated',
      heldUncalibrated: 'without calibrated confidence',
      heldNoDraft: 'without a draft',
      heldPartly: 'judged only partly answered, or not answered, by the checker',
      heldNoVerdict: 'not checked by a checker at all',
      heldNoChecker: 'not checked by a checker at all',
      belowThreshold: 'at or above a confidence',
    };
    const fields = [...read(join(ROOT, 'src/lib/sessions.ts')).match(/interface BulkResult \{[\s\S]*?\n\}/)![0].matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).filter((f) => f !== 'accepted');
    for (const f of fields) {
      expect(WHERE[f], `${f} has no place in the guide`).toBeDefined();
      expect(running, f).toContain(WHERE[f]);
    }
    for (const gate of ['unreviewed', 'overdue for review', 'replaced']) expect(running).toContain(gate);
  });

  it('uses only screenshots the screenshot script produces (S10-4)', () => {
    const produced = new Set([...read(join(ROOT, 'scripts/screenshots.ts')).matchAll(/shoot\(page, '([\w.-]+\.png)'/g)].map((m) => m[1]));
    expect(produced.size).toBeGreaterThanOrEqual(8);
    const used = PAGES.flatMap((p) => [...read(join(GUIDE, p)).matchAll(/\(\.\.\/screenshots\/([\w.-]+\.png)\)/g)].map((m) => m[1]));
    const intro = [...read(join(ROOT, 'src/lib/onboarding.ts')).matchAll(/image: '([\w.-]+\.png)'/g)].map((m) => m[1]);
    for (const f of [...used, ...intro]) expect(produced, f).toContain(f);
  });

  it('describes every role', () => {
    const index = read(join(GUIDE, 'README.md'));
    for (const role of ['Member', 'Response owner', 'Admin']) expect(index).toMatch(new RegExp(`^\\| ${role} \\|`, 'm'));
  });

  it('quotes only error messages the app gives', () => {
    const problems = read(join(GUIDE, 'common-problems.md'));
    const rows = problems.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Message begins'));
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const message = row.split('|')[1].trim().replace(/2000/, '${LIMITS.maxRows}');
      expect(SRC.includes(message), message).toBe(true);
    }
  });
});
