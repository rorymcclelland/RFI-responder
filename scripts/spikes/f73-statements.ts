// Spike S25-3 (F-73): which statements inside one large send take the time. Local only: needs a
// Postgres with pg_stat_statements preloaded and pg_stat_statements.track = 'all', so statements run
// inside the PL/pgSQL functions are counted. Synthetic data; the send is rolled back.
// Usage: DB_TEST_URL=postgres://... npx tsx scripts/spikes/f73-statements.ts [questions]
import { as, asSuperuser, buildDatabase, closePool, createUser } from '../../supabase/tests/db/harness';

const N = Number(process.argv[2] ?? 3000);

async function main(): Promise<void> {
  await buildDatabase();
  await asSuperuser(`CREATE EXTENSION IF NOT EXISTS pg_stat_statements`);
  const owner = await createUser({ name: 'F-73' });
  await asSuperuser(`INSERT INTO kb_entries (question, answer, tags, source, origin, created_by)
    SELECT 'Standing ' || g || '?', 'Answer ' || g || '.', ARRAY['spike'], 'F-73', 'import', $1 FROM generate_series(1, 300) g`, [owner.id]);
  const r = (await asSuperuser<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ('F-73', $1, $1) RETURNING id`, [owner.id])).rows[0].id;
  const s = (await asSuperuser<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('f.xlsx', 'in_progress', $2, $1) RETURNING id`, [r, N])).rows[0].id;
  await asSuperuser(`WITH refs AS (SELECT array_agg(ref ORDER BY ref) AS a FROM kb_entries)
    INSERT INTO rfi_questions (session_id, position, question, generated_answer, final_answer, confidence, status, language, verdict,
      sources_json, embedding_model, judge_model, draft_model, prompt_version, calibration_set, draft_kind, processed_at, judge_best_ref, cited_refs)
    SELECT $1, g, 'Q ' || g || '?', 'D', 'A ' || g, 0.95, 'accepted', 'en', 'yes',
      jsonb_build_array(jsonb_build_object('id', refs.a[1 + g % 300], 'score', 0.5)), 'voyage-4', 'claude-haiku-5-5', 'claude-haiku-5-5',
      'draft-1', 'set 1', 'generated', now(), refs.a[1 + g % 300], ARRAY[refs.a[1 + g % 300]] FROM generate_series(1, $2) g, refs`, [s, N]);
  await asSuperuser(`ANALYZE`);
  await asSuperuser(`SELECT pg_stat_statements_reset()`);
  const t = performance.now();
  await as(owner, (q) => q(`SELECT record_response_export($1)`, [r]));
  console.log(`send of ${N} questions: ${Math.round(performance.now() - t)} ms`);
  const top = await asSuperuser<{ ms: number; calls: number; query: string }>(
    `SELECT round(total_exec_time)::int AS ms, calls, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query
       FROM pg_stat_statements WHERE query NOT ILIKE '%pg_stat_statements%' ORDER BY total_exec_time DESC LIMIT 14`);
  for (const x of top.rows) console.log(`${x.ms} ms\t${x.calls}\t${x.query}`);
  await closePool();
}

main().catch((err) => { console.error(err); process.exit(1); });
