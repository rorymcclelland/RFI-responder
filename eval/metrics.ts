/** Retrieval and separation metrics for the evaluation scripts (pure functions, unit-tested). */

export interface Ranking {
  gold: string;
  ranked: string[];
}

export function recallAt(rankings: Ranking[], k: number): number {
  if (rankings.length === 0) return 0;
  return rankings.filter((r) => r.ranked.slice(0, k).includes(r.gold)).length / rankings.length;
}

export function meanReciprocalRank(rankings: Ranking[]): number {
  if (rankings.length === 0) return 0;
  const total = rankings.reduce((sum, r) => {
    const i = r.ranked.indexOf(r.gold);
    return sum + (i === -1 ? 0 : 1 / (i + 1));
  }, 0);
  return total / rankings.length;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Ids ordered by score, highest first; ties broken by id so results are repeatable. */
export function rankBy(scores: Record<string, number>): string[] {
  return Object.keys(scores).sort((x, y) => scores[y] - scores[x] || x.localeCompare(y));
}

/** Reciprocal rank fusion: score = sum over rankings of 1 / (k + rank). k = 60 is the usual default. */
export function reciprocalRankFusion(rankings: string[][], k = 60): string[] {
  const score: Record<string, number> = {};
  for (const ranking of rankings) {
    ranking.forEach((id, i) => {
      score[id] = (score[id] ?? 0) + 1 / (k + i + 1);
    });
  }
  return rankBy(score);
}

/**
 * Area under the ROC curve: the chance that a randomly chosen positive scores higher
 * than a randomly chosen negative (ties count half). Used to ask how well the top
 * score separates answerable from unanswerable questions.
 */
export function auroc(positives: number[], negatives: number[]): number {
  if (positives.length === 0 || negatives.length === 0) return 0.5;
  let wins = 0;
  for (const p of positives) for (const n of negatives) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (positives.length * negatives.length);
}
