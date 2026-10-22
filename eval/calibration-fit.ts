/** Calibration maths for S1-6 (pure functions, unit-tested). */

export interface XY { x: number; y: number }

/**
 * Isotonic regression by pool adjacent violators: the closest non-decreasing fit to
 * the points (least squares), so "higher similarity" never means "less likely right".
 */
export function isotonicFit(points: XY[]): XY[] {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const blocks: { sum: number; n: number; xs: number[] }[] = [];
  for (const p of sorted) {
    blocks.push({ sum: p.y, n: 1, xs: [p.x] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, n: a.n + b.n, xs: [...a.xs, ...b.xs] });
    }
  }
  return blocks.flatMap((b) => b.xs.map((x) => ({ x, y: b.sum / b.n })));
}

/**
 * Compress a fit into breakpoints for the app: for each flat step, its first and last
 * score, so linear interpolation reproduces the steps closely.
 */
export function toBreakpoints(fit: XY[]): { score: number; probability: number }[] {
  const out: { score: number; probability: number }[] = [];
  for (let i = 0; i < fit.length; i++) {
    const isStepStart = i === 0 || fit[i].y !== fit[i - 1].y;
    const isStepEnd = i === fit.length - 1 || fit[i].y !== fit[i + 1].y;
    if (isStepStart || isStepEnd) {
      const point = { score: round(fit[i].x), probability: round(fit[i].y) };
      if (!out.length || point.score > out[out.length - 1].score) out.push(point);
    }
  }
  return out;
}

const round = (v: number) => Math.round(v * 10000) / 10000;

export interface Prediction { p: number; correct: boolean }

export function reliabilityBins(items: Prediction[], bins = 10) {
  return Array.from({ length: bins }, (_, b) => {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const inBin = items.filter((it) => it.p >= lo && (it.p < hi || (b === bins - 1 && it.p <= 1)));
    const count = inBin.length;
    return {
      range: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      count,
      meanPredicted: count ? inBin.reduce((s, it) => s + it.p, 0) / count : 0,
      observed: count ? inBin.filter((it) => it.correct).length / count : 0,
    };
  });
}

/** Weighted average gap between predicted and observed rates across bins. */
export function expectedCalibrationError(items: Prediction[], bins = 10): number {
  if (items.length === 0) return 0;
  return reliabilityBins(items, bins).reduce(
    (s, b) => s + (b.count / items.length) * Math.abs(b.meanPredicted - b.observed), 0);
}
