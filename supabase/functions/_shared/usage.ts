/**
 * Metering and caps for AI calls (Sprint 4, S4-1; decision 0005).
 *
 * Every provider call is wrapped so its token counts land in a list, which the Edge Function
 * writes to `ai_usage` after the calls; the database prices each row. Before any call, the
 * function reserves the work with `reserve_quota()`, which refuses past the per-user daily caps or
 * the organisation's monthly budget. If the reservation cannot be made, nothing is called (fail
 * closed). Plain TypeScript, no Deno imports, so it is unit-tested with Vitest.
 */
import type { ClaudeClient, ClaudeRequest } from './claude.ts';
import type { EmbeddingProvider } from './embeddings.ts';
import { HttpError } from './errors.ts';

export interface UsageRow {
  kind: 'judge' | 'gate' | 'draft' | 'embed' | 'rerank';
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export function meteredClaude(base: ClaudeClient, kind: UsageRow['kind'], sink: UsageRow[]): ClaudeClient {
  return {
    async json<T>(req: ClaudeRequest) {
      const result = await base.json<T>(req);
      sink.push({ kind, provider: 'anthropic', model: result.model, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens });
      return result;
    },
  };
}

/** Rough token estimate for providers that report none (local models cost nothing anyway). */
const estimateTokens = (texts: string[]) => Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);

export function meteredEmbedder(base: EmbeddingProvider, sink: UsageRow[]): EmbeddingProvider {
  return {
    name: base.name,
    model: base.model,
    async embed(texts, kind) {
      const result = await base.embed(texts, kind);
      sink.push({ kind: 'embed', provider: base.name, model: result.model, input_tokens: result.tokens ?? estimateTokens(texts), output_tokens: 0 });
      return result;
    },
  };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** For providers called through fetch (Voyage rerank): records `usage.total_tokens` from each successful reply. */
export function meteredFetch(base: Fetch, tag: Omit<UsageRow, 'input_tokens' | 'output_tokens'>, sink: UsageRow[]): Fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.ok) {
      const body = (await res.clone().json().catch(() => null)) as { usage?: { total_tokens?: number } } | null;
      sink.push({ ...tag, input_tokens: body?.usage?.total_tokens ?? 0, output_tokens: 0 });
    }
    return res;
  };
}

export type QuotaReason = 'daily_questions' | 'daily_embed' | 'monthly_budget';

export function quotaMessage(reason: QuotaReason): string {
  switch (reason) {
    case 'daily_questions':
      return "You have reached today's limit on processing questions. An admin can raise it on the Usage page.";
    case 'daily_embed':
      return "You have reached today's limit on indexing knowledge-base text. An admin can raise it on the Usage page.";
    case 'monthly_budget':
      return "This month's AI budget has been reached, so nothing more can be processed. An admin can raise it on the Usage page.";
  }
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Reserve work for a user; throws 429 when none is allowed and 503 when the check cannot run.
 * The reservation also holds an estimated cost against the monthly budget until it is settled.
 */
export async function reserveQuota(db: RpcClient, userId: string, kind: 'questions' | 'embed', n: number): Promise<{ allowed: number; reason: QuotaReason | null; reservation: string | null }> {
  const { data, error } = await db.rpc('reserve_quota', { p_user: userId, p_kind: kind, p_n: n });
  const r = data as { allowed?: number; reason?: QuotaReason | null; reservation?: string | null } | null;
  if (error || !r || typeof r.allowed !== 'number') {
    throw new HttpError('Usage could not be checked, so nothing was processed. Try again shortly.', 503);
  }
  if (r.allowed === 0 && n > 0) throw new HttpError(quotaMessage(r.reason ?? 'monthly_budget'), 429);
  return { allowed: r.allowed, reason: r.reason ?? null, reservation: r.reservation ?? null };
}

interface InsertClient {
  from(table: string): { insert(rows: Record<string, unknown>[]): PromiseLike<{ error: unknown }> };
}

/** Write the calls' usage. Returns false (and logs) if it fails; the spend has happened either way. */
export async function recordUsage(db: InsertClient, userId: string, fn: string, sessionId: string | null, rows: UsageRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  const { error } = await db.from('ai_usage').insert(rows.map((r) => ({ ...r, user_id: userId, function: fn, session_id: sessionId })));
  if (error) console.error('ai_usage insert failed', error);
  return !error;
}

/**
 * Record the calls made under some reservations, then release the reservations. Run it in a
 * `finally`, so calls made before an error are recorded too (security review, finding 6). If the
 * usage cannot be written, the reservations are kept: their estimates go on counting against the
 * monthly budget, so unrecorded spend cannot slip past it.
 */
export async function finishUsage(
  db: InsertClient & RpcClient, userId: string, fn: string, sessionId: string | null, rows: UsageRow[], reservations: (string | null)[],
): Promise<boolean> {
  let recorded = false;
  try {
    recorded = await recordUsage(db, userId, fn, sessionId, rows);
  } catch (err) {
    console.error('ai_usage insert threw', err);
  }
  if (!recorded) return false;
  for (const id of reservations) {
    if (!id) continue;
    const { error } = await db.rpc('settle_reservation', { p_reservation: id });
    if (error) console.error('settle_reservation failed', error);
  }
  return true;
}
