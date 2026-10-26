/**
 * Languages (Sprint 12, S12-4, C-1). Run on Rory's PC after `npm run eval:retrieval` (it reuses that
 * run's cached question vectors):
 *
 *   npm run eval:languages
 *
 * Builds the Japanese corpus variant (eval/languages.ts), embeds its 30 Japanese entries with
 * voyage-4, and for every item in the evaluation set measures where the right entry ranks, then asks
 * the app's checker (claude-haiku-5-5) about the entries the app would draft from and applies the
 * app's calibration table. Reads VOYAGE_API_KEY and ANTHROPIC_API_KEY from supabase/functions/.env
 * (never committed). Vectors and checks are cached in eval/.cache/, so reruns cost nothing, and since
 * Sprint 13 a rerun needs no keys when everything is cached.
 * Writes docs/evals/languages-<date>.md and .json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeJudge, type AnswerabilityResult } from '../supabase/functions/_shared/answerability';
import { calibratedConfidence } from '../supabase/functions/_shared/calibration';
import { CALIBRATION_TABLES } from '../supabase/functions/_shared/calibration-tables';
import { claudeClient } from '../supabase/functions/_shared/claude';
import { voyageProvider } from '../supabase/functions/_shared/embeddings';
import { expectedCalibrationError } from './calibration-fit';
import { wilson } from './intervals';
import { candidatesFor } from './judge-inputs';
import { languagesReport, loadJapaneseEntries, mixedCorpus, pairOf, type LanguageRow } from './languages';
import { cachedCheck, diskCache, embedCached, env, hashKey, judgeCacheParts, loadKb, reportBase, ROOT } from './lib';
import { cosine, rankBy } from './metrics';

interface Item { id: string; text: string; language: 'en' | 'ja'; kind: string; gold: string; split: string }

const JUDGE_MODEL = 'claude-haiku-5-5';
const METHOD = `voyage-4 + ${JUDGE_MODEL}`;

async function main() {
  // Sprint 13 (S13-3): without keys the run can still be rebuilt from the cache; any call it would
  // need then fails with a message rather than going out.
  const missing = (name: string) => () => { throw new Error(`Not in the cache, and ${name} is not set in supabase/functions/.env`); };
  if (!CALIBRATION_TABLES[METHOD]) throw new Error(`No calibration table for ${METHOD}; run npm run eval:calibrate first.`);
  const set = JSON.parse(readFileSync(join(ROOT, 'eval/retrieval-set.json'), 'utf8')) as { version: string; items: Item[] };
  const corpus = mixedCorpus(loadKb(), loadJapaneseEntries());
  const patient = { attempts: 10, baseDelayMs: 20_000 };
  const voyage = env.VOYAGE_API_KEY
    ? voyageProvider({ apiKey: env.VOYAGE_API_KEY, model: 'voyage-4', retry: patient })
    : { name: 'voyage', model: 'voyage-4', embed: missing('VOYAGE_API_KEY') } as unknown as ReturnType<typeof voyageProvider>;
  const judge = env.ANTHROPIC_API_KEY
    ? claudeJudge({ client: claudeClient({ apiKey: env.ANTHROPIC_API_KEY, retry: patient }), model: JUDGE_MODEL })
    : { check: missing('ANTHROPIC_API_KEY') } as unknown as ReturnType<typeof claudeJudge>;

  console.log('Embedding the corpus variant and the questions with voyage-4 (cached ones are reused)');
  const docVecs = await embedCached(voyage, corpus.map((e) => `${e.question}\n${e.answer}`), 'document');
  const queryVecs = await embedCached(voyage, set.items.map((i) => i.text), 'query');

  // The same cache as the answerability run: keys hold the refs. A Japanese entry's key also holds a hash
  // of its text (security review, L7), so a corrected or reordered security-qa-ja.csv never reuses an
  // old verdict; English entries keep their keys, so their checks are reused.
  const keyRef = (ref: string) => { const e = corpus.find((x) => x.ref === ref)!; return e.language === 'ja' ? `${ref}#${hashKey(`${e.question}\n${e.answer}`)}` : ref; };
  const cache = diskCache<AnswerabilityResult>('answerability', ...judgeCacheParts(JUDGE_MODEL));
  const rows: LanguageRow[] = [];
  let calls = 0;
  for (const [n, item] of set.items.entries()) {
    const q = queryVecs[n];
    const ranked = rankBy(Object.fromEntries(corpus.map((e, i) => [e.id, cosine(q, docVecs[i])])));
    const at = item.gold ? ranked.indexOf(item.gold) : -1;
    const cands = candidatesFor(corpus, docVecs, q);
    const checked = await cachedCheck(cache, JSON.stringify([item.text, cands.map((e) => keyRef(e.ref))]), () => judge.check(item.text, cands));
    const top = corpus.find((e) => e.ref === cands[0]?.ref);
    const base = { id: item.id, language: item.language, kind: item.kind, pair: pairOf(item, corpus), goldRank: at === -1 ? null : at + 1, topIsGold: Boolean(item.gold) && top?.id === item.gold };
    if (!checked.ok) {
      calls += checked.stopReasons.length;
      rows.push({ ...base, confidence: null, unreadable: true, score: null });
      continue;
    }
    if (checked.fresh) calls += checked.result.attempts ?? 1;
    const r = checked.result;
    // As in the answerability run and the app: the verdict plus the top similarity.
    const score = r.verdict ? { no: 0, partly: 1, yes: 2 }[r.verdict] + Math.max(0, Math.min(1, cands[0]?.similarity ?? 0)) : r.score;
    rows.push({ ...base, confidence: calibratedConfidence(score, METHOD, CALIBRATION_TABLES), score });
    process.stdout.write(`  checked ${n + 1}/${set.items.length}\r`);
  }
  process.stdout.write('\n');

  const date = new Date().toISOString().slice(0, 10);
  const base = reportBase('languages', date);
  const { markdown, met } = languagesReport({
    date, setVersion: set.version, method: METHOD, rows, wilson, ece: expectedCalibrationError,
    notes: [`New checker calls this run: ${calls}.`, ...(env.VOYAGE_API_KEY && env.ANTHROPIC_API_KEY ? [] : ['Rebuilt from the cached vectors and checks of an earlier run, with no keys set, so no call could go out (Sprint 13).']), `Calibration table: ${CALIBRATION_TABLES[METHOD].evaluationSet}.`],
  });
  mkdirSync(join(ROOT, 'docs/evals'), { recursive: true });
  writeFileSync(join(ROOT, `docs/evals/${base}.md`), markdown);
  writeFileSync(join(ROOT, `docs/evals/${base}.json`), JSON.stringify({ date, setVersion: set.version, method: METHOD, met, rows }, null, 1) + '\n');
  console.log(markdown);
  console.log(`Written: docs/evals/${base}.md and .json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
