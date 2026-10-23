/**
 * Answerability comparison for Sprint 2 (story S2-1). Run on Rory's PC after
 * `npm run eval:retrieval` (it reuses that run's cached vectors):
 *
 *   npm run eval:answerability
 *   npm run eval:answerability -- --only=claude-haiku-5-5      (one candidate)
 *
 * For every item in the retrieval set, takes the entries the app would draft from (by voyage-4
 * and by qwen3-embedding:0.6b vectors), asks each answerability candidate whether they answer the
 * question, and writes docs/evals/answerability-<date>.json in the same row shape as the
 * retrieval report, so `npm run eval:calibrate` can fit and check each combination.
 * Results are cached in eval/.cache/answerability/, so reruns cost nothing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeJudge,
  voyageRerankChecker,
  type AnswerabilityChecker,
  type AnswerabilityResult,
} from '../supabase/functions/_shared/answerability';
import { claudeClient } from '../supabase/functions/_shared/claude';
import { auroc } from './metrics';
import { candidatesFor, vectorsFor } from './judge-inputs';
import { cachedCheck, diskCache, env, hashKey, judgeCacheParts, loadKb, ROOT, stopReasonCounts } from './lib';

interface Item { id: string; text: string; language: string; kind: string; gold: string; split: string }

const JUDGE_MODEL = 'claude-haiku-5-5';
const EMBEDDINGS = [
  { label: 'voyage-4', dir: 'voyage/voyage-4' },
  { label: 'qwen3-embedding:0.6b', dir: 'ollama/qwen3-embedding_0.6b' },
];
const UNANSWERABLE = new Set(['unanswerable', 'near-miss']);

const kb = loadKb();
const set = JSON.parse(readFileSync(join(ROOT, 'eval/retrieval-set.json'), 'utf8')) as { version: string; items: Item[] };

function checkers(): { list: AnswerabilityChecker[]; skipped: string[] } {
  const list: AnswerabilityChecker[] = [];
  const skipped: string[] = [];
  const patient = { attempts: 10, baseDelayMs: 20_000 };
  if (env.VOYAGE_API_KEY) {
    list.push(voyageRerankChecker({ apiKey: env.VOYAGE_API_KEY, model: 'rerank-2.5', retry: patient }));
    list.push(voyageRerankChecker({ apiKey: env.VOYAGE_API_KEY, model: 'rerank-3', retry: patient }));
  } else skipped.push('Voyage rerankers: VOYAGE_API_KEY not set in supabase/functions/.env');
  if (env.ANTHROPIC_API_KEY) {
    list.push(claudeJudge({ client: claudeClient({ apiKey: env.ANTHROPIC_API_KEY, retry: patient }), model: JUDGE_MODEL }));
  } else skipped.push('Claude judge: ANTHROPIC_API_KEY not set in supabase/functions/.env');
  // Optional: --only=claude-haiku-5-5,rerank-2.5 runs a subset (Voyage accounts without a payment
  // method get a few requests a minute, so the rerankers can take hours).
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  if (only) {
    for (const c of list.filter((c) => !only.includes(c.model))) skipped.push(`${c.model}: not selected (--only)`);
    return { list: list.filter((c) => only.includes(c.model)), skipped };
  }
  return { list, skipped };
}

async function main() {
  const { list, skipped } = checkers();
  const results: Record<string, unknown>[] = [];
  const costs: Record<string, { calls: number; seconds: number }> = {};
  const unreadable: Record<string, string[][]> = {};

  for (const emb of EMBEDDINGS) {
    const vecs = vectorsFor(emb.dir);
    if (typeof vecs === 'string') {
      skipped.push(`${emb.label}: ${vecs}`);
      continue;
    }
    const docVecs = kb.map((e) => vecs.doc[hashKey(`${e.question}\n${e.answer}`)]);
    for (const c of list) {
      const method = `${emb.label} + ${c.model}`;
      // Sprint 6: the judge's cache follows its prompt version and reply limit.
      const cache = diskCache<AnswerabilityResult>('answerability', ...(c.name === 'claude-judge' ? judgeCacheParts(c.model) : [c.model]));
      const started = Date.now();
      let calls = 0;
      for (const [n, item] of set.items.entries()) {
        const q = vecs.query[hashKey(item.text)];
        if (!q) continue;
        const cands = candidatesFor(kb, docVecs, q);
        const key = JSON.stringify([item.text, cands.map((e) => e.ref)]);
        const checked = await cachedCheck(cache, key, () => c.check(item.text, cands), { attempts: 4, waitMs: 5000 });
        if (checked.ok && checked.fresh) calls++;
        if (!checked.ok) {
          // An unreadable check leaves the question uncalibrated in the app: kept out of the fit, counted.
          calls++;
          (unreadable[method] ??= []).push(checked.stopReasons);
          results.push({ id: item.id, language: item.language, kind: item.kind, split: item.split, gold: item.gold, method, topScore: null, topIsGold: false, verdict: null, similarity: cands[0]?.similarity ?? 0, unreadable: true });
          continue;
        }
        const r = checked.result;
        // Judge scores include similarity, which depends on the embedding model: recompute from the verdict.
        const score = r.verdict ? { no: 0, partly: 1, yes: 2 }[r.verdict] + Math.max(0, Math.min(1, cands[0]?.similarity ?? 0)) : r.score;
        results.push({
          id: item.id, language: item.language, kind: item.kind, split: item.split, gold: item.gold, method,
          topScore: score, topIsGold: Boolean(item.gold) && kb.find((e) => e.ref === cands[0]?.ref)?.question === item.gold,
          verdict: r.verdict ?? null, similarity: cands[0]?.similarity ?? 0,
        });
        process.stdout.write(`  ${method}: ${n + 1}/${set.items.length}\r`);
      }
      process.stdout.write('\n');
      costs[c.model] = { calls: (costs[c.model]?.calls ?? 0) + calls, seconds: (costs[c.model]?.seconds ?? 0) + Math.round((Date.now() - started) / 1000) };
    }
  }

  const methods = [...new Set(results.map((r) => r.method as string))];
  const date = new Date().toISOString().slice(0, 10);
  const lines = [
    `# Answerability comparison, ${date}`,
    '',
    `Evaluation set ${set.version} (synthetic, unreviewed; Japanese machine-translated). Each candidate sees the entries the app would draft from. Generated by \`npm run eval:answerability\`; calibration and the agreed bars are in the calibration report.`,
    '',
    '| Embedding + checker | AUROC, near misses | AUROC, all unanswerable | AUROC, near misses (ja) |',
    '|---|---|---|---|',
  ];
  for (const m of methods) {
    const rows = results.filter((r) => r.method === m && !r.unreadable) as { kind: string; language: string; topScore: number }[];
    const ans = rows.filter((r) => !UNANSWERABLE.has(r.kind));
    const near = rows.filter((r) => r.kind === 'near-miss');
    const all = rows.filter((r) => UNANSWERABLE.has(r.kind));
    const nearJa = near.filter((r) => r.language === 'ja');
    const ansJa = ans.filter((r) => r.language === 'ja');
    lines.push(`| ${m} | ${auroc(ans.map((r) => r.topScore), near.map((r) => r.topScore)).toFixed(3)} | ${auroc(ans.map((r) => r.topScore), all.map((r) => r.topScore)).toFixed(3)} | ${nearJa.length ? auroc(ansJa.map((r) => r.topScore), nearJa.map((r) => r.topScore)).toFixed(3) : 'n/a'} |`);
  }
  lines.push('', 'For comparison, similarity alone (Sprint 1): near-miss AUROC 0.892 for voyage-4, 0.879 for qwen3-embedding:0.6b.', '');
  // Sprint 6: unreadable checks (after the judge's one retry) are left out of the AUROC and counted here.
  lines.push('| Embedding + checker | Unreadable checks after one retry | Stop reasons |', '|---|---|---|');
  for (const m of methods) lines.push(`| ${m} | ${unreadable[m]?.length ?? 0} of ${results.filter((r) => r.method === m).length} | ${stopReasonCounts(unreadable[m] ?? [])} |`);
  lines.push('');
  lines.push(`New API calls this run: ${Object.entries(costs).map(([k, v]) => `${k} ${v.calls} (${v.seconds}s)`).join(', ') || 'none (all cached)'}.`, '');
  if (skipped.length) lines.push('**Skipped:**', '', ...skipped.map((s) => `- ${s}`), '');

  mkdirSync(join(ROOT, 'docs/evals'), { recursive: true });
  writeFileSync(join(ROOT, `docs/evals/answerability-${date}.md`), lines.join('\n'));
  writeFileSync(join(ROOT, `docs/evals/answerability-${date}.json`), JSON.stringify({ date, setVersion: set.version, skipped, results }, null, 1));
  console.log(lines.join('\n'));
  console.log(`Written: docs/evals/answerability-${date}.md and .json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
