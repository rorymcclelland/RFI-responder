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
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { claudeJudge, voyageRerankChecker, type AnswerabilityChecker } from '../_shared/answerability.ts';
import { CALIBRATION_TABLES } from '../_shared/calibration-tables.ts';
import { claudeClient } from '../_shared/claude.ts';
import { providerFromEnv } from '../_shared/embeddings.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { processQuestions, validateProcessRequest } from '../_shared/process-core.ts';
import type { MatchRow } from '../_shared/sources.ts';

/**
 * The configured answerability checker. 'none' deliberately falls back to similarity calibration;
 * a checker that is configured but has no key fails every check, so confidence is null rather
 * than quietly falling back (security review).
 */
function checkerFromEnv(env: Record<string, string | undefined>): AnswerabilityChecker | null {
  const choice = env.ANSWERABILITY_CHECKER ?? 'claude-haiku-5-5';
  if (choice === 'none') return null;
  const key = choice.startsWith('rerank-') ? env.VOYAGE_API_KEY : env.ANTHROPIC_API_KEY;
  if (!key) {
    return { name: 'unavailable', model: choice, check: () => Promise.reject(new Error(`${choice} has no API key configured`)) };
  }
  if (choice.startsWith('rerank-')) return voyageRerankChecker({ apiKey: key, model: choice });
  return claudeJudge({ client: claudeClient({ apiKey: key }), model: choice });
}

serve(async (req) => {
  const { client: asCaller } = await requireUser(req);
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

  const provider = (() => {
    try {
      return providerFromEnv(env);
    } catch {
      return null;
    }
  })();
  const claude = env.ANTHROPIC_API_KEY ? claudeClient({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  const results = await processQuestions(questions, {
    embed: provider ? (texts) => provider.embed(texts, 'query') : null,
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
    checker: checkerFromEnv(env),
    classifier: claude ? { client: claude, model: env.GATE_MODEL ?? 'claude-haiku-5-5' } : null,
    drafter: claude ? { client: claude, model: env.DRAFT_MODEL ?? 'claude-haiku-5-5' } : null,
    tables: CALIBRATION_TABLES,
  });

  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const saved: Record<string, unknown>[] = [];
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
  return json(req, 200, { processed: [...saved, ...skipped] });
});
