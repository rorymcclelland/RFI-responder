/**
 * POST { sessionId, questionIds: string[] (1 to 10) } -> { processed: [...] }
 *
 * Story S2-2a: scores, gates and drafts a batch of questions server-side and saves the results
 * with the service role, because members cannot write these columns (migration
 * 20261023100000). Questions are read as the caller, so row-level security decides what they
 * may process. Configuration comes from function secrets (supabase/functions/.env locally):
 * EMBEDDING_PROVIDER / EMBEDDING_MODEL / VOYAGE_API_KEY / OLLAMA_URL (as in Sprint 1),
 * ANTHROPIC_API_KEY, ANSWERABILITY_CHECKER (claude-haiku-5-5, rerank-2.5, rerank-3 or none),
 * GATE_MODEL and DRAFT_MODEL (default claude-haiku-5-5).
 *
 * Sprint 4 (S4-1): the questions are reserved against the caller's daily cap and the monthly
 * budget before any provider is called; past the cap, the rest are returned unprocessed with the
 * reason. Every provider call is recorded in ai_usage.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pipelineDeps } from '../_shared/pipeline-env.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, quotaMessage, reserveQuota, type UsageRow } from '../_shared/usage.ts';
import { processQuestions, validateProcessRequest } from '../_shared/process-core.ts';

serve(async (req) => {
  const { user, client: asCaller } = await requireUser(req);
  const { sessionId, questionIds } = validateProcessRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();

  // Read as the caller: row-level security decides what they may process.
  const { data: found, error } = await asCaller
    .from('rfi_questions')
    .select('id, question, status, processed_at')
    .eq('session_id', sessionId)
    .in('id', questionIds);
  if (error) throw new HttpError('Could not read the questions', 500);
  if (!found || found.length !== questionIds.length) throw new HttpError('Some questions are not in this session', 400);
  // Each question is processed once: reprocessing could reroll a classifier's gate or replace an
  // accepted draft (security review). Already processed or decided questions are skipped.
  const questions = found.filter((q) => q.processed_at === null && q.status === 'pending');
  const skipped = found.filter((q) => !questions.includes(q)).map((q) => ({ id: q.id, saved: true, skipped: true }));
  if (questions.length === 0) return json(req, 200, { processed: skipped });

  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  // Reserve before spending: refuses (429) when nothing is allowed, fails closed (503) if it cannot check.
  const { allowed, reason, reservation } = await reserveQuota(admin, user.id, 'questions', questions.length);
  const toProcess = questions.slice(0, allowed);
  const limit = reason ? quotaMessage(reason) : null;
  const held = questions.slice(allowed).map((q) => ({ id: q.id, saved: false, note: limit }));
  const usage: UsageRow[] = [];
  const reservations: (string | null)[] = [reservation];

  // Everything that spends goes inside try; usage is recorded in finally, even after an error.
  let saved: Record<string, unknown>[] = [];
  try {
    const deps = await pipelineDeps({ env, asCaller, admin, userId: user.id, usage, reservations });
    const results = await processQuestions(toProcess, deps);

    saved = [];
    for (const r of results) {
      const { id, ...columns } = r;
      // processed_at IS NULL again here, so two overlapping calls cannot both write a question.
      const { data: written, error: saveError } = await admin
        .from('rfi_questions')
        .update(columns)
        .eq('id', id)
        .eq('session_id', sessionId)
        .is('processed_at', null)
        .select('id');
      if (!saveError && (written ?? []).length === 0) {
        saved.push({ id, saved: true, skipped: true });
        continue;
      }
      saved.push({ id, saved: !saveError, gate: r.gate, draftKind: r.draft_kind, confidence: r.confidence, note: r.processing_note });
    }
  } finally {
    await finishUsage(admin, user.id, 'process-questions', sessionId, usage, reservations);
  }
  return json(req, 200, { processed: [...saved, ...held, ...skipped], limit });
});
