/**
 * Reading figures back out of the Markdown evaluation reports (Sprint 8, S8-1). Every reader fails
 * loudly rather than guess: an interval is only given for a count the report actually supports.
 */

/** The cell under `column` in the first table row whose leading cells are `row`. */
export function tableCell(markdown: string, row: string | string[], column: string): string {
  const lead = Array.isArray(row) ? row : [row];
  const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim());
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith('|') || !/^\|\s*-/.test(lines[i + 1])) continue;
    const col = cells(lines[i]).indexOf(column);
    for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
      const c = cells(lines[j]);
      if (col >= 0 && lead.every((v, x) => c[x] === v)) return c[col];
    }
  }
  throw new Error(`No row ${lead.join(' | ')} under "${column}"`);
}

/** "7 of 70 (10.0%)" to { k: 7, n: 70 }. */
export function parseCount(text: string): { k: number; n: number } {
  const m = text.match(/^(\d+) of (\d+)/);
  if (!m) throw new Error(`Not a count: ${text}`);
  return { k: Number(m[1]), n: Number(m[2]) };
}

/**
 * The count k of n that a report's percentage stands for, at the precision it was printed with.
 * Refused when no count, or more than one, gives that percentage.
 */
export function countFromPercent(text: string, n: number): number {
  const m = text.match(/^(\d+(?:\.(\d+))?)%$/);
  if (!m || !Number.isInteger(n) || n <= 0) throw new Error(`Not a percentage of ${n}: ${text}`);
  const places = m[2]?.length ?? 0;
  const ks = Array.from({ length: n + 1 }, (_, k) => k).filter((k) => ((k / n) * 100).toFixed(places) === m[1]);
  if (ks.length === 0) throw new Error(`No count of ${n} gives ${text}`);
  if (ks.length > 1) throw new Error(`${text} of ${n} could be more than one count (${ks.join(', ')})`);
  return ks[0];
}
