/**
 * Embedding providers (decision 0005): one interface, two implementations.
 *
 * - voyage: hosted, Voyage AI's API (needs VOYAGE_API_KEY).
 * - ollama: local, an Ollama server on the machine running Supabase.
 *
 * Plain TypeScript with no imports, so it runs in Supabase Edge Functions (Deno),
 * in the Node evaluation scripts, and under Vitest with fetch mocked.
 */

/** Every model we use returns, or is asked for, vectors of this length (column kb_entries.embedding). */
export const EMBEDDING_DIMENSION = 1024;

/** 'query' for a question being looked up; 'document' for a knowledge-base entry being stored. */
export type EmbedKind = 'query' | 'document';

export interface EmbedResult {
  /** The model that produced the vectors, recorded with each stored vector. */
  model: string;
  vectors: number[][];
}

export interface EmbeddingProvider {
  readonly name: 'voyage' | 'ollama';
  readonly model: string;
  embed(texts: string[], kind: EmbedKind): Promise<EmbedResult>;
}

/** An error that is safe to return to the browser: no keys, no provider response bodies. */
export class EmbeddingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** How to handle rate limiting (HTTP 429): retry after Retry-After, or exponential back-off. */
export interface RetryPolicy {
  /** Total tries, including the first. */
  attempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

/** The app waits briefly; the evaluation scripts pass a patient policy. */
const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 1000 };

async function withRateLimitRetry(call: () => Promise<Response>, policy: RetryPolicy): Promise<Response> {
  const sleep = policy.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    const res = await call();
    if (res.status !== 429 || attempt >= policy.attempts) return res;
    const retryAfter = Number(res.headers.get('Retry-After'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : policy.baseDelayMs * 2 ** (attempt - 1));
  }
}

function checkVectors(vectors: unknown, count: number, model: string): number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) {
    throw new EmbeddingError(`The embedding service returned the wrong number of vectors for ${count} texts`, 502);
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSION) {
      throw new EmbeddingError(
        `Model ${model} returned vectors of length ${Array.isArray(v) ? v.length : '?'}; ${EMBEDDING_DIMENSION} are required`,
        502,
      );
    }
  }
  return vectors as number[][];
}

/** Turn a provider's HTTP status into a safe error. The response body is deliberately not used. */
function providerFailure(provider: string, status: number): EmbeddingError {
  if (status === 429) return new EmbeddingError(`${provider} is rate-limiting requests; try again shortly`, 429);
  if (status === 401 || status === 403) return new EmbeddingError(`${provider} rejected the configured credentials`, 502);
  return new EmbeddingError(`${provider} returned an error (HTTP ${status})`, 502);
}

export function voyageProvider(opts: { apiKey: string; model: string; fetch?: Fetch; retry?: RetryPolicy }): EmbeddingProvider {
  const doFetch = opts.fetch ?? fetch;
  return {
    name: 'voyage',
    model: opts.model,
    async embed(texts, kind) {
      const res = await withRateLimitRetry(() => doFetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ input: texts, model: opts.model, input_type: kind, output_dimension: EMBEDDING_DIMENSION }),
      }).catch(() => {
        throw new EmbeddingError('Voyage could not be reached', 503);
      }), opts.retry ?? DEFAULT_RETRY);
      if (!res.ok) throw providerFailure('Voyage', res.status);
      const body = (await res.json()) as { data?: { index: number; embedding: number[] }[] };
      const ordered = [...(body.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      return { model: opts.model, vectors: checkVectors(ordered, texts.length, opts.model) };
    },
  };
}

/**
 * Qwen3 embedding models expect an instruction in front of queries (not documents);
 * other models are used as they are.
 */
const QUERY_INSTRUCTIONS: Record<string, string> = {
  'qwen3-embedding':
    'Instruct: Given a question from a security questionnaire, retrieve the knowledge-base entry that answers it\nQuery: ',
};

export function ollamaProvider(opts: { baseUrl: string; model: string; fetch?: Fetch }): EmbeddingProvider {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const prefix = QUERY_INSTRUCTIONS[opts.model.split(':')[0]] ?? '';
  return {
    name: 'ollama',
    model: opts.model,
    async embed(texts, kind) {
      const input = kind === 'query' ? texts.map((t) => prefix + t) : texts;
      const res = await doFetch(`${base}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: opts.model, input }),
      }).catch(() => {
        throw new EmbeddingError('The local Ollama server could not be reached; is it running?', 503);
      });
      if (!res.ok) throw providerFailure('Ollama', res.status);
      const body = (await res.json()) as { embeddings?: number[][] };
      return { model: opts.model, vectors: checkVectors(body.embeddings, texts.length, opts.model) };
    },
  };
}

/** Build the configured provider from environment variables (Edge Function secrets or a local .env). */
export function providerFromEnv(env: Record<string, string | undefined>, fetchImpl?: Fetch): EmbeddingProvider {
  const provider = env.EMBEDDING_PROVIDER ?? 'voyage';
  if (provider === 'voyage') {
    if (!env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY is not set');
    return voyageProvider({ apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL ?? 'voyage-4', fetch: fetchImpl });
  }
  if (provider === 'ollama') {
    return ollamaProvider({
      baseUrl: env.OLLAMA_URL ?? 'http://host.docker.internal:11434',
      model: env.EMBEDDING_MODEL ?? 'bge-m3',
      fetch: fetchImpl,
    });
  }
  throw new Error(`EMBEDDING_PROVIDER must be "voyage" or "ollama", not "${provider}"`);
}
