/**
 * POST { question: string (1 to 2,000 characters) } -> { result: AskResult }
 *
 * Sprint 18 (S18-4, K-3): ask the knowledge base a question and see the answer it would draft, with
 * its confidence, the checker's verdict and the entries behind it. The question goes through exactly
 * the pipeline process-questions uses (pipelineDeps and processQuestions, unchanged). One question is
 * reserved against the caller's daily question cap and the monthly budget before any provider is
 * called, and every call is recorded in ai_usage under 'ask-knowledge'. Nothing else is saved (Rory,
 * Q4): no question, draft or result is written anywhere.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { askKnowledge, validateAskRequest } from '../_shared/ask-core.ts';
import { HttpError, json, requireUser, serve } from '../_shared/http.ts';
import { pipelineDeps } from '../_shared/pipeline-env.ts';
import { finishUsage, reserveQuota, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user, client: asCaller } = await requireUser(req);
  const { question } = validateAskRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // Reserve before spending: 429 with the limit's message when none is allowed, 503 if it cannot check.
  const { reservation } = await reserveQuota(admin, user.id, 'questions', 1, undefined, { all: true });
  const usage: UsageRow[] = [];
  const reservations: (string | null)[] = [reservation];
  try {
    const deps = await pipelineDeps({ env, asCaller, admin, userId: user.id, usage, reservations });
    const result = await askKnowledge(question, deps);
    return json(req, 200, { result });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('ask-knowledge failed', err);
    throw new HttpError('The question could not be answered just now. Try again shortly.', 502);
  } finally {
    await finishUsage(admin, user.id, 'ask-knowledge', null, usage, reservations);
  }
});
