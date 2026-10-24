/**
 * Regenerates the knowledge-base and demo sections of supabase/seed.sql (Sprint 7, S7-5), from
 * sample-data/security-qa.csv, sample-data/demo-plan.json and supabase/demo-recording.json if it
 * exists. No API calls.
 *
 *   npm run demo:seed
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoSeedSql, kbSeedSql, replaceSection, type DemoPlan, type DemoRecording } from './demo-seed';
import { loadKb, ROOT } from './lib';

export function writeSeed(): void {
  const plan = JSON.parse(readFileSync(join(ROOT, 'sample-data/demo-plan.json'), 'utf8')) as DemoPlan;
  const recPath = join(ROOT, 'supabase/demo-recording.json');
  const recording = existsSync(recPath) ? (JSON.parse(readFileSync(recPath, 'utf8')) as DemoRecording) : null;
  const seedPath = join(ROOT, 'supabase/seed.sql');
  let seed = readFileSync(seedPath, 'utf8');
  seed = replaceSection(seed, 'KNOWLEDGE BASE', kbSeedSql(loadKb().map((e) => ({ question: e.question, answer: e.answer, tags: e.tags, source: e.source ?? '' }))));
  seed = replaceSection(seed, 'DEMO RESPONSES', demoSeedSql(plan, recording));
  writeFileSync(seedPath, seed);
  console.log(`Written: supabase/seed.sql (${recording ? `demo recorded ${recording.recordedAt.slice(0, 10)}` : 'no recording yet: only the new response'})`);
}

if (process.argv[1]?.endsWith('run-demo-seed.ts')) writeSeed();
