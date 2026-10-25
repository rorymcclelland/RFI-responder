// Sprint 1, story S1-2: embedding providers (test numbers from docs/refinement/sprint-1.md).
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHECKER, DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSION, EmbeddingError, providerForRequest, providerFromEnv, voyageProvider, ollamaProvider } from './embeddings';
import { CALIBRATION_TABLES } from './calibration-tables';

const vec = (seed: number) => Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (i === seed ? 1 : 0));
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('voyage provider', () => {
  it('1. sends the model and input type, and returns vectors in input order', async () => {
    const fetchMock = vi.fn(async () => ok({ data: [{ index: 1, embedding: vec(1) }, { index: 0, embedding: vec(0) }], model: 'voyage-4' }));
    const p = voyageProvider({ apiKey: 'sk-secret', model: 'voyage-4', fetch: fetchMock });
    const out = await p.embed(['first', 'second'], 'query');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(JSON.parse(init.body as string)).toEqual({ input: ['first', 'second'], model: 'voyage-4', input_type: 'query', output_dimension: 1024 });
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(out.vectors[0][0]).toBe(1);
    expect(out.vectors[1][1]).toBe(1);
    expect(out.model).toBe('voyage-4');
  });

  it.each([401, 429, 500])('4. a %i from the provider becomes a clear error that never contains the key', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{"detail":"bad key sk-secret"}', { status }));
    const p = voyageProvider({ apiKey: 'sk-secret', model: 'voyage-4', fetch: fetchMock });
    const err = await p.embed(['x'], 'query').catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.status).toBe(status === 429 ? 429 : 502);
    expect(err.message).not.toContain('sk-secret');
    expect(err.message).not.toContain('bad key');
  });
});

describe('ollama provider', () => {
  it('2. calls /api/embed with the model and returns vectors in order', async () => {
    const fetchMock = vi.fn(async () => ok({ embeddings: [vec(0), vec(1)] }));
    const p = ollamaProvider({ baseUrl: 'http://host.docker.internal:11434/', model: 'bge-m3', fetch: fetchMock });
    const out = await p.embed(['a', 'b'], 'document');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://host.docker.internal:11434/api/embed');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'bge-m3', input: ['a', 'b'] });
    expect(out.vectors).toHaveLength(2);
  });

  it('adds the retrieval instruction to qwen3-embedding queries, not to documents', async () => {
    const fetchMock = vi.fn(async () => ok({ embeddings: [vec(0)] }));
    const p = ollamaProvider({ baseUrl: 'http://x:11434', model: 'qwen3-embedding:0.6b', fetch: fetchMock });
    await p.embed(['Do you use MFA?'], 'query');
    await p.embed(['We use MFA.'], 'document');
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c as unknown as [string, RequestInit])[1].body as string));
    expect(bodies[0].input[0]).toMatch(/^Instruct: .+\nQuery: Do you use MFA\?$/);
    expect(bodies[1].input[0]).toBe('We use MFA.');
  });

  it('reports Ollama not running as unavailable', async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError('fetch failed'); });
    const p = ollamaProvider({ baseUrl: 'http://x:11434', model: 'bge-m3', fetch: fetchMock });
    await expect(p.embed(['a'], 'query')).rejects.toMatchObject({ status: 503 });
  });
});

describe('checks shared by every provider', () => {
  it('3. a vector of the wrong length is rejected', async () => {
    const fetchMock = vi.fn(async () => ok({ embeddings: [[0.1, 0.2, 0.3]] }));
    const p = ollamaProvider({ baseUrl: 'http://x:11434', model: 'bge-m3', fetch: fetchMock });
    await expect(p.embed(['a'], 'query')).rejects.toThrow(/1024/);
  });

  it('a mismatched number of vectors is rejected', async () => {
    const fetchMock = vi.fn(async () => ok({ embeddings: [vec(0)] }));
    const p = ollamaProvider({ baseUrl: 'http://x:11434', model: 'bge-m3', fetch: fetchMock });
    await expect(p.embed(['a', 'b'], 'query')).rejects.toThrow(/2 texts/);
  });

  it('providerFromEnv picks the configured provider and refuses a missing key', () => {
    expect(providerFromEnv({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'bge-m3', OLLAMA_URL: 'http://x:11434' }).model).toBe('bge-m3');
    expect(() => providerFromEnv({ EMBEDDING_PROVIDER: 'voyage', EMBEDDING_MODEL: 'voyage-4' })).toThrow(/VOYAGE_API_KEY/);
    expect(() => providerFromEnv({ EMBEDDING_PROVIDER: 'other' })).toThrow(/EMBEDDING_PROVIDER/);
  });
});

describe('rate limits (found in the first comparison run, 22 Oct)', () => {
  it('waits and retries after a 429, honouring Retry-After', async () => {
    const waits: number[] = [];
    let n = 0;
    const fetchMock = vi.fn(async () =>
      n++ < 2 ? new Response('', { status: 429, headers: { 'Retry-After': '3' } }) : ok({ data: [{ index: 0, embedding: vec(0) }] }));
    const p = voyageProvider({ apiKey: 'k', model: 'voyage-4', fetch: fetchMock, retry: { attempts: 4, baseDelayMs: 1000, sleep: async (ms) => { waits.push(ms); } } });
    await p.embed(['a'], 'query');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([3000, 3000]);
  });

  it('backs off exponentially without Retry-After, then gives up with a 429', async () => {
    const waits: number[] = [];
    const fetchMock = vi.fn(async () => new Response('', { status: 429 }));
    const p = voyageProvider({ apiKey: 'k', model: 'voyage-4', fetch: fetchMock, retry: { attempts: 3, baseDelayMs: 500, sleep: async (ms) => { waits.push(ms); } } });
    await expect(p.embed(['a'], 'query')).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([500, 1000]);
  });

  it('does not retry other errors', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 401 }));
    const p = voyageProvider({ apiKey: 'k', model: 'voyage-4', fetch: fetchMock, retry: { attempts: 3, baseDelayMs: 1, sleep: async () => {} } });
    await expect(p.embed(['a'], 'query')).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('providerForRequest (Sprint 11, S11-4, F-46)', () => {
  it('answers a set-up problem with 503 and a plain message, never the detail', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const env of [{ EMBEDDING_PROVIDER: 'voyage' }, { EMBEDDING_PROVIDER: 'other' }]) {
      try {
        providerForRequest(env);
        throw new Error('expected a refusal');
      } catch (err) {
        expect(err).toBeInstanceOf(EmbeddingError);
        expect((err as EmbeddingError).status).toBe(503);
        expect((err as Error).message).toBe('The embedding service is not configured.');
      }
    }
    expect(providerForRequest({ EMBEDDING_PROVIDER: 'ollama' }).model).toBe('qwen3-embedding:0.6b');
  });
});

describe('defaults (Sprint 11, S11-3, F-55)', () => {
  it('local mode defaults to the model decision 0006 chose', () => {
    expect(providerFromEnv({ EMBEDDING_PROVIDER: 'ollama' }).model).toBe('qwen3-embedding:0.6b');
    expect(providerFromEnv({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'bge-m3' }).model).toBe('bge-m3');
  });
  it('every default combination of embedding model and checker has a calibration table', () => {
    for (const model of Object.values(DEFAULT_EMBEDDING_MODEL)) {
      expect(CALIBRATION_TABLES[`${model} + ${DEFAULT_CHECKER}`], model).toBeDefined();
    }
  });
});
