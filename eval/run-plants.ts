/**
 * Does the faithfulness judge catch a draft that says something its sources do not? (Sprint 9, S9-3,
 * F-19; bar agreed with Rory: at least 90% of planted claims caught, with the 95% interval.)
 * Run on Rory's PC, with the API key in supabase/functions/.env:
 *
 *   npm run eval:plants
 *
 * Takes the faithful English drafts from the newest drafting run, plants one unsupported claim in each
 * by fixed rules (eval/plants.ts), and asks the same judge, with the same prompt, as eval:drafting.
 * The unchanged drafts are judged again too, in this run's own cache (security review, Sprint 9: the
 * drafting run's verdicts were what selected them, so reusing them would make false alarms 0 by
 * construction). Writes docs/evals/faithfulness-plants-<date>.md and .json.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { citedRefs, FAITH_SCHEMA, FAITH_SYSTEM, FAITHFULNESS_JUDGE } from './faithfulness';
import { formatInterval, wilson } from './intervals';
import { diskCache, loadKb, newestReport, reportBase, ROOT, withRetry } from './lib';
import { makeClaude } from './pipeline';
import { caught, plantSet, PLANT_RULES } from './plants';

const BAR = 0.9;
type Claims = { claims: { claim: string; supported: boolean }[] };

async function main() {
  const source = newestReport('drafting', readdirSync(join(ROOT, 'docs/evals')))!;
  const results = JSON.parse(readFileSync(join(ROOT, 'docs/evals', source), 'utf8')) as { id: string; draft_kind: string; generated_answer: string; claims?: { supported: boolean }[] }[];
  const kb = new Map(loadKb().map((e) => [e.ref, e]));
  // Faithful drafts only: every claim supported in the drafting run, so a planted claim is the only unsupported one.
  const drafts = results
    .filter((r) => r.draft_kind === 'generated' && (r.claims ?? []).length > 0 && r.claims!.every((c) => c.supported))
    .map((r) => {
      const entries = citedRefs(r as never).map((ref) => kb.get(ref)).filter((e): e is NonNullable<typeof e> => !!e);
      return { id: r.id, text: r.generated_answer, entries, sources: entries.map((e) => `${e.question} ${e.answer}`) };
    });
  const items = plantSet(drafts);
  const entriesOf = new Map(drafts.map((d) => [d.id, d.entries]));
  const controlCount = items.filter((i) => i.rule === 'control').length;
  console.log(`${controlCount} faithful English drafts from ${source}: ${items.length} to judge (${items.length - controlCount} planted, ${controlCount} controls)`);

  const { client, usage } = makeClaude();
  // Its own cache: a fresh verdict on every item, controls included.
  const cache = diskCache<Claims>('faithfulness-plants', FAITHFULNESS_JUDGE);
  const judged = [];
  let done = 0;
  for (const item of items) {
    const entries = entriesOf.get(item.id)!;
    const key = JSON.stringify([item.text, entries.map((e) => e.ref)]);
    let v = cache.get(key);
    if (!v) {
      const out = await withRetry(FAITHFULNESS_JUDGE, () => client.json<Claims>({
        model: FAITHFULNESS_JUDGE, system: FAITH_SYSTEM, schema: FAITH_SCHEMA, maxTokens: 1500,
        user: JSON.stringify({ draft: item.text, entries: entries.map((e) => ({ ref: e.ref, question: e.question, answer: e.answer })) }),
      }));
      // An empty or unreadable reply is counted as unreadable and not cached, so a rerun can recover it.
      if (out.data && out.data.claims.length > 0) { v = out.data; cache.set(key, v); }
    }
    judged.push({ ...item, unreadable: !v, claims: v?.claims ?? [], caught: v && item.marker ? caught(v.claims, item.marker) : null, alarms: v ? v.claims.filter((c) => !c.supported).length : null });
    process.stdout.write(`  ${++done}/${items.length}\r`);
  }
  process.stdout.write('\n');

  const unreadable = judged.filter((j) => j.unreadable).length;
  const planted = judged.filter((j) => j.rule !== 'control' && !j.unreadable);
  const controls = judged.filter((j) => j.rule === 'control' && !j.unreadable);
  const k = planted.filter((p) => p.caught).length;
  const falseAlarms = controls.filter((c) => (c.alarms ?? 0) > 0).length;
  // Security review, Sprint 9: the plants are four rules, two of them the same appended sentence in
  // every draft, so each rule gets its own rate and interval, and the bar applies to each as well as overall.
  const perRule = PLANT_RULES.map((r) => {
    const p = planted.filter((x) => x.rule === r.name);
    const c = p.filter((x) => x.caught).length;
    return { name: r.name, n: p.length, c, interval: p.length ? formatInterval(wilson(c, p.length), 'percent') : 'n/a', met: p.length > 0 && c / p.length >= BAR };
  });
  const overallMet = planted.length > 0 && k / planted.length >= BAR;
  const allRulesMet = perRule.filter((r) => r.n > 0).every((r) => r.met);
  const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
  const date = new Date().toISOString().slice(0, 10);
  const base = reportBase('faithfulness-plants', date);
  const lines = [
    `# Faithfulness judge on planted claims, ${date}`,
    '',
    `The faithful English drafts of \`${source}\` (${controls.length + (judged.filter((j) => j.rule === 'control' && j.unreadable).length)}; every claim supported in that run), each with one unsupported claim planted by a fixed rule (\`eval/plants.ts\`), judged by ${FAITHFULNESS_JUDGE} with the drafting evaluation's prompt. A plant is caught when the judge marks a claim holding the planted word or number as unsupported. The unchanged drafts are judged again in the same run, as controls. Generated by \`npm run eval:plants\`. Bar (Sprint 9): at least ${BAR * 100}% caught, overall and for each rule.`,
    '',
    `**Read with care.** The plants are written by rules, so they may be easier to spot than a model's own mistakes; ${perRule.filter((r) => r.name === 'added certification' || r.name === 'absolute claim').reduce((a, r) => a + r.n, 0)} of the ${planted.length} are one of two fixed sentences added to every draft, so the per-rule rows matter more than the total. The drafts and sources are synthetic.`,
    '',
    '| Measure | Result | 95% interval | Bar | Met |',
    '|---|---|---|---|---|',
    `| Planted claims caught | ${k} of ${planted.length} (${pct(k, planted.length)}) | ${formatInterval(wilson(k, planted.length), 'percent')} | at least ${BAR * 100}%, and for each rule | ${overallMet && allRulesMet ? 'yes' : 'no'} |`,
    `| Unchanged drafts with a claim marked unsupported (false alarms) | ${falseAlarms} of ${controls.length} | ${formatInterval(wilson(falseAlarms, controls.length), 'percent')} | reported | |`,
    `| Unreadable judge replies (left out above; not cached) | ${unreadable} of ${judged.length} | | none | ${unreadable === 0 ? 'yes' : 'no'} |`,
    '',
    'Intervals: Wilson. The overall interval treats plants as independent; plants of the same rule share their wording, so read it with the rows below.',
    '',
    '## By rule',
    '',
    '| Rule | Planted | Caught | 95% interval | At least 90% |',
    '|---|---|---|---|---|',
    ...perRule.map((r) => `| ${r.name} | ${r.n} | ${r.c} | ${r.interval} | ${r.n ? (r.met ? 'yes' : 'no') : 'n/a'} |`),
    '',
    '## Missed',
    '',
    ...(planted.filter((p) => !p.caught).map((p) => `- ${p.id}, ${p.rule} ("${p.marker}")`) || []),
    ...(planted.every((p) => p.caught) ? ['None.'] : []),
    '',
    `Cost of this run: ${usage.calls} Claude calls, ${usage.inputTokens} input and ${usage.outputTokens} output tokens (cached results excluded).`,
    '',
  ];
  writeFileSync(join(ROOT, `docs/evals/${base}.md`), lines.join('\n'));
  writeFileSync(join(ROOT, `docs/evals/${base}.json`), JSON.stringify({ date, source, judge: FAITHFULNESS_JUDGE, results: judged }, null, 1) + '\n');
  console.log(lines.join('\n'));
  console.log(`Written: docs/evals/${base}.md and .json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
