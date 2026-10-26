/**
 * Intervals for the evaluation summary (Sprint 8, S8-1). No API calls: everything is computed from
 * the saved reports in docs/evals/. Run after any evaluation that changes a summary figure:
 *
 *   npm run eval:intervals
 *
 * Writes docs/evals/intervals-<date>.md: for each figure in the summary, the figure as the report
 * states it, a 95% interval, the method and what it rests on. Methods (Rory, Q1): Wilson for
 * proportions, a percentile bootstrap for calibration error and AUROC (2,000 resamples, fixed seed),
 * and figures whose items come in clusters resampled by cluster (claims by draft, questions by document).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedCalibrationError } from './calibration-fit';
import { bootstrap, clusteredProportion, formatInterval, wilson } from './intervals';
import { newestReport, reportBase } from './lib';
import { auroc } from './metrics';
import { countFromPercent, parseCount, tableCell } from './report-parse';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVALS = join(ROOT, 'docs/evals');
const files = readdirSync(EVALS);
const read = (f: string) => readFileSync(join(EVALS, f), 'utf8');
const json = <T>(f: string) => JSON.parse(read(f)) as T;
/** The newest report of a kind in the given format (newestReport, applied to that extension). */
const newest = (kind: string, ext: 'md' | 'json') => {
  const f = newestReport(kind, files.filter((x) => x.endsWith(`.${ext}`)).map((x) => x.replace(/\.md$/, '.json')));
  if (!f) throw new Error(`No ${kind} report (.${ext})`);
  return f.replace(/\.json$/, `.${ext}`);
};
const SEED = 20261025;
const UNANSWERABLE = new Set(['unanswerable', 'near-miss']);
const METHOD = 'voyage-4 + claude-haiku-5-5';
const pct = (k: number, n: number) => `${((k / n) * 100).toFixed(1)}%`;

interface Row { measure: string; figure: string; interval: string; method: string; basis: string; report: string }
const rows: Row[] = [];
const proportion = (measure: string, figure: string, k: number, n: number, basis: string, report: string) =>
  rows.push({ measure, figure, interval: formatInterval(wilson(k, n), 'percent'), method: 'Wilson', basis, report });

// Retrieval (per question).
{
  const report = newest('retrieval', 'json');
  const r = json<{ results: { method: string; kind: string; goldRank: number | null }[] }>(report).results.filter((x) => x.method === 'voyage-4');
  for (const [measure, kind] of [['Retrieval, English recall@5 (voyage-4)', 'paraphrase'], ['Retrieval, Japanese-to-English recall@5 (voyage-4)', 'translation']] as const) {
    const items = r.filter((x) => x.kind === kind);
    const k = items.filter((x) => x.goldRank !== null && x.goldRank <= 5).length;
    proportion(measure, pct(k, items.length), k, items.length, `${k} of ${items.length} questions`, report);
  }
}

// Answerability: AUROC by bootstrap, unreadable checks by Wilson.
{
  const report = newest('answerability', 'json');
  const all = json<{ results: { method: string; kind: string; topScore: number; unreadable?: boolean }[] }>(report).results.filter((x) => x.method === METHOD);
  const usable = all.filter((x) => !x.unreadable && (x.kind === 'near-miss' || !UNANSWERABLE.has(x.kind)));
  const stat = (s: typeof usable) => {
    const pos = s.filter((x) => !UNANSWERABLE.has(x.kind)).map((x) => x.topScore);
    const neg = s.filter((x) => x.kind === 'near-miss').map((x) => x.topScore);
    return pos.length && neg.length ? auroc(pos, neg) : Number.NaN;
  };
  rows.push({ measure: 'Checker, separating near misses from answerable questions (AUROC, voyage-4 + checker)', figure: stat(usable).toFixed(3),
    interval: formatInterval(bootstrap(usable, stat, { seed: SEED }), 'number'), method: 'Bootstrap', basis: `${usable.length} questions`, report });
  const k = all.filter((x) => x.unreadable).length;
  proportion('Checker replies unreadable after one retry', `${k} of ${all.length}`, k, all.length, `${all.length} checks`, report);
}

// Calibration: out-of-fold predictions (Sprint 8, S8-2).
{
  const report = newest('calibration', 'json');
  const preds = json<{ predictions: Record<string, { kind: string; p: number; correct: boolean }[]> }>(report).predictions[METHOD];
  const ece = (s: typeof preds) => expectedCalibrationError(s);
  rows.push({ measure: 'Calibration error, voyage-4 + checker (cross-validated)', figure: ece(preds).toFixed(3),
    interval: formatInterval(bootstrap(preds, ece, { seed: SEED }), 'number'), method: 'Bootstrap', basis: `${preds.length} out-of-fold predictions`, report });
  const near = preds.filter((x) => x.kind === 'near-miss');
  const k = near.filter((x) => x.p >= 0.8).length;
  proportion('Near misses at or above the 80% bulk line (cross-validated)', `${k} of ${near.length}`, k, near.length, `${near.length} near misses`, report);
}

// Consistency: the report gives a percentage of the test split; the count is recovered and checked.
{
  const report = newest('consistency', 'md');
  const text = read(report);
  const n = Number(text.match(/test split \((\d+) questions/)?.[1]);
  for (const [measure, row] of [['Checker verdict changed across five runs (test split)', 'Verdict changed between runs'], ['Questions whose confidence crossed the 80% bulk line across five runs', 'Crossed the 80% bulk line']] as const) {
    const figure = tableCell(text, row, 'All');
    const k = countFromPercent(figure, n);
    proportion(measure, figure, k, n, `${k} of ${n} questions`, report);
  }
}

// Gates.
{
  const report = newest('gates', 'md');
  const text = read(report);
  for (const [measure, column] of [['Pricing and legal questions gated (rules and classifier)', 'Pricing and legal gated'], ['Lookalike questions wrongly gated', 'Lookalikes wrongly gated']] as const) {
    const figure = tableCell(text, ['all', 'combined'], column);
    const { k, n } = parseCount(figure);
    proportion(measure, figure, k, n, `${n} questions`, report);
  }
}

// Drafting: claims clustered by draft; citations and abstention per question.
{
  const report = newest('drafting', 'json');
  const results = json<{ id: string; draft_kind: string; citesGold: boolean; claims?: { supported: boolean }[] }[]>(report);
  const labels = json<{ items: { id: string; kind: string }[] }>('../../eval/drafting-labels.json').items;
  const kind = new Map(labels.map((l) => [l.id, l.kind]));
  const drafts = results.filter((r) => r.draft_kind === 'generated').map((r) => ({ k: (r.claims ?? []).filter((c) => c.supported).length, n: (r.claims ?? []).length })).filter((c) => c.n > 0);
  const k = drafts.reduce((a, c) => a + c.k, 0);
  const n = drafts.reduce((a, c) => a + c.n, 0);
  const faith = clusteredProportion(drafts, { seed: SEED });
  rows.push({ measure: 'Faithfulness of drafts (claims supported by the cited entries)', figure: `${pct(k, n)} of ${n} claims`, interval: formatInterval(faith, 'percent'),
    method: faith.method.replace(/cluster(s?)/g, 'draft$1'), basis: `${n} claims in ${drafts.length} drafts`, report });
  const answerable = results.filter((r) => kind.get(r.id) !== 'near-miss');
  const cited = answerable.filter((r) => r.citesGold).length;
  proportion('Right entry cited', pct(cited, answerable.length), cited, answerable.length, `${cited} of ${answerable.length} answerable questions`, report);
  const near = results.filter((r) => kind.get(r.id) === 'near-miss');
  const none = near.filter((r) => r.draft_kind === 'insufficient_evidence').length;
  proportion('Near misses given no draft', pct(none, near.length), none, near.length, `${none} of ${near.length} near misses`, report);
}

// Duplicates: a percentage of all questions in the answerability run it was computed from.
{
  const report = newest('duplicates', 'md');
  const text = read(report);
  const figure = tableCell(text, ['voyage-4', '0.55'], 'Wrong supersessions');
  const source = text.match(/From `([^`]+\.json)`/)?.[1];
  if (!source) throw new Error(`${report} does not name its source`);
  // The same questions run-duplicates counts: readable checks only (security review, Sprint 8).
  const n = json<{ results: { method: string; unreadable?: boolean }[] }>(source).results.filter((r) => r.method === METHOD && !r.unreadable).length;
  const k = countFromPercent(figure, n);
  proportion('Wrong supersessions at the learning threshold (voyage-4, 0.55)', figure, k, n, `${k} of ${n} questions`, report);
}

// Extraction: questions clustered by document (clean documents only).
{
  const report = newest('extraction', 'json');
  const docs = json<{ rows: { name: string; score: { truth: number; found: number; matched: number } }[] }>(report).rows.filter((r) => !r.name.startsWith('redteam'));
  for (const [measure, of] of [['Word extraction recall, synthetic documents', 'truth'], ['Word extraction precision, synthetic documents', 'found']] as const) {
    const clusters = docs.map((d) => ({ k: d.score.matched, n: d.score[of] }));
    const k = clusters.reduce((a, c) => a + c.k, 0);
    const n = clusters.reduce((a, c) => a + c.n, 0);
    const i = clusteredProportion(clusters, { seed: SEED });
    rows.push({ measure, figure: pct(k, n), interval: formatInterval(i, 'percent'),
      method: i.method.replace(/cluster(s?)/g, 'document$1'), basis: `${n} questions in ${docs.length} documents`, report });
  }
  const md = read(newest('extraction', 'md'));
  const figure = tableCell(md, 'Red-team documents that changed the result', 'Result');
  const { k, n } = parseCount(figure);
  proportion('Red-team Word documents that changed the result', figure, k, n, `${n} documents`, newest('extraction', 'md'));
}

// Planted claims (Sprint 9, S9-3): the report's own count.
{
  const report = newest('faithfulness-plants', 'md');
  const figure = tableCell(read(report), 'Planted claims caught', 'Result');
  const { k, n } = parseCount(figure);
  proportion('Planted unsupported claims caught by the faithfulness judge', figure, k, n, `${n} planted claims in 37 drafts, four rules`, report);
}

// Languages (Sprint 12, S12-4): the new pairs against the Japanese corpus variant, once it has been run.
if (files.some((f) => /^languages-.*\.json$/.test(f))) {
  const report = newest('languages', 'json');
  const r = json<{ rows: { pair: string | null; kind: string; goldRank: number | null; confidence: number | null }[] }>(report).rows;
  for (const pair of ['English to Japanese', 'Japanese to Japanese']) {
    const items = r.filter((x) => x.pair === pair);
    const k = items.filter((x) => x.goldRank !== null && x.goldRank <= 5).length;
    proportion(`Retrieval, ${pair.replace(' to ', '-to-')} recall@5 (voyage-4)`, pct(k, items.length), k, items.length, `${k} of ${items.length} questions`, report.replace(/\.json$/, '.md'));
  }
  const near = r.filter((x) => x.kind === 'near-miss' && x.confidence !== null);
  const k = near.filter((x) => x.confidence! >= 0.8).length;
  proportion('Near misses at or above the 80% bulk line, with Japanese entries', `${k} of ${near.length}`, k, near.length, `${near.length} near misses`, report.replace(/\.json$/, '.md'));
}

const date = new Date().toISOString().slice(0, 10);
const base = reportBase('intervals', date);
const lines = [
  `# Intervals, ${date}`,
  '',
  'A 95% interval for each figure in the evaluation summary: the range the figure could plausibly take with a different sample of questions like these. Generated by `npm run eval:intervals` from the saved reports, with no new model calls.',
  '',
  '**What an interval does not cover.** The questions are synthetic, written by Claude and unreviewed by anyone outside the project. An interval measures the uncertainty from the sample size only; it says nothing about whether real questionnaires look like these.',
  '',
  '**Methods** (agreed with the product owner, Sprint 8). Wilson score intervals for proportions. A percentile bootstrap (2,000 resamples, seed 20261025) for calibration error and AUROC. Where items come in clusters (claims within a draft, questions within a document), resampling is by cluster; when there is no failure to resample, or failures in fewer than five clusters, the Wilson interval over clusters is given instead (or the wider of the two), so a single failure never narrows an interval. Questions are treated as independent, although some are paraphrases or translations of the same knowledge-base entry.',
  '',
  '| Measure | Figure | 95% interval | Method | Based on | Report |',
  '|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.measure} | ${r.figure} | ${r.interval} | ${r.method} | ${r.basis} | \`${r.report}\` |`),
  '',
];
writeFileSync(join(EVALS, `${base}.md`), lines.join('\n'));
console.log(lines.join('\n'));
console.log(`Written: docs/evals/${base}.md`);
