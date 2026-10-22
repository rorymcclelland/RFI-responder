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

function checkerFromEnv(env: Record<string, string | undefined>): AnswerabilityChecker | null {
  const choice = env.ANSWERABILITY_CHECKER ?? 'claude-haiku-5-5';
  if (choice === 'none') return null;
  if (choice.startsWith('rerank-')) {
    if (!env.VOYAGE_API_KEY) return null;
    return voyageRerankChecker({ apiKey: env.VOYAGE_API_KEY, model: choice });
  }
  if (!env.ANTHROPIC_API_KEY) return null;
  return claudeJudge({ client: claudeClient({ apiKey: env.ANTHROPIC_API_KEY }), model: choice });
}

serve(async (req) => {
  const { client: asCaller } = await requireUser(req);
  const { sessionId, questionIds } = validateProcessRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();

  // Read as the caller: row-level security decides what they may process.
  const { data: questions, error } = await asCaller
    .from('rfi_questions')
    .select('id, question')
    .eq('session_id', sessionId)
    .in('id', questionIds);
  if (error) throw new HttpError('Could not read the questions', 500);
  if (!questions || questions.length !== questionIds.length) throw new HttpError('Some questions are not in this session', 400);

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
  const saved = [];
  for (const r of results) {
    const { id, ...columns } = r;
    const { error: saveError } = await admin.from('rfi_questions').update(columns).eq('id', id).eq('session_id', sessionId);
    saved.push({ id, saved: !saveError, gate: r.gate, draftKind: r.draft_kind, confidence: r.confidence, note: r.processing_note });
  }
  return json(req, 200, { processed: saved });
});
