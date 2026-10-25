/**
 * 95% intervals for the published figures (Sprint 8, S8-1; method agreed with Rory, Q1):
 * Wilson score intervals for proportions, a percentile bootstrap for statistics such as calibration
 * error and AUROC, and figures whose items come in clusters (claims in a draft, questions in a
 * document) resampled by cluster. An interval measures sampling only: it says nothing about whether
 * the synthetic questions are representative.
 */

export interface Interval { low: number; high: number }
export interface MethodInterval extends Interval { method: string }

const Z = 1.959964;

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number): Interval {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n <= 0 || k < 0 || k > n) throw new Error(`Not a proportion: ${k} of ${n}`);
  const p = k / n;
  const z2 = Z * Z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** A small seeded generator (mulberry32), so every bootstrap repeats exactly. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BootstrapOptions { resamples?: number; seed?: number }

/** Percentile bootstrap: resample the items with replacement and take the middle 95% of the statistic. */
export function bootstrap<T>(items: T[], stat: (sample: T[]) => number, opts: BootstrapOptions = {}): Interval {
  if (items.length === 0) throw new Error('Nothing to resample');
  const resamples = opts.resamples ?? 2000;
  const next = rng(opts.seed ?? 20261025);
  const values: number[] = [];
  for (let r = 0; r < resamples; r++) {
    const sample = Array.from({ length: items.length }, () => items[Math.floor(next() * items.length)]);
    const v = stat(sample);
    if (Number.isFinite(v)) values.push(v);
  }
  values.sort((a, b) => a - b);
  const at = (q: number) => values[Math.min(values.length - 1, Math.max(0, Math.floor(q * values.length)))];
  return { low: at(0.025), high: at(0.975) };
}

/**
 * A proportion over items that come in clusters. Resampled by cluster, so failures that come
 * together are not treated as independent. When no cluster has a failure (or none a success), every
 * resample gives the same figure and the interval would have no width, which is not true; the Wilson
 * interval over clusters is given instead, counting a cluster as a success only if all its items are.
 * With failures in fewer than five clusters, the wider of the two is given (security review, Sprint 8).
 */
export function clusteredProportion(clusters: { k: number; n: number }[], opts: BootstrapOptions = {}): MethodInterval {
  const allGood = clusters.every((c) => c.k === c.n);
  const allBad = clusters.every((c) => c.k === 0);
  if (allGood || allBad) {
    return { ...wilson(allGood ? clusters.length : 0, clusters.length), method: 'Wilson over clusters (no failures to resample)' };
  }
  const ratio = (s: { k: number; n: number }[]) => s.reduce((a, c) => a + c.k, 0) / s.reduce((a, c) => a + c.n, 0);
  const boot = bootstrap(clusters, ratio, opts);
  // Security review, Sprint 8: with failures in only a few clusters, resampling rarely draws them and
  // the interval would be narrower than with no failure at all. Below five, take the wider of the
  // bootstrap and the Wilson interval over clusters, and always include the figure itself.
  const failing = clusters.filter((c) => c.k < c.n).length;
  if (failing < 5) {
    const w = wilson(clusters.length - failing, clusters.length);
    const point = ratio(clusters);
    return { low: Math.min(boot.low, w.low, point), high: Math.max(boot.high, w.high, point), method: 'wider of bootstrap by cluster and Wilson over clusters (failures in fewer than 5 clusters)' };
  }
  return { ...boot, method: 'bootstrap by cluster' };
}

/** "0.0 to 10.4%" for proportions, "0.991 to 1.000" for statistics such as AUROC. */
export function formatInterval(i: Interval, kind: 'percent' | 'number'): string {
  return kind === 'percent'
    ? `${(i.low * 100).toFixed(1)} to ${(i.high * 100).toFixed(1)}%`
    : `${i.low.toFixed(3)} to ${i.high.toFixed(3)}`;
}
