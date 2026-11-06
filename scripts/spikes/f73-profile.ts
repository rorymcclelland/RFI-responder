// Spike S25-3 (F-73): how long marking a large response as sent, and bulk-approving it, takes, and
// what grows. Local only: builds the throwaway test database (supabase/tests/db/harness.ts), loads
// synthetic responses, and times the whole-response functions as their owner in transactions that are
// rolled back. Usage: DB_TEST_URL=postgres://... npx tsx scripts/spikes/f73-profile.ts [sizes]
// where sizes is like "1x500,4x500,2x2000" (files x questions). Synthetic data only; no AI.
import { as, asSuperuser, buildDatabase, closePool, createUser, getPool, type TestUser } from '../../supabase/tests/db/harness';

const KB = Number(process.env.F73_KB ?? 300);

const PATCH = `
  CREATE OR REPLACE FUNCTION public.refresh_accepted_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
  BEGIN
    -- Recount only the files whose number of approved questions this statement changed: counted per
    -- file in the old and new rows separately (no join, so one pass over each), and still recounted
    -- exactly from the table, as before.
    UPDATE public.rfi_sessions s
       SET accepted_count = (SELECT count(*) FROM public.rfi_questions q WHERE q.session_id = s.id AND q.status = 'accepted')
     WHERE s.id IN (SELECT d.session_id FROM (
             SELECT n.session_id, count(*) FILTER (WHERE n.status = 'accepted') AS c FROM new_rows n GROUP BY 1
             UNION ALL
             SELECT o.session_id, -count(*) FILTER (WHERE o.status = 'accepted') FROM old_rows o GROUP BY 1) d
           GROUP BY d.session_id HAVING sum(d.c) <> 0);
    RETURN NULL;
  END $f$;
  DROP TRIGGER rfi_questions_accepted_count ON public.rfi_questions;
  CREATE TRIGGER rfi_questions_accepted_count AFTER UPDATE ON public.rfi_questions
    REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_accepted_count();
  DO $p$ DECLARE src text; BEGIN
    SELECT pg_get_functiondef('public.record_export(uuid)'::regprocedure) INTO src;
    src := replace(src, 'WHERE k.ref IN (SELECT jsonb_array_elements(coalesce(q.sources_json, ''[]''::jsonb))->>''id'')',
                        'WHERE k.ref = ANY (ARRAY(SELECT jsonb_array_elements(coalesce(q.sources_json, ''[]''::jsonb))->>''id''))');
    EXECUTE src;
  END $p$;`;

async function loadKnowledgeBase(owner: TestUser): Promise<void> {
  await asSuperuser(
    `INSERT INTO kb_entries (question, answer, tags, source, origin, created_by)
     SELECT 'Synthetic standing question ' || g || '?', 'Synthetic standing answer ' || g || '.', ARRAY['spike'], 'F-73 spike', 'import', $1
       FROM generate_series(1, $2) g`, [owner.id, KB]);
  // Reviewed, so bulk approval is not held back by an unreviewed source.
  await asSuperuser(`UPDATE kb_entries SET reviewed_at = now()`);
}

/** A response of `files` files with `per` questions each, every question decided or ready to approve. */
async function loadResponse(owner: TestUser, label: string, files: number, per: number, status: 'accepted' | 'pending'): Promise<string> {
  const r = (await asSuperuser<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ($1, $2, $2) RETURNING id`, [`F-73 ${label}`, owner.id])).rows[0].id;
  for (let f = 0; f < files; f++) {
    const s = (await asSuperuser<{ id: string }>(
      `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ($1, 'in_progress', $2, $3) RETURNING id`,
      [`f73-${label}-${f}.xlsx`, per, r])).rows[0].id;
    // Each question cites one standing entry, like a drafted answer; texts are distinct, so each learns.
    await asSuperuser(
      `WITH refs AS (SELECT array_agg(ref ORDER BY ref) AS a FROM kb_entries WHERE origin = 'import')
       INSERT INTO rfi_questions (session_id, position, question, generated_answer, final_answer, confidence, status, language,
         verdict, sources_json, embedding_model, judge_model, draft_model, prompt_version, calibration_set, draft_kind,
         processed_at, judge_best_ref, cited_refs)
       SELECT $1, g, 'Spike ' || $2 || ' file ' || $3 || ' question ' || g || '?', 'Drafted answer ' || g || '.',
              CASE WHEN $4 = 'accepted' THEN 'Approved answer ' || g || '.' END, 0.95, $4, 'en', 'yes',
              jsonb_build_array(jsonb_build_object('id', refs.a[1 + g % array_length(refs.a, 1)], 'score', 0.5)),
              'voyage-4', 'claude-haiku-5-5', 'claude-haiku-5-5', 'draft-1', 'set 1', 'generated', now(),
              refs.a[1 + g % array_length(refs.a, 1)], ARRAY[refs.a[1 + g % array_length(refs.a, 1)]]
         FROM generate_series(1, $5) g, refs`, [s, label, f, status, per]);
  }
  await asSuperuser(`ANALYZE`);
  return r;
}

async function timed(owner: TestUser, sql: string, params: unknown[]): Promise<{ ms: number; result: unknown }> {
  return as(owner, async (q) => {
    const t = performance.now();
    const res = await q<{ r: unknown }>(sql, params);
    return { ms: Math.round(performance.now() - t), result: res.rows[0].r };
  });
}

async function main(): Promise<void> {
  const sizes = (process.argv[2] ?? '1x500,4x500,2x2000').split(',').map((s) => s.split('x').map(Number) as [number, number]);
  await buildDatabase();
  // F73_PATCH=1 tries the candidate fixes on the local test database only (never a migration here):
  // the approved-count trigger fires only when a question's status changes, and the tag lookup finds
  // the cited entries by their unique ref instead of scanning the knowledge base.
  if (process.env.F73_PATCH === '1') await asSuperuser(PATCH);
  const owner = await createUser({ name: 'F-73 owner' });
  await loadKnowledgeBase(owner);
  const rows: string[] = [];
  for (const [files, per] of sizes) {
    const label = `${files}x${per}`;
    const sent = await loadResponse(owner, `${label}-send`, files, per, 'accepted');
    const send = await timed(owner, `SELECT record_response_export($1) AS r`, [sent]);
    const bulk = await loadResponse(owner, `${label}-bulk`, files, per, 'pending');
    const approve = await timed(owner, `SELECT bulk_accept_response($1, 0.8) AS r`, [bulk]);
    rows.push(`${label}\t${files * per}\tsend ${send.ms} ms\tbulk ${approve.ms} ms\tbulk accepted ${(approve.result as { accepted: number }).accepted}`);
    console.log(rows.at(-1));
  }
  await getPool().end().catch(() => undefined);
  await closePool().catch(() => undefined);
}

main().catch((err) => { console.error(err); process.exit(1); });
