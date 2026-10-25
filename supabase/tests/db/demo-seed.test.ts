// Sprint 7, S7-5: the demo seed runs through the app's own functions. A stand-in recording (fixed
// rows of the same shape as the pipeline's) is used here; the committed seed uses a real one.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProcessedQuestion } from '../../functions/_shared/process-core';
import { demoSeedSql, replaceSection, type DemoPlan, type DemoRecording } from '../../../eval/demo-seed';
import { asSuperuser, buildDatabase, closePool } from './harness';

const plan = JSON.parse(readFileSync(new URL('../../../sample-data/demo-plan.json', import.meta.url), 'utf8')) as DemoPlan;

const SPECIAL: Record<string, Partial<ProcessedQuestion>> = {
  A5: { verdict: 'partly', confidence: 0.875 },
  A7: { gate: 'pricing', gate_reason: 'Asks for a price.', draft_kind: 'person_required', generated_answer: 'Pricing is answered by a person.', cited_refs: [], draft_model: null },
  A8: { gate: 'legal', gate_reason: 'Asks to accept liability.' },
  A9: { verdict: 'no', confidence: 0.05, draft_kind: 'insufficient_evidence', generated_answer: 'Insufficient evidence.', cited_refs: [], draft_model: null },
  A10: { gate: 'translation', gate_reason: 'Japanese question.', language: 'ja' },
  A11: { verdict: null, confidence: null, draft_kind: 'insufficient_evidence', generated_answer: 'No match.', cited_refs: [], sources_json: [], draft_model: null },
  '3.2': { verdict: 'no', confidence: 0.1, draft_kind: 'insufficient_evidence', generated_answer: 'Insufficient evidence.', cited_refs: [], draft_model: null },
  '3.7': { gate: 'pricing', gate_reason: 'Asks for fees.', draft_kind: 'person_required', generated_answer: 'Pricing is answered by a person.', cited_refs: [], draft_model: null },
};
const row = (key: string, ref: string, text: string): ProcessedQuestion => ({
  id: `${key}-${ref}`, generated_answer: `We address "${text}" as follows. It's documented.`, confidence: 0.95, retrieval_score: 0.6,
  sources_json: [{ id: 'KB-0001', score: 0.6 }], answerability: 2.6, verdict: 'yes', gate: null, gate_reason: null, language: 'en',
  embedding_model: 'voyage-4', judge_model: 'claude-haiku-5-5', judge_best_ref: 'KB-0001', judge_reason: 'KB-0001 answers it.',
  draft_model: 'claude-haiku-5-5', prompt_version: 'draft-test', calibration_set: 'test set', draft_kind: 'generated', cited_refs: ['KB-0001'],
  processing_note: null, processed_at: '2026-10-24T09:00:00.000Z', ...SPECIAL[ref],
});
const recording: DemoRecording = {
  recordedAt: '2026-10-24T09:00:00.000Z', planVersion: plan.version, models: { judge: 'claude-haiku-5-5' }, promptVersions: { judge: 'judge-test' },
  results: Object.fromEntries(plan.responses.filter((r) => r.stage !== 'new').map((r) => [r.key, r.questions.map((q) => row(r.key, q.ref, q.text))])),
  usage: { bluefin: [{ kind: 'judge', model: 'claude-haiku-5-5', inputTokens: 1000, outputTokens: 100 }, { kind: 'draft', model: 'claude-haiku-5-5', inputTokens: 2000, outputTokens: 300 }] },
};

beforeAll(async () => {
  // The seed's users and knowledge base, without its recorded demo, then the stand-in demo.
  await buildDatabase();
  const seed = readFileSync(new URL('../../seed.sql', import.meta.url), 'utf8');
  await asSuperuser(replaceSection(seed, 'DEMO RESPONSES', '-- (replaced by the stand-in demo in this test)'));
  await asSuperuser(demoSeedSql(plan, recording));
});
afterAll(closePool);

const one = async <T extends object>(sql: string) => (await asSuperuser<T>(sql)).rows[0];

describe('S7-5 demo responses, one per stage', () => {
  it('1. creates the four responses at their stages, owned by their owners', async () => {
    const r = await asSuperuser<{ name: string; exported: boolean; outcome: string | null; owner: string }>(
      `SELECT o.name, o.exported_at IS NOT NULL AS exported, o.outcome, u.email AS owner FROM opportunities o JOIN auth.users u ON u.id = o.owner_id ORDER BY o.name`);
    expect(r.rows).toEqual([
      { name: 'Bluefin Freight (fictional): security questionnaire', exported: false, outcome: null, owner: 'priya.sharma@example.com' },
      { name: 'Corvid Analytics (fictional): vendor security questionnaire', exported: false, outcome: null, owner: 'tom.richardson@example.com' },
      { name: 'Harbour Logistics (fictional): RFQ security schedule', exported: true, outcome: 'won', owner: 'maya.patel@example.com' },
      { name: 'Larkspur Health (fictional): data platform RFI', exported: true, outcome: null, owner: 'james.okafor@example.com' },
    ]);
  });

  it('the new response has nothing uploaded yet, so the overview shows it as new', async () => {
    expect(await one(`SELECT stage, total FROM response_overview WHERE name LIKE 'Corvid%'`)).toEqual({ stage: 'new', total: 0 });
  });

  it('the recorded calls are the owners\' usage, priced by the app', async () => {
    const r = await one<{ n: number; who: string; priced: boolean }>(`SELECT count(*)::int AS n, min(u.email) AS who, bool_and(a.cost_usd > 0) AS priced
      FROM ai_usage a JOIN auth.users u ON u.id = a.user_id WHERE a.function = 'process-questions'`);
    expect(r).toEqual({ n: 2, who: 'priya.sharma@example.com', priced: true });
  });

  it('in review: bulk approval accepted only "yes" drafts, as the owner; the rest wait, two are assigned', async () => {
    const st = await asSuperuser<{ customer_ref: string; status: string }>(
      `SELECT q.customer_ref, q.status FROM rfi_questions q JOIN rfi_sessions s ON s.id = q.session_id JOIN opportunities o ON o.id = s.opportunity_id WHERE o.name LIKE 'Bluefin%' ORDER BY q.position`);
    const by = Object.fromEntries(st.rows.map((x) => [x.customer_ref, x.status]));
    expect(by).toMatchObject({ A1: 'accepted', A5: 'pending', A7: 'pending', A8: 'pending', A9: 'pending', A10: 'pending', A11: 'pending' });
    expect(await one(`SELECT count(*)::int AS n, bool_and(a.kind = 'bulk' AND a.threshold = 0.8) AS bulk, bool_and(u.email = 'priya.sharma@example.com') AS owner
      FROM approvals a JOIN auth.users u ON u.id = a.decided_by JOIN opportunities o ON o.id = a.opportunity_id WHERE o.name LIKE 'Bluefin%'`)).toEqual({ n: 6, bulk: true, owner: true });
    expect((await asSuperuser<{ email: string; status: string }>(`SELECT u.email, a.status FROM question_assignments a JOIN auth.users u ON u.id = a.assigned_to JOIN opportunities o ON o.id = a.opportunity_id WHERE o.name LIKE 'Bluefin%' ORDER BY u.email`)).rows)
      .toEqual([{ email: 'james.okafor@example.com', status: 'in_review' }, { email: 'lisa.huang@example.com', status: 'pending' }]);
  });

  it('exported: everything decided, the edit and the person-written answer learned, pricing not answered', async () => {
    const r = await asSuperuser<{ customer_ref: string; status: string; learn_outcome: string | null }>(
      `SELECT q.customer_ref, q.status, q.learn_outcome FROM rfi_questions q JOIN rfi_sessions s ON s.id = q.session_id JOIN opportunities o ON o.id = s.opportunity_id WHERE o.name LIKE 'Larkspur%' ORDER BY q.position`);
    const by = Object.fromEntries(r.rows.map((x) => [x.customer_ref, x]));
    expect(r.rows.every((x) => x.status !== 'pending')).toBe(true);
    expect(by['3.7'].status).toBe('skipped');
    expect(by['3.2']).toMatchObject({ status: 'accepted', learn_outcome: 'added' });
    // James is not an admin, so his edit of an answer that already has an entry waits for review (Sprint 4).
    expect(['added', 'proposed']).toContain(by['3.4'].learn_outcome);
    expect(await one(`SELECT count(*)::int AS n FROM kb_entries WHERE origin = 'response'`)).toEqual({ n: expect.any(Number) });
  });

  it('archived as won, after its export', async () => {
    expect(await one(`SELECT outcome, archived_at IS NOT NULL AS archived, exported_at IS NOT NULL AS exported FROM opportunities WHERE name LIKE 'Harbour%'`))
      .toEqual({ outcome: 'won', archived: true, exported: true });
  });

  it('can be loaded again without duplicating anything', async () => {
    await asSuperuser(demoSeedSql(plan, recording));
    expect(await one(`SELECT count(*)::int AS n FROM opportunities`)).toEqual({ n: 4 });
  });
});
