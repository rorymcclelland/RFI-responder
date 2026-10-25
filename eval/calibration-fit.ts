/** Calibration maths for S1-6 (pure functions, unit-tested). */
import { calibratedConfidence } from '../supabase/functions/_shared/calibration';
import { wilson } from './intervals';

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

/**
 * Sprint 6: rows the app would leave uncalibrated (an unreadable check, no score) are not fitted
 * on; the report states how many were dropped.
 */
export function usableForCalibration<T extends { topScore: number | null; unreadable?: boolean }>(rows: T[]): { usable: (T & { topScore: number })[]; dropped: number } {
  const usable = rows.filter((r) => !r.unreadable && typeof r.topScore === 'number' && Number.isFinite(r.topScore)) as (T & { topScore: number })[];
  return { usable, dropped: rows.length - usable.length };
}

// ─── Sprint 8 (S8-2, F-16): cross-validation, leave-one-out, and bands for the tooltip ────────────


export interface CalRow { id: string; kind: string; topScore: number; topIsGold: boolean }

/** Shuffle with a seed (mulberry32 then Fisher-Yates), so folds repeat. */
function seededShuffle<T>(xs: T[], seed: number): T[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * k folds, stratified: each stratum (for example question kind and split) is shuffled and dealt
 * round the folds in turn, so every fold holds near misses, which are few (33 of 363).
 */
export function stratifiedFolds<T>(rows: T[], k: number, stratum: (r: T) => string, seed: number): T[][] {
  const folds: T[][] = Array.from({ length: k }, () => []);
  const groups = new Map<string, T[]>();
  for (const r of rows) groups.set(stratum(r), [...(groups.get(stratum(r)) ?? []), r]);
  let turn = 0;
  for (const key of [...groups.keys()].sort()) {
    for (const r of seededShuffle(groups.get(key)!, seed)) folds[turn++ % k].push(r);
  }
  return folds;
}

/** Fit breakpoints on some rows. */
export function fitTable(rows: CalRow[], model: string, evaluationSet: string) {
  return { model, evaluationSet, points: toBreakpoints(isotonicFit(rows.map((r) => ({ x: r.topScore, y: r.topIsGold ? 1 : 0 })))) };
}

const confidenceUnder = (table: ReturnType<typeof fitTable>) => (r: CalRow) =>
  calibratedConfidence(r.topScore, table.model, { [table.model]: table }) ?? 0;

export interface FoldResult { n: number; ece: number; nearMisses: number; nearAtBulk: number }

/**
 * Each question predicted by a table fitted without its fold. Returns every out-of-fold prediction
 * and, per fold, its calibration error and near misses at or above the bulk line.
 */
export function crossValidate<T extends CalRow>(rows: T[], k: number, stratum: (r: T) => string, seed: number, bulkLine = 0.8) {
  const folds = stratifiedFolds(rows, k, stratum, seed);
  const predictions: { row: T; p: number }[] = [];
  const results: FoldResult[] = folds.map((held, i) => {
    const train = folds.filter((_, j) => j !== i).flat();
    const conf = confidenceUnder(fitTable(train, 'cv', 'cv'));
    const preds = held.map((row) => ({ row, p: conf(row) }));
    predictions.push(...preds);
    const near = preds.filter((x) => x.row.kind === 'near-miss');
    return {
      n: held.length,
      ece: expectedCalibrationError(preds.map((x) => ({ p: x.p, correct: x.row.topIsGold }))),
      nearMisses: near.length,
      nearAtBulk: near.filter((x) => x.p >= bulkLine).length,
    };
  });
  return { predictions, folds: results };
}

/**
 * The fit on every question, then again without each question in turn: how many near misses
 * reach the bulk line, and the largest change a single question makes (the F-16 symptom).
 */
export function leaveOneOut(rows: CalRow[], bulkLine = 0.8): { full: number; largestChange: number; mostInfluential: string | null } {
  const count = (rs: CalRow[]) => {
    const conf = confidenceUnder(fitTable(rs, 'loo', 'loo'));
    return rs.filter((r) => r.kind === 'near-miss' && conf(r) >= bulkLine).length;
  };
  const full = count(rows);
  let largestChange = 0;
  let mostInfluential: string | null = null;
  for (const r of rows) {
    const change = Math.abs(count(rows.filter((x) => x !== r)) - full);
    if (change > largestChange) { largestChange = change; mostInfluential = r.id; }
  }
  return { full, largestChange, mostInfluential };
}

export interface CalibrationBand { probability: number; n: number; low: number; high: number }

/**
 * The steps of the fit, with how many evaluation questions each rests on and a 95% Wilson interval
 * for the share that had the right entry (S8-3: shown in the confidence tooltip).
 */
export function calibrationBands(points: XY[]): CalibrationBand[] {
  const fit = isotonicFit(points);
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const bands: { probability: number; n: number; k: number }[] = [];
  fit.forEach((f, i) => {
    const last = bands[bands.length - 1];
    if (last && Math.abs(last.probability - f.y) < 1e-12) { last.n += 1; last.k += sorted[i].y; }
    else bands.push({ probability: f.y, n: 1, k: sorted[i].y });
  });
  return bands.map((b) => ({ probability: round(b.probability), n: b.n, ...roundInterval(wilson(Math.round(b.k), b.n)) }));
}
const roundInterval = (i: { low: number; high: number }) => ({ low: round(i.low), high: round(i.high) });
