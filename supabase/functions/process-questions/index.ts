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
import { claudeJudge, voyageRerankChecker, type AnswerabilityChecker } from '../_shared/answerability.ts';
import { CALIBRATION_TABLES } from '../_shared/calibration-tables.ts';
import { claudeClient } from '../_shared/claude.ts';
import { providerFromEnv } from '../_shared/embeddings.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredClaude, meteredEmbedder, meteredFetch, quotaMessage, reserveQuota, type UsageRow } from '../_shared/usage.ts';
import { processQuestions, validateProcessRequest } from '../_shared/process-core.ts';
import type { MatchRow } from '../_shared/sources.ts';

/**
 * The configured answerability checker. 'none' deliberately falls back to similarity calibration;
 * a checker that is configured but has no key fails every check, so confidence is null rather
 * than quietly falling back (security review).
 */
function checkerFromEnv(env: Record<string, string | undefined>, usage: UsageRow[]): AnswerabilityChecker | null {
  const choice = env.ANSWERABILITY_CHECKER ?? 'claude-haiku-5-5';
  if (choice === 'none') return null;
  const key = choice.startsWith('rerank-') ? env.VOYAGE_API_KEY : env.ANTHROPIC_API_KEY;
  if (!key) {
    return { name: 'unavailable', model: choice, check: () => Promise.reject(new Error(`${choice} has no API key configured`)) };
  }
  if (choice.startsWith('rerank-')) {
    return voyageRerankChecker({ apiKey: key, model: choice, fetch: meteredFetch(fetch, { kind: 'rerank', provider: 'voyage', model: choice }, usage) });
  }
  return claudeJudge({ client: meteredClaude(claudeClient({ apiKey: key }), 'judge', usage), model: choice });
}

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

  // Everything that spends goes inside try; usage is recorded in finally, even after an error.
  let saved: Record<string, unknown>[] = [];
  try {
    const provider = (() => {
      try {
        return providerFromEnv(env);
      } catch {
        return null;
      }
    })();
    const claude = env.ANTHROPIC_API_KEY ? claudeClient({ apiKey: env.ANTHROPIC_API_KEY }) : null;
    const embedder = provider ? meteredEmbedder(provider, usage) : null;
    const results = await processQuestions(toProcess, {
      embed: embedder ? (texts) => embedder.embed(texts, 'query') : null,
      async match(text, vector, model) {
        const { data, error } = await asCaller.rpc('match_kb_entries', {
          query_embedding: vector ? `[${vector.join(',')}]` : null,
          query_text: text,
          match_count: 5,
          model_name: model,
        });
        if (error) throw new Error('match failed');
        return (data ?? []) as MatchRow[];
      },
      checker: checkerFromEnv(env, usage),
      classifier: claude ? { client: meteredClaude(claude, 'gate', usage), model: env.GATE_MODEL ?? 'claude-haiku-5-5' } : null,
      drafter: claude ? { client: meteredClaude(claude, 'draft', usage), model: env.DRAFT_MODEL ?? 'claude-haiku-5-5' } : null,
      tables: CALIBRATION_TABLES,
      // Sprint 4 (S4-3, S4-4): drafts citing unreviewed or overdue entries are held from bulk approval.
      async sourceStatus(refs) {
        const { data, error } = await admin.rpc('entry_review_status', { p_refs: refs });
        if (error) throw new Error('review status unavailable');
        const rows = (data ?? []) as { ref: string; reviewed: boolean; overdue_since: string | null; replaced_by: string | null }[];
        return new Map(rows.map((r) => [r.ref, { reviewed: r.reviewed, overdueSince: r.overdue_since, replacedBy: r.replaced_by }]));
      },
    });

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
    await finishUsage(admin, user.id, 'process-questions', sessionId, usage, [reservation]);
  }
  return json(req, 200, { processed: [...saved, ...held, ...skipped], limit });
});
