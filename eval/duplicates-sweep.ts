/**
 * Supersession at learning time, as measured on the answerability results (Sprint 3, S3-4b; the sweep
 * since Sprint 9, S9-2). A learned answer supersedes its top entry when the similarity is at or above
 * the threshold and the checker's verdict is one of `verdicts`. A wrong supersession replaces a
 * different question's entry; a real duplicate is an answerable question whose top entry is its own.
 */
export interface DupRow { kind: string; topIsGold: boolean; verdict: string | null; similarity: number; unreadable?: boolean }

export function duplicateStats(rows: DupRow[], threshold: number, verdicts: string[] | null) {
  const usable = rows.filter((r) => !r.unreadable);
  const answerable = usable.filter((r) => r.kind === 'paraphrase' || r.kind === 'translation');
  const sup = (r: DupRow) => r.similarity >= threshold && (verdicts === null || (r.verdict !== null && verdicts.includes(r.verdict)));
  const wrong = usable.filter((r) => sup(r) && !r.topIsGold).length;
  const caught = answerable.filter((r) => sup(r) && r.topIsGold).length;
  return { wrong, caught, n: usable.length, answerable: answerable.length, wrongRate: wrong / usable.length, caughtRate: caught / answerable.length };
}

/** The lowest threshold (0.30 to 0.95, in hundredths) whose wrong supersessions stay within the bar. */
export function chooseThreshold(rows: DupRow[], maxWrong: number, verdicts: string[]): number {
  for (let t = 0.3; t <= 0.95; t = Math.round((t + 0.01) * 100) / 100) {
    if (duplicateStats(rows, t, verdicts).wrongRate <= maxWrong) return t;
  }
  return 1;
}

export const SWEEP = [0.4, 0.45, 0.5, 0.52, 0.55, 0.6];
