/**
 * Calibrated confidence (Sprint 1, story S1-6).
 *
 * The top match's cosine similarity is mapped to the observed chance that the top
 * entry is the right one, using a table fitted on the evaluation set for that
 * embedding model (`npm run eval:calibrate`, generated into ./calibration-tables.ts). Between
 * breakpoints the value is interpolated linearly; outside them it holds the end
 * values. No table for the model, or no similarity, means no calibrated confidence.
 */

export interface CalibrationTable {
  model: string;
  /** Evaluation set version and split the table was fitted on, shown in the tooltip. */
  evaluationSet: string;
  /** Increasing scores with non-decreasing probabilities. */
  points: { score: number; probability: number }[];
  /**
   * Sprint 8 (S8-3): each step of the fit, with how many evaluation questions it rests on and a 95%
   * interval for the share that had the right entry. Shown in the confidence tooltip.
   */
  bands?: { probability: number; n: number; low: number; high: number }[];
}

/**
 * Below this calibrated confidence the draft says there is no confident match and the
 * question goes to a person (S1-6). The evaluation report states how many
 * unanswerable questions fall below it.
 */
export const NO_MATCH_FLOOR = 0.3;

export function calibratedConfidence(
  similarity: number | null,
  model: string | null,
  tables: Record<string, CalibrationTable>,
): number | null {
  if (similarity === null || model === null) return null;
  const table = tables[model];
  if (!table || table.points.length === 0) return null;
  const pts = table.points;
  if (similarity <= pts[0].score) return clamp(pts[0].probability);
  if (similarity >= pts[pts.length - 1].score) return clamp(pts[pts.length - 1].probability);
  for (let i = 1; i < pts.length; i++) {
    if (similarity <= pts[i].score) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (similarity - a.score) / (b.score - a.score || 1);
      return clamp(a.probability + t * (b.probability - a.probability));
    }
  }
  return null;
}

const clamp = (p: number) => Math.min(1, Math.max(0, p));
