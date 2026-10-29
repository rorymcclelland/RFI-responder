/**
 * The pipeline's providers, configured from the function secrets, for process-questions and (Sprint
 * 18) ask-knowledge, which must run exactly the same pipeline. Every call is metered into `usage`.
 */
import { claudeJudge, voyageRerankChecker, type AnswerabilityChecker } from './answerability.ts';
import { claudeClient } from './claude.ts';
import { DEFAULT_CHECKER } from './embeddings.ts';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { CALIBRATION_TABLES } from './calibration-tables.ts';
import { indexBeforeMatching } from './embed-core.ts';
import { providerFromEnv } from './embeddings.ts';
import { serviceEntryStore } from './entry-store.ts';
import type { ProcessDeps } from './process-core.ts';
import type { MatchRow } from './sources.ts';
import { meteredClaude, meteredEmbedder, meteredFetch, reserveQuota, type UsageRow } from './usage.ts';

/**
 * The configured answerability checker. 'none' deliberately falls back to similarity calibration;
 * a checker that is configured but has no key fails every check, so confidence is null rather
 * than quietly falling back (security review).
 */
export function checkerFromEnv(env: Record<string, string | undefined>, usage: UsageRow[]): AnswerabilityChecker | null {
  const choice = env.ANSWERABILITY_CHECKER ?? DEFAULT_CHECKER;
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


interface PipelineContext {
  env: Record<string, string | undefined>;
  /** The caller's client: matching runs under their own rights. */
  asCaller: SupabaseClient;
  /** The service role: indexing, the cited entries' review state. */
  admin: SupabaseClient;
  userId: string;
  usage: UsageRow[];
  /** Reservations made here (indexing) are added, to be settled by finishUsage. */
  reservations: (string | null)[];
}

/**
 * Everything processQuestions needs, as process-questions has used it since Sprint 11: providers from
 * the secrets, entries without a vector indexed first under the caller's indexing cap, matching as the
 * caller, and the cited entries' review state from the service role. Spends: call it inside the try
 * whose finally records usage.
 */
export async function pipelineDeps({ env, asCaller, admin, userId, usage, reservations }: PipelineContext): Promise<ProcessDeps> {
  const provider = (() => {
    try {
      return providerFromEnv(env);
    } catch {
      return null;
    }
  })();
  const claude = env.ANTHROPIC_API_KEY ? claudeClient({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  const embedder = provider ? meteredEmbedder(provider, usage) : null;
  // Sprint 11 (S11-2, F-43): entries with no vector cannot be matched by meaning. Index them first
  // (two batches at most, under the caller's indexing cap); questions are told about any left.
  let unindexed: number | null = 0;
  if (embedder) {
    const indexing = await indexBeforeMatching({
      db: serviceEntryStore(admin),
      provider: embedder,
      async reserve(n) {
        try {
          const r = await reserveQuota(admin, userId, 'embed', n);
          reservations.push(r.reservation);
          return r.allowed;
        } catch {
          return 0;
        }
      },
    });
    unindexed = indexing.remaining;
  }
  return {
    unindexed,
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
      const rows = (data ?? []) as { ref: string; reviewed: boolean; overdue_since: string | null; replaced_by: string | null; retired: boolean | null }[];
      return new Map(rows.map((r) => [r.ref, { reviewed: r.reviewed, overdueSince: r.overdue_since, replacedBy: r.replaced_by, retired: r.retired === true }]));
    },
  };
}
