/**
 * POST { blocks: Block[] } -> { questions, dropped, method, model, promptVersion }
 *
 * Story S5-2: finds the questions in a Word document's text blocks (read in the browser by
 * src/lib/wordDocument.ts). Claude proposes; code keeps only what is found in the document
 * (supabase/functions/_shared/extraction.ts). Reserved against the caller's daily limit of Word
 * documents and the monthly budget before Claude is called; usage recorded in finally. Nothing is
 * saved here: the person checks and corrects the list in the preview, then saves it.
 * Configuration: ANTHROPIC_API_KEY, EXTRACT_MODEL (default claude-haiku-5-5).
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { claudeClient } from '../_shared/claude.ts';
import { extractQuestions, validateExtractRequest } from '../_shared/extraction.ts';
import { json, requireUser, serve } from '../_shared/http.ts';
import { finishUsage, meteredClaude, reserveQuota, type UsageRow } from '../_shared/usage.ts';

serve(async (req) => {
  const { user } = await requireUser(req);
  const { blocks } = validateExtractRequest(await req.json().catch(() => null));
  const env = Deno.env.toObject();
  const admin = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // One document; 429 past the daily limit or the budget, 503 if the check cannot run.
  const { reservation } = await reserveQuota(admin, user.id, 'extract', 1);
  const usage: UsageRow[] = [];
  try {
    const client = env.ANTHROPIC_API_KEY ? meteredClaude(claudeClient({ apiKey: env.ANTHROPIC_API_KEY }), 'extract', usage) : null;
    const result = await extractQuestions(blocks, { client, model: env.EXTRACT_MODEL ?? 'claude-haiku-5-5' });
    return json(req, 200, result);
  } finally {
    await finishUsage(admin, user.id, 'extract-questions', null, usage, [reservation]);
  }
});
