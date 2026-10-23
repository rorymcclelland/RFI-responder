/**
 * What the answerability checker sees for an evaluation item: the entries the app would draft
 * from, chosen from cached vectors with the app's own selection rule. Shared by the answerability
 * comparison (Sprint 2) and the consistency run (Sprint 5, F-22).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CandidateEntry } from '../supabase/functions/_shared/answerability';
import { selectDraftSources } from '../supabase/functions/_shared/sources';
import type { KnowledgeEntry } from '../src/types';
import { cosine } from './metrics';
import { ROOT } from './lib';

/** The entries the app would draft from, using the same selection rule as the app. */
export function candidatesFor(kb: (KnowledgeEntry & { ref: string })[], docVecs: number[][], queryVec: number[]): CandidateEntry[] {
  const rows = kb
    .map((e, i) => ({ ref: e.ref, question: e.question, answer: e.answer, tags: e.tags, source: e.source ?? '', similarity: cosine(queryVec, docVecs[i]) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
    .map((r) => ({ ...r, id: r.ref, keyword_rank: 0, fused_score: r.similarity, embedding_model: null }));
  return selectDraftSources(rows).map((s) => ({ ref: s.entry.id, question: s.entry.question, answer: s.entry.answer, similarity: s.score }));
}

/** Vectors cached by `npm run eval:retrieval`, or a message saying they are missing. */
export function vectorsFor(dir: string): { doc: Record<string, number[]>; query: Record<string, number[]> } | string {
  const base = join(ROOT, 'eval/.cache', dir);
  if (!existsSync(join(base, 'document.json')) || !existsSync(join(base, 'query.json'))) {
    return `no cached vectors in eval/.cache/${dir}; run npm run eval:retrieval first`;
  }
  return {
    doc: JSON.parse(readFileSync(join(base, 'document.json'), 'utf8')),
    query: JSON.parse(readFileSync(join(base, 'query.json'), 'utf8')),
  };
}
