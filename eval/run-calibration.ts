/**
 * Calibration for Sprint 1 (story S1-6). Run after `npm run eval:retrieval`:
 *
 *   npm run eval:calibrate
 *
 * For each method in the newest docs/evals/retrieval-*.json (and answerability-*.json), fits an
 * isotonic curve from the top score to whether the top entry was right (unanswerable and near-miss
 * questions count as wrong). Since Sprint 8 (S8-2, F-16; Rory, Q2): five-fold cross-validation over
 * every question estimates how the fit performs, a leave-one-out check reports the largest change
 * one question makes to the near misses at the bulk line, and the app's table is then fitted on all
 * of them. Writes docs/evals/calibration-<date>.json with the out-of-fold predictions for the
 * intervals report. Writes supabase/functions/_shared/calibration-tables.ts
 * (used by the process-questions function) and docs/evals/calibration-<date>.md.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calibratedConfidence, NO_MATCH_FLOOR, type CalibrationTable } from '../supabase/functions/_shared/calibration';
import { adoptionCheck, calibrationBands, crossValidate, expectedCalibrationError, fitTable, leaveOneOut, reliabilityBins, usableForCalibration, type AdoptionInput } from './calibration-fit';
import { newestReport, reportBase } from './lib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BARS = { ece: 0.1, abstention: 0.8 };
/** The bulk-approval line in the app (project rule 4): the confidence that matters most for safety. */
const BULK_LINE = 0.8;

interface ItemResult { id: string; kind: string; split: string; method: string; topScore: number | null; topIsGold: boolean; language?: string; unreadable?: boolean }

/** Newest report of a kind, or null. */
function latestReport(kind: string): string | null {
  return newestReport(kind, readdirSync(join(ROOT, 'docs/evals')));
}
const latest = latestReport('retrieval');
if (!latest) {
  console.error('No docs/evals/retrieval-*.json found. Run `npm run eval:retrieval` first.');
  process.exit(1);
}
const data = JSON.parse(readFileSync(join(ROOT, 'docs/evals', latest), 'utf8')) as {
  setVersion: string; results: ItemResult[];
};
// Sprint 2: answerability results (embedding + checker), in the same row shape, if they exist.
const answerabilityFile = latestReport('answerability');
if (answerabilityFile) {
  const a = JSON.parse(readFileSync(join(ROOT, 'docs/evals', answerabilityFile), 'utf8')) as { setVersion: string; results: ItemResult[] };
  if (a.setVersion !== data.setVersion) {
    console.error(`${answerabilityFile} used set ${a.setVersion} but ${latest} used ${data.setVersion}; rerun both.`);
    process.exit(1);
  }
  data.results.push(...a.results);
}
/** Sprint 2 bars (S2-1): stricter, and about near misses specifically. */
const S2_BARS = { nearBelow: 0.8, answerableBelow: 0.1, nearAtBulk: 0 };
/** Sprint 8 stability bar (Rory, Q3): per fold, and the largest change one question makes. */
const S8_BARS = { nearAtBulkPerFold: 1, looChange: 1 };
const FOLDS = 5;
const SEED = 20261025;

// Vector-only methods: the app calibrates on the top cosine similarity.
const models = [...new Set(data.results.map((r) => r.method))].filter((m) => !m.includes('keyword'));

// Sprint 13 (S13-3, F-59): the app's method refitted across both knowledge bases. The language report
// asked every question again against the variant with 30 entries in Japanese; those checks join the
// English ones as a second copy of each question (ids suffixed @ja-corpus), kept in the same fold.
const METHOD = 'voyage-4 + claude-haiku-5-5';
const POOLED = `${METHOD} (both knowledge bases)`;
const VARIANT = '@ja-corpus';
const baseId = (id: string) => id.replace(VARIANT, '');
const languagesFile = latestReport('languages');
const items = new Map((JSON.parse(readFileSync(join(ROOT, 'eval/retrieval-set.json'), 'utf8')) as { items: { id: string; split: string }[] }).items.map((i) => [i.id, i.split]));
const variantRows: ItemResult[] = [];
if (languagesFile) {
  const l = JSON.parse(readFileSync(join(ROOT, 'docs/evals', languagesFile), 'utf8')) as { setVersion: string; method: string; rows: { id: string; kind: string; language: string; topIsGold: boolean; score?: number | null; unreadable?: boolean }[] };
  if (l.setVersion !== data.setVersion || l.method !== METHOD) {
    console.error(`${languagesFile} used set ${l.setVersion} and ${l.method}; expected ${data.setVersion} and ${METHOD}.`);
    process.exit(1);
  }
  if (l.rows.some((r) => r.score === undefined)) {
    console.error(`${languagesFile} has no raw scores; rerun npm run eval:languages (from the cache, no calls).`);
    process.exit(1);
  }
  for (const r of l.rows) {
    variantRows.push({ id: `${r.id}${VARIANT}`, kind: r.kind, split: items.get(r.id) ?? 'test', method: POOLED, topScore: r.score ?? null, topIsGold: r.topIsGold, language: r.language, unreadable: r.unreadable });
  }
}
const runs = models.map((m) => ({ label: m, rows: data.results.filter((r) => r.method === m), group: undefined as ((r: ItemResult) => string) | undefined }));
if (variantRows.length) {
  runs.push({ label: POOLED, rows: [...data.results.filter((r) => r.method === METHOD).map((r) => ({ ...r, method: POOLED })), ...variantRows], group: (r) => baseId(r.id) });
}
const measures: Record<string, AdoptionInput> = {};
const date = new Date().toISOString().slice(0, 10);
const base = reportBase('calibration', date);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lines: string[] = [
  `# Calibration, ${date}`,
  '',
  `From \`${latest}\`${answerabilityFile ? ` and \`${answerabilityFile}\`` : ''} (evaluation set ${data.setVersion}; all items unreviewed, Japanese machine-translated). Since Sprint 8: checked by ${FOLDS}-fold cross-validation over every question (folds stratified by kind and split, seed ${SEED}); the app's table is fitted on all of them. Generated by \`npm run eval:calibrate\`.`,
  '',
  `Bars agreed for Sprint 1: expected calibration error at most ${BARS.ece}; at least ${pct(BARS.abstention)} of unanswerable questions below the no-match floor (${NO_MATCH_FLOOR}).`,
  '',
  '| Model | Calibration error (cross-validated) | Unanswerable below floor (cross-validated) | of which near misses | Answerable below floor (cross-validated) | Meets Sprint 1 bars | Near misses at or above 80% (all) | Wrong top entry at or above 80% (all) | Meets Sprint 2 bars | Near misses at or above 80% (cross-validated) | Most in one fold | Largest change from one question | Meets Sprint 8 bars |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
];
const details: string[] = [];
const allTables: Record<string, CalibrationTable> = {};
const perLanguage: string[] = [];
const droppedNotes: string[] = [];

const saved: Record<string, { id: string; kind: string; language: string; p: number; correct: boolean }[]> = {};
const foldLines: string[] = [];
const perCorpus: string[] = [];
const strata = (r: { kind: string; split: string }) => `${r.kind}/${r.split}`;

for (const { label: model, rows: runRows, group } of runs) {
  // Sprint 6: an unreadable check leaves a question uncalibrated in the app, so it is not fitted on.
  const { usable: rows, dropped } = usableForCalibration(runRows);
  if (dropped) droppedNotes.push(`${model}: ${dropped} questions left out because the check was unreadable (they are never bulk-approved in the app).`);
  // The app's table: every usable question (Rory, Q2).
  const table: CalibrationTable = {
    ...fitTable(rows, model, `${data.setVersion} (all ${rows.length} questions; checked by ${FOLDS}-fold cross-validation)`),
    bands: calibrationBands(rows.map((r) => ({ x: r.topScore, y: r.topIsGold ? 1 : 0 }))),
  };
  const tables = { [model]: table };
  // How it performs: each question predicted by a table fitted without its fold.
  const cv = crossValidate<(typeof rows)[number]>(rows, FOLDS, strata, SEED, BULK_LINE, group);
  const predictions = cv.predictions.map((x) => ({ p: x.p, correct: x.row.topIsGold, kind: x.row.kind, language: x.row.language ?? 'en', id: x.row.id }));
  saved[model] = predictions.map(({ id, kind, language, p, correct }) => ({ id, kind, language, p: Math.round(p * 10000) / 10000, correct }));
  const ece = expectedCalibrationError(predictions);
  const isUnans = (k: string) => k === 'unanswerable' || k === 'near-miss';
  const unans = predictions.filter((p) => isUnans(p.kind));
  const ans = predictions.filter((p) => !isUnans(p.kind));
  const near = predictions.filter((p) => p.kind === 'near-miss');
  const unansBelow = unans.filter((p) => p.p < NO_MATCH_FLOOR).length / (unans.length || 1);
  const nearBelow = near.filter((p) => p.p < NO_MATCH_FLOOR).length / (near.length || 1);
  const ansBelow = ans.filter((p) => p.p < NO_MATCH_FLOOR).length / (ans.length || 1);
  const meets = ece <= BARS.ece && unansBelow >= BARS.abstention;
  // In-sample, with the app's table: the bulk line is a safety check, and every near miss counts.
  const conf = (r: (typeof rows)[number]) => calibratedConfidence(r.topScore, model, tables) ?? 0;
  const nearAll = rows.filter((r) => r.kind === 'near-miss');
  const nearOver = nearAll.filter((r) => conf(r) >= BULK_LINE).length;
  const over = rows.filter((r) => conf(r) >= BULK_LINE);
  const wrongOver = over.filter((r) => !r.topIsGold).length;
  const meetsS2 = ece <= BARS.ece && nearBelow >= S2_BARS.nearBelow && ansBelow <= S2_BARS.answerableBelow && nearOver <= S2_BARS.nearAtBulk;
  // Sprint 8: out of fold, the most in any one fold, and the largest change one question makes.
  const nearCv = near.filter((p) => p.p >= BULK_LINE).length;
  const mostInFold = Math.max(...cv.folds.map((f) => f.nearAtBulk));
  const loo = leaveOneOut(rows, BULK_LINE, group ?? ((r) => r.id));
  const meetsS8 = mostInFold <= S8_BARS.nearAtBulkPerFold && loo.largestChange <= S8_BARS.looChange;
  lines.push(`| ${model} | ${ece.toFixed(3)} | ${pct(unansBelow)} | ${near.length ? pct(nearBelow) : 'n/a'} | ${pct(ansBelow)} | ${meets ? 'yes' : 'no'} | ${nearOver} of ${nearAll.length} | ${wrongOver} of ${over.length} | ${meetsS2 ? 'yes' : 'no'} | ${nearCv} of ${near.length} | ${mostInFold} | ${loo.largestChange}${loo.mostInfluential ? ` (${loo.mostInfluential})` : ''} | ${meetsS8 ? 'yes' : 'no'} |`);
  measures[model] = {
    ece, unanswerableBelowFloor: unansBelow, nearBelowFloor: nearBelow, answerableBelowFloor: ansBelow, nearAtBulk: nearOver, mostInFold, looChange: loo.largestChange,
    nearAtBulkByCorpus: group
      ? { English: nearAll.filter((r) => !r.id.endsWith(VARIANT) && conf(r) >= BULK_LINE).length, 'Japanese-variant': nearAll.filter((r) => r.id.endsWith(VARIANT) && conf(r) >= BULK_LINE).length }
      : {},
  };
  if (group) {
    // Per knowledge base and language pair, out of fold (the pooled set only).
    for (const corpus of ['English', 'Japanese-variant']) {
      const mine = predictions.filter((x) => x.id.endsWith(VARIANT) === (corpus !== 'English'));
      for (const lang of ['en', 'ja']) {
        const p = mine.filter((x) => x.language === lang);
        const n = p.filter((x) => x.kind === 'near-miss');
        perCorpus.push(`| ${corpus} | ${lang === 'en' ? 'English' : 'Japanese'} | ${p.length} | ${expectedCalibrationError(p).toFixed(3)} | ${n.filter((x) => x.p >= BULK_LINE).length} of ${n.length} |`);
      }
    }
  }
  foldLines.push(`| ${model} | ${cv.folds.map((f) => `${f.ece.toFixed(3)}; ${f.nearAtBulk} of ${f.nearMisses}`).join(' | ')} |`);

  // F-13: the same table fitted on both languages, checked per language (out of fold).
  for (const lang of ['en', 'ja']) {
    const p = predictions.filter((x) => x.language === lang);
    const rightAll = rows.filter((r) => (r.language ?? 'en') === lang && r.topIsGold);
    const rightOver = rightAll.filter((r) => conf(r) >= BULK_LINE).length;
    perLanguage.push(`| ${model} | ${lang} | ${p.length} | ${expectedCalibrationError(p).toFixed(3)} | ${rightOver} of ${rightAll.length} |`);
  }

  allTables[model] = table;
  details.push(
    '', `## ${model}: reliability, out of fold`, '',
    '| Predicted | Questions | Mean predicted | Observed right |', '|---|---|---|---|',
    ...reliabilityBins(predictions).filter((b) => b.count > 0)
      .map((b) => `| ${b.range} | ${b.count} | ${pct(b.meanPredicted)} | ${pct(b.observed)} |`),
  );
}

// Sprint 13 (S13-3; Rory, Q2): the pooled table replaces the app's only if every bar holds.
const pooledSection: string[] = [];
if (measures[POOLED]) {
  const decision = adoptionCheck(measures[POOLED]);
  const nVariant = variantRows.filter((r) => !r.unreadable).length;
  if (decision.adopt) {
    allTables[METHOD] = { ...allTables[POOLED], model: METHOD, evaluationSet: `${data.setVersion} against the English knowledge base and the Japanese variant (${nVariant + data.results.filter((r) => r.method === METHOD && !r.unreadable).length} checks; checked by ${FOLDS}-fold cross-validation, each question's two copies in one fold)` };
    saved[`${METHOD} (English knowledge base only)`] = saved[METHOD];
    saved[METHOD] = saved[POOLED];
  }
  delete allTables[POOLED];
  pooledSection.push(
    '', '## Across both knowledge bases (Sprint 13, F-59)', '',
    `The app's method fitted on the English knowledge base and on the Japanese variant together (\`${languagesFile}\`: the same questions asked again with 30 entries in Japanese). Each question appears twice, so this is not twice the evidence; a question's two copies are always in the same fold, and leaving one question out removes both. The row "${POOLED}" in the table above gives every bar for it.`,
    '',
    '| Knowledge base | Question language | Questions (out of fold) | Calibration error | Near misses at or above 80% (cross-validated) |',
    '|---|---|---|---|---|',
    ...perCorpus,
    '',
    `Near misses at or above 80% with the pooled table (all): English knowledge base ${measures[POOLED].nearAtBulkByCorpus.English}, Japanese variant ${measures[POOLED].nearAtBulkByCorpus['Japanese-variant']}.`,
    '',
    decision.adopt
      ? `**Adopted** (Rory, Q2: only if every bar holds): the app's table for ${METHOD} is now the pooled fit, and the figures for ${METHOD} in this report's JSON are the pooled ones.`
      : `**Not adopted** (Rory, Q2: only if every bar holds). Missed: ${decision.failures.join('; ')}. The app keeps the table fitted on the English knowledge base.`,
  );
}

lines.push(
  '',
  `Sprint 2 bars (S2-1): calibration error at most ${BARS.ece}; at least ${pct(S2_BARS.nearBelow)} of near misses below the floor; at most ${pct(S2_BARS.answerableBelow)} of answerable questions below it; no near miss at or above ${pct(BULK_LINE)}.`,
  '',
  `Sprint 8 bars (S8-2; Rory, Q3): at most ${S8_BARS.nearAtBulkPerFold} near miss at or above ${pct(BULK_LINE)} in any fold, and no single question, removed, changes the number of near misses at or above it (all questions, the app's table) by more than ${S8_BARS.looChange}.`,
  '',
  '## Each fold',
  '',
  'Calibration error; near misses at or above 80% of near misses in the fold.',
  '',
  `| Model | ${Array.from({ length: FOLDS }, (_, i) => `Fold ${i + 1}`).join(' | ')} |`,
  `|---|${'---|'.repeat(FOLDS)}`,
  ...foldLines,
  '',
  '## Per language (F-13)',
  '',
  'One table per model, fitted on both languages; checked separately. "Right answers at or above 80%" shows whether a correctly matched question in that language can ever reach the bulk-approval line.',
  '',
  '| Model | Language | Questions (out of fold) | Calibration error | Right answers at or above 80% (all) |',
  '|---|---|---|---|---|',
  ...perLanguage,
);
lines.push(...pooledSection);
if (droppedNotes.length) lines.push('', '**Left out of the fit and the checks:**', '', ...droppedNotes.map((n) => `- ${n}`));
lines.push('', '"Answerable below floor" is the cost of the floor: answerable questions sent to a person although the knowledge base had the answer.', '', `The last two columns are the safety check for bulk approval: questions an owner could approve in bulk at ${pct(BULK_LINE)} although the top entry does not answer them. Pricing and legal questions are never bulk-approved whatever their score (project rule 4).`, ...details, '');
writeFileSync(join(ROOT, `docs/evals/${base}.md`), lines.join('\n'));
writeFileSync(join(ROOT, `docs/evals/${base}.json`), JSON.stringify({ date, setVersion: data.setVersion, folds: FOLDS, seed: SEED, predictions: saved }, null, 1) + '\n');
console.log(lines.join('\n'));
writeFileSync(
  join(ROOT, 'supabase/functions/_shared/calibration-tables.ts'),
  `/**
 * Calibration tables, generated by \`npm run eval:calibrate\` from the latest evaluation reports.
 * Do not edit by hand. Keys are the method: an embedding model ("voyage-4") or, from Sprint 2,
 * an embedding model and answerability checker ("voyage-4 + claude-haiku-5-5").
 */
import type { CalibrationTable } from './calibration.ts';

export const CALIBRATION_TABLES: Record<string, CalibrationTable> = ${JSON.stringify(allTables, null, 2)};
`,
);
console.log(`\nWritten: docs/evals/${base}.md, docs/evals/${base}.json and supabase/functions/_shared/calibration-tables.ts`);
