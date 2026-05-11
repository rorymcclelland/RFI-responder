import { KnowledgeEntry, RetrievedSource } from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'about',
  'and', 'or', 'but', 'not', 'your', 'our', 'their', 'its', 'this',
  'that', 'these', 'those', 'how', 'what', 'when', 'where', 'who',
  'which', 'you', 'we', 'they', 'it', 'i', 'my', 'your', 'his', 'her',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function buildTermFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  for (const [term, count] of tf) {
    tf.set(term, count / tokens.length);
  }
  return tf;
}

function computeIDF(corpus: string[][], term: string): number {
  const docsWithTerm = corpus.filter((doc) => doc.includes(term)).length;
  if (docsWithTerm === 0) return 0;
  return Math.log((corpus.length + 1) / (docsWithTerm + 1)) + 1;
}

function buildTFIDF(tokens: string[], corpus: string[][]): Map<string, number> {
  const tf = buildTermFrequency(tokens);
  const tfidf = new Map<string, number>();
  for (const [term, tfVal] of tf) {
    tfidf.set(term, tfVal * computeIDF(corpus, term));
  }
  return tfidf;
}

function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [term, valA] of vecA) {
    dot += valA * (vecB.get(term) ?? 0);
    magA += valA * valA;
  }
  for (const [, valB] of vecB) {
    magB += valB * valB;
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function retrieveTopK(
  query: string,
  kb: KnowledgeEntry[],
  k = 3
): RetrievedSource[] {
  const queryTokens = tokenize(query);

  const docCorpus = kb.map((entry) =>
    tokenize(`${entry.question} ${entry.answer} ${entry.tags.join(' ')}`)
  );

  const allTokens = queryTokens;
  const corpus = [allTokens, ...docCorpus];

  const queryVec = buildTFIDF(queryTokens, corpus);

  const scored: RetrievedSource[] = kb.map((entry, idx) => {
    const entryVec = buildTFIDF(docCorpus[idx], corpus);
    const score = cosineSimilarity(queryVec, entryVec);
    return { entry, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
