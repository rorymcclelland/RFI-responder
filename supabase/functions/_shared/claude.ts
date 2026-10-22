/**
 * A minimal Claude client for structured output (decision 0005, Sprint 2).
 *
 * Calls the Messages API with `output_config.format` set to a JSON schema and returns the parsed
 * object. Plain TypeScript with no imports beyond ./embeddings, so it runs in Supabase Edge
 * Functions (Deno), the Node evaluation scripts and Vitest with fetch mocked. Errors never include
 * the key or the provider's response body.
 */
import { withRateLimitRetry, type RetryPolicy } from './embeddings.ts';

export const ANTHROPIC_VERSION = '2026-10-21';

/** A string placed in every system prompt so the red-team evaluation can detect prompt leaks. */
export const PROMPT_CANARY = 'RFI-CANARY-7Q2X';

export class ClaudeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ClaudeError';
  }
}

export interface ClaudeRequest {
  model: string;
  system: string;
  /** The user turn. Callers pass untrusted text as JSON so it cannot break out of its delimiters. */
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface ClaudeResult<T> {
  data: T | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface ClaudeClient {
  json<T>(request: ClaudeRequest): Promise<ClaudeResult<T>>;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1000 };

export function claudeClient(opts: { apiKey: string; fetch?: Fetch; retry?: RetryPolicy }): ClaudeClient {
  const doFetch = opts.fetch ?? fetch;
  return {
    async json<T>(req: ClaudeRequest): Promise<ClaudeResult<T>> {
      const body = {
        model: req.model,
        max_tokens: req.maxTokens,
        system: `${req.system}\n\n[${PROMPT_CANARY}]`,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: { type: 'json_schema', schema: req.schema } },
      };
      const res = await withRateLimitRetry(
        () =>
          doFetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': opts.apiKey,
              'anthropic-version': ANTHROPIC_VERSION,
            },
            body: JSON.stringify(body),
          }).catch(() => {
            throw new ClaudeError('Claude could not be reached', 503);
          }),
        opts.retry ?? DEFAULT_RETRY,
        [429, 529],
      );
      if (!res.ok) {
        if (res.status === 429 || res.status === 529) throw new ClaudeError('Claude is busy or rate-limiting; try again shortly', 429);
        if (res.status === 401 || res.status === 403) throw new ClaudeError('Claude rejected the configured credentials', 502);
        throw new ClaudeError(`Claude returned an error (HTTP ${res.status})`, 502);
      }
      const json = (await res.json()) as {
        model?: string;
        stop_reason?: string;
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const usage = { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 };
      const model = json.model ?? req.model;
      // A refusal or a cut-off answer is treated as no answer; callers decide the safe default.
      if (json.stop_reason !== 'end_turn' && json.stop_reason !== 'stop_sequence') return { data: null, model, usage };
      const text = json.content?.find((b) => b.type === 'text')?.text;
      if (!text) return { data: null, model, usage };
      try {
        return { data: JSON.parse(text) as T, model, usage };
      } catch {
        return { data: null, model, usage };
      }
    },
  };
}
