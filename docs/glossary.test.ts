/**
 * Sprint 17, S17-1 (U-1): one word for each thing. Fails if a retired word (docs/GLOSSARY.md) appears in
 * the app's visible text, the guide or the introduction. Code names, table names, status values and
 * entry numbers (KB-0042) are not visible text and are allowed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** Retired words, with the word to use instead. */
export const RETIRED: [RegExp, string][] = [
  [/\bopportunit(y|ies)\b/i, 'response'],
  [/\bsessions?\b/i, 'file'],
  [/\bworkspace\b/i, 'response'],
  [/\bKB\b(?!-)/, 'knowledge base or Knowledge'],
  [/\bin review\b/i, 'In progress (a response) or Working on it (an assignment)'],
  [/\b(accept|accepts|accepted|accepting|acceptance)\b/i, 'approve, approved'],
  [/\bpending\b/i, 'to do (a question) or Asked (an assignment)'],
  [/\b(skip|skips|skipped|skipping)\b/i, 'not answered, leave unanswered'],
];

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p, ext) : ext.test(p) && !/\.test\./.test(p) ? [p] : [];
  });
}

/**
 * The text a person can see in a source file: JSX text and string literals that read as prose (they
 * contain a space or start with a capital), without comments, without `${...}` code inside templates,
 * and not PostgREST select lists (which name columns with underscores).
 */
export function visibleText(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const out: string[] = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>((?:[^<>{}]|\{[^{}]*\})*[A-Za-z](?:[^<>{}]|\{[^{}]*\})*)</g)) {
    let t = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
    if (m[3] !== undefined) t = t.replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
    // JSX text with {expressions}: the expressions are code, the rest is what people read.
    if (m[4] !== undefined) t = t.replace(/\{[^{}]*\}/g, ' ').trim();
    if (m[4] !== undefined && /[;=()]|=>|&&/.test(t)) continue;
    if (!t || /_/.test(t)) continue;
    // A string literal is visible text only if it reads as prose; JSX text always is.
    if (m[4] === undefined && !/\s/.test(t) && !/^[A-Z][a-z]/.test(t)) continue;
    out.push(t);
  }
  return out;
}

const offences = (texts: string[], where: string) =>
  texts.flatMap((t) => RETIRED.filter(([r]) => r.test(t)).map(([r, use]) => `${where}: "${t.slice(0, 90)}" (${r.source}; use ${use})`));

describe('the glossary (S17-1)', () => {
  it('finds visible text and skips code', () => {
    expect(visibleText(`<h1>New Opportunity</h1>; x === 'pending'; t('Back to Opportunities'); s.from('opportunities'); \`a \${q.status === 'skipped' ? 1 : 2} b\``))
      .toEqual(['New Opportunity', 'Back to Opportunities', 'a   b']);
    expect(offences(['New Opportunity', 'KB-0042 is reviewed', 'Open KB'], 't')).toHaveLength(2);
    expect(visibleText('<span><Clock size={12} /> {n} pending</span>')).toEqual(['pending']);
    expect(visibleText('const a = b > c && d < e;')).toEqual([]);
  });

  it('1. the app\'s visible text uses no retired word', () => {
    const found = files(join(ROOT, 'src'), /\.tsx?$/).flatMap((f) => offences(visibleText(readFileSync(f, 'utf8')), f.replace(ROOT + '/', '')));
    expect(found).toEqual([]);
  });

  it('2. the guide uses no retired word', () => {
    const found = files(join(ROOT, 'docs/guide'), /\.md$/).flatMap((f) => {
      const text = readFileSync(f, 'utf8').replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, ']');
      return offences(text.split('\n'), f.replace(ROOT + '/', ''));
    });
    expect(found).toEqual([]);
  });
});
