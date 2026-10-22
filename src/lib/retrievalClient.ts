/**
 * The app's side of hybrid retrieval (Sprint 1, story S1-5): questions are embedded
 * by the `embed` Edge Function (the provider key stays server-side), then matched
 * in the database by `match_kb_entries`. If embedding is unavailable the caller
 * passes no vector and gets keyword-only results, labelled as such.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RetrievedSource } from '../types';

export interface MatchRow {
  id: string;
  ref: string;
  question: string;
  answer: string;
  tags: string[] | null;
  source: string;
  similarity: number | null;
  keyword_rank: number | null;
  fused_score: number;
  embedding_model: string | null;
}

/** Matches the `embed` function's limit (supabase/functions/_shared/embed-core.ts). */
const EMBED_BATCH = 128;

export type EmbedOutcome = { ok: true; model: string; vectors: number[][] } | { ok: false; reason: string };

export async function embedQuestions(client: SupabaseClient, texts: string[]): Promise<EmbedOutcome> {
  const vectors: number[][] = [];
  let model = '';
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const { data, error } = await client.functions.invoke('embed', {
      body: { texts: texts.slice(i, i + EMBED_BATCH), kind: 'query' },
    });
    if (error || !data) return { ok: false, reason: error?.message ?? 'No response from the embedding service' };
    model = data.model;
    vectors.push(...data.vectors);
  }
  return { ok: true, model, vectors };
}

export async function matchQuestion(
  client: SupabaseClient,
  text: string,
  vector: number[] | null,
  model: string | null,
  count = 5,
): Promise<MatchRow[]> {
  const { data, error } = await client.rpc('match_kb_entries', {
    query_embedding: vector ? `[${vector.join(',')}]` : null,
    query_text: text,
    match_count: count,
    model_name: model,
  });
  if (error) throw new Error(`Matching failed: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

/** Entries within this much cosine similarity of the best one are also used in the draft. */
const SIMILARITY_MARGIN = 0.05;
const MAX_SOURCES = 3;

/**
 * Which matches the draft is assembled from. With vectors: the best entry plus any
 * close runners-up (so an unrelated third entry is not pulled in, as seen in the
 * Sprint 0 end-to-end run). Keyword-only: the top two keyword matches.
 */
export function selectDraftSources(rows: MatchRow[]): RetrievedSource[] {
  if (rows.length === 0) return [];
  const toSource = (r: MatchRow): RetrievedSource => ({
    entry: { id: r.ref, question: r.question, answer: r.answer, tags: r.tags ?? [], source: r.source || undefined },
    score: r.similarity ?? r.fused_score,
  });
  const withSimilarity = rows.filter((r) => r.similarity !== null);
  if (withSimilarity.length > 0) {
    const best = Math.max(...withSimilarity.map((r) => r.similarity!));
    return withSimilarity
      .filter((r) => r.similarity! >= best - SIMILARITY_MARGIN)
      .sort((a, b) => b.similarity! - a.similarity!)
      .slice(0, MAX_SOURCES)
      .map(toSource);
  }
  return rows.filter((r) => (r.keyword_rank ?? 0) > 0).slice(0, 2).map(toSource);
}
