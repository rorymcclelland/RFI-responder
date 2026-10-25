/**
 * Demo data for a fresh install (Sprint 7, S7-5). Two generated sections of supabase/seed.sql:
 *
 * - the knowledge base: the 100 synthetic entries in sample-data/security-qa.csv, in file order, so
 *   their refs (KB-0001 to KB-0100) match the evaluations and the recorded drafts;
 * - the demo responses: sample-data/demo-plan.json, with the processed questions taken from a
 *   recording of the real pipeline (supabase/demo-recording.json, made by `npm run demo:record`).
 *
 * The workflow after processing (bulk approval, edits, individual decisions, recording the export,
 * archiving) runs through the database's own functions as each fictional owner, so approvals,
 * learning and the audit log are what the app itself would have written.
 *
 *   npm run demo:seed     regenerate both sections from the CSV and the existing recording (no API)
 */
import type { ProcessedQuestion } from '../supabase/functions/_shared/process-core';

export interface DemoQuestion { ref: string; text: string }
export interface DemoResponse {
  key: string; name: string; owner: string; dueDays: number; file: string;
  stage: 'new' | 'in_review' | 'exported' | 'archived';
  outcome?: 'won' | 'lost' | 'withdrawn';
  bulkAt?: number;
  assign?: { ref: string; to: string; status: 'pending' | 'in_review' | 'answered' }[];
  personAnswers?: Record<string, string>;
  edits?: Record<string, string>;
  questions: DemoQuestion[];
}
export interface DemoPlan { version: string; note: string; responses: DemoResponse[] }
export interface DemoRecording {
  recordedAt: string;
  planVersion: string;
  models: Record<string, string>;
  promptVersions: Record<string, string>;
  /** Processed rows by response key, in the plan's question order. */
  results: Record<string, ProcessedQuestion[]>;
  /** Every Claude call made while processing each response, entered as the owner's usage. */
  usage?: Record<string, DemoCall[]>;
}
export interface DemoCall { kind: 'judge' | 'gate' | 'draft'; model: string; inputTokens: number; outputTokens: number }
export interface KbRow { question: string; answer: string; tags: string[]; source: string }

const SAFE_REF = /^[\p{L}\p{N}.()\- ]{1,20}$/u;

/** Refuses anything that would make the demo less than plainly fictional and well formed. */
export function checkPlan(plan: DemoPlan): string[] {
  const problems: string[] = [];
  for (const r of plan.responses) {
    if (!/\(fictional\)/.test(r.name)) problems.push(`${r.key}: the name must say (fictional)`);
    for (const email of [r.owner, ...(r.assign ?? []).map((a) => a.to)]) {
      if (!email.endsWith('@example.com')) problems.push(`${r.key}: ${email} is not an example.com address`);
    }
    const refs = new Set(r.questions.map((q) => q.ref));
    if (refs.size !== r.questions.length) problems.push(`${r.key}: question refs repeat`);
    for (const q of r.questions) if (!SAFE_REF.test(q.ref)) problems.push(`${r.key}: ref ${q.ref} has characters a customer number cannot`);
    for (const ref of [...(r.assign ?? []).map((a) => a.ref), ...Object.keys(r.personAnswers ?? {}), ...Object.keys(r.edits ?? {})]) {
      if (!refs.has(ref)) problems.push(`${r.key}: ${ref} is not one of its questions`);
    }
    if (r.stage === 'archived' && !r.outcome) problems.push(`${r.key}: an archived response needs an outcome`);
  }
  return problems;
}

/** A SQL string literal (standard_conforming_strings is on in Postgres 16, so only quotes need doubling). */
export const lit = (s: string | null | undefined): string => (s === null || s === undefined ? 'NULL' : `'${s.replace(/'/g, "''")}'`);
const num = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? 'NULL' : String(n));
const arr = (xs: string[]) => `ARRAY[${xs.map(lit).join(', ')}]::text[]`;

export function kbSeedSql(rows: KbRow[]): string {
  const values = rows.map((r, i) => `      (${i + 1}, ${lit(r.question)}, ${lit(r.answer)}, ${arr(r.tags)}, ${lit(r.source)})`).join(',\n');
  return `-- The knowledge base: the ${rows.length} synthetic entries in sample-data/security-qa.csv, in file order,
-- so their refs (KB-0001 onwards) match the evaluations and the recorded demo drafts. Added and
-- reviewed by the admin. Skipped if the knowledge base already has entries.
DO $kb$
DECLARE admin uuid := (SELECT id FROM auth.users WHERE email = 'sarah.chen@example.com');
BEGIN
  IF EXISTS (SELECT 1 FROM public.kb_entries) THEN RETURN; END IF;
  INSERT INTO public.kb_entries (question, answer, tags, source, origin, origin_ref, created_by)
  SELECT v.q, v.a, v.t, v.s, 'seed', 'sample-data/security-qa.csv', admin
    FROM (VALUES
${values}
    ) AS v(ord, q, a, t, s)
   ORDER BY v.ord;
END $kb$;`;
}

const QUESTION_COLUMNS = [
  'session_id', 'position', 'question', 'customer_ref', 'generated_answer', 'confidence', 'retrieval_score', 'sources_json',
  'answerability', 'verdict', 'gate', 'gate_reason', 'language', 'embedding_model', 'judge_model', 'judge_best_ref',
  'judge_reason', 'draft_model', 'prompt_version', 'calibration_set', 'draft_kind', 'cited_refs', 'processing_note', 'processed_at',
];

function questionValues(pos: number, q: DemoQuestion, p: ProcessedQuestion | null): string {
  if (!p) return `(sess, ${pos}, ${lit(q.text)}, ${lit(q.ref)}${', NULL'.repeat(QUESTION_COLUMNS.length - 4)})`;
  return `(sess, ${pos}, ${lit(q.text)}, ${lit(q.ref)}, ${lit(p.generated_answer)}, ${num(p.confidence)}, ${num(p.retrieval_score)}, ${lit(JSON.stringify(p.sources_json))}::jsonb, ` +
    `${num(p.answerability)}, ${lit(p.verdict)}, ${lit(p.gate)}, ${lit(p.gate_reason)}, ${lit(p.language)}, ${lit(p.embedding_model)}, ${lit(p.judge_model)}, ` +
    `${lit(p.judge_best_ref)}, ${lit(p.judge_reason)}, ${lit(p.draft_model)}, ${lit(p.prompt_version)}, ${lit(p.calibration_set)}, ${lit(p.draft_kind)}, ` +
    `${arr(p.cited_refs)}, ${lit(p.processing_note)}, ${lit(p.processed_at)}::timestamptz)`;
}

const actAs = (who: string) =>
  `  PERFORM set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);`;

function responseSql(r: DemoResponse, results: ProcessedQuestion[] | undefined, calls: DemoCall[] = [], at = ''): string {
  const processed = r.stage !== 'new';
  if (processed && (!results || results.length !== r.questions.length)) {
    throw new Error(`${r.key}: the recording has ${results?.length ?? 0} results for ${r.questions.length} questions; run npm run demo:record`);
  }
  const rows = r.questions.map((q, i) => questionValues(i, q, processed ? results![i] : null)).join(',\n    ');
  // The recorded Claude calls, as the owner's usage of process-questions; the app's trigger prices them.
  const usage = calls.length
    ? `  INSERT INTO public.ai_usage (user_id, function, kind, provider, model, input_tokens, output_tokens, session_id, at) VALUES
    ${calls.map((c) => `(owner, 'process-questions', ${lit(c.kind)}, 'anthropic', ${lit(c.model)}, ${num(c.inputTokens)}, ${num(c.outputTokens)}, sess, ${lit(at)}::timestamptz)`).join(',\n    ')};`
    : '';
  const by = (ref: string) => `(SELECT id FROM public.rfi_questions WHERE session_id = sess AND customer_ref = ${lit(ref)})`;
  const steps: string[] = [];
  // Decisions made one at a time as the owner, as a person would in the app.
  const decide = (ref: string, answer: string) => [
    `  UPDATE public.rfi_questions SET final_answer = ${lit(answer)} WHERE id = ${by(ref)};`,
    `  UPDATE public.rfi_questions SET status = 'accepted' WHERE id = ${by(ref)};`,
  ].join('\n');
  if (processed) {
    for (const [ref, text] of Object.entries({ ...(r.edits ?? {}), ...(r.personAnswers ?? {}) })) steps.push(decide(ref, text));
    if (r.bulkAt !== undefined) steps.push(`  PERFORM public.bulk_accept(sess, ${r.bulkAt});`);
    for (const a of r.assign ?? []) {
      steps.push(`  INSERT INTO public.question_assignments (question_id, session_id, opportunity_id, assigned_to, assigned_by, question_text, status)
  SELECT q.id::text, sess, opp, (SELECT id FROM auth.users WHERE email = ${lit(a.to)}), owner, q.question, ${lit(a.status)}
    FROM public.rfi_questions q WHERE q.id = ${by(a.ref)};`);
    }
  }
  if (r.stage === 'exported' || r.stage === 'archived') {
    steps.push(`  -- Everything else decided individually: drafts accepted as written, the rest marked not answered.
  FOR qid, kind IN SELECT q.id, q.draft_kind FROM public.rfi_questions q WHERE q.session_id = sess AND q.status = 'pending' ORDER BY q.position LOOP
    UPDATE public.rfi_questions SET status = CASE WHEN kind IN ('generated', 'assembled') THEN 'accepted' ELSE 'skipped' END WHERE id = qid;
  END LOOP;
  PERFORM public.record_export(sess);`);
  }
  if (r.stage === 'archived') steps.push(`  PERFORM public.archive_response(opp, ${lit(r.outcome ?? 'won')});`);
  return `-- ${r.name}: stage "${r.stage}".
DO $demo$
DECLARE
  owner uuid := (SELECT id FROM auth.users WHERE email = ${lit(r.owner)});
  opp   uuid;
  sess  uuid;
  qid   uuid;
  kind  text;
BEGIN
  IF owner IS NULL OR EXISTS (SELECT 1 FROM public.opportunities WHERE name = ${lit(r.name)}) THEN RETURN; END IF;
${actAs('owner')}
  INSERT INTO public.opportunities (name, due_date, created_by, owner_id)
  VALUES (${lit(r.name)}, current_date + ${r.dueDays}, owner, owner) RETURNING id INTO opp;
${processed ? `  INSERT INTO public.rfi_sessions (file_name, question_count, opportunity_id)
  VALUES (${lit(r.file)}, ${r.questions.length}, opp) RETURNING id INTO sess;
  INSERT INTO public.rfi_questions (${QUESTION_COLUMNS.join(', ')}) VALUES
    ${rows};
${usage}` : '  -- New: created, nothing uploaded yet.'}
${steps.join('\n')}
  PERFORM set_config('request.jwt.claims', '', true);
END $demo$;`;
}

export function demoSeedSql(plan: DemoPlan, recording: DemoRecording | null): string {
  const problems = checkPlan(plan);
  if (problems.length) throw new Error(`The demo plan is not usable:\n- ${problems.join('\n- ')}`);
  const provenance = recording
    ? `-- Drafts, verdicts and confidences recorded from a real run of the pipeline on ${recording.recordedAt.slice(0, 10)}
-- (plan ${recording.planVersion}; models ${Object.entries(recording.models).map(([k, v]) => `${k} ${v}`).join(', ')};
-- prompts ${Object.values(recording.promptVersions).join(', ')}). Not edited by hand.`
    : '-- No recording yet: only responses at the "new" stage are seeded.';
  const responses = plan.responses.filter((r) => recording || r.stage === 'new');
  return `-- Demo responses, one per stage (sample-data/demo-plan.json ${plan.version}). Every company,
-- person and question is fictional.
${provenance}
${responses.map((r) => responseSql(r, recording?.results[r.key], recording?.usage?.[r.key], recording?.recordedAt)).join('\n\n')}`;
}

/** Replace the text between `-- BEGIN <name>` and `-- END <name>`, keeping the markers. */
export function replaceSection(file: string, name: string, body: string): string {
  const begin = `-- BEGIN ${name} (generated by npm run demo:seed; do not edit by hand)`;
  const end = `-- END ${name}`;
  const i = file.indexOf(begin);
  const j = file.indexOf(end);
  if (i < 0 || j < i) throw new Error(`seed.sql has no "${name}" section`);
  return `${file.slice(0, i + begin.length)}\n${body}\n${file.slice(j)}`;
}
