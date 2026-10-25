/**
 * Records the demo drafts from a real run of the pipeline (Sprint 7, S7-5; Rory, refinement Q4).
 * Run on Rory's PC, with the API keys in supabase/functions/.env:
 *
 *   npm run demo:record
 *
 * Processes every question of the responses in sample-data/demo-plan.json past the "new" stage
 * exactly as the app does (the same code as the Edge Function), writes supabase/demo-recording.json
 * with the date, models and prompt versions, and regenerates the demo section of supabase/seed.sql.
 * A few Claude and Voyage calls (about 26 questions).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JUDGE_PROMPT_VERSION } from '../supabase/functions/_shared/answerability';
import { DRAFT_PROMPT_VERSION } from '../supabase/functions/_shared/drafting';
import { GATE_PROMPT_VERSION } from '../supabase/functions/_shared/gates';
import { checkPlan, type DemoCall, type DemoPlan, type DemoRecording } from './demo-seed';
import type { ClaudeClient } from '../supabase/functions/_shared/claude';
import { ROOT } from './lib';
import { ensureVectors, makeClaude, MODELS, runPipeline, unreadableChecks } from './pipeline';
import { writeSeed } from './run-demo-seed';

async function main() {
  const plan = JSON.parse(readFileSync(join(ROOT, 'sample-data/demo-plan.json'), 'utf8')) as DemoPlan;
  const problems = checkPlan(plan);
  if (problems.length) throw new Error(problems.join('\n'));
  const { client, usage } = makeClaude();
  const recording: DemoRecording = {
    recordedAt: new Date().toISOString(),
    planVersion: plan.version,
    models: { embedding: 'voyage-4', judge: MODELS.judge, gate: MODELS.gate, draft: MODELS.draft },
    promptVersions: { judge: JUDGE_PROMPT_VERSION, gate: GATE_PROMPT_VERSION, draft: DRAFT_PROMPT_VERSION },
    results: {},
    usage: {},
  };
  for (const r of plan.responses.filter((x) => x.stage !== 'new')) {
    const questions = r.questions.map((q) => ({ id: `${r.key}-${q.ref}`, question: q.text }));
    await ensureVectors(questions.map((q) => q.question));
    console.log(`${r.name}: ${questions.length} questions`);
    // Log every call, by job (told apart by the system prompt, as the tests do), as the owner's usage.
    const calls: DemoCall[] = [];
    const logging: ClaudeClient = {
      async json(req) {
        const r = await client.json(req);
        const kind = req.system.startsWith('You classify') ? 'gate' : req.system.startsWith('You check') ? 'judge' : 'draft';
        calls.push({ kind, model: r.model, inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens });
        return r;
      },
    } as ClaudeClient;
    const out = await runPipeline(logging, questions);
    recording.usage![r.key] = calls;
    if (unreadableChecks(out)) console.log(`  ${unreadableChecks(out)} unreadable checks: rerun to record a clean run`);
    recording.results[r.key] = questions.map((q) => out.find((o) => o.id === q.id)!);
  }
  writeFileSync(join(ROOT, 'supabase/demo-recording.json'), JSON.stringify(recording, null, 1) + '\n');
  writeSeed();
  console.log(`Written: supabase/demo-recording.json. Cost: ${usage.calls} Claude calls, ${usage.inputTokens} input and ${usage.outputTokens} output tokens.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
