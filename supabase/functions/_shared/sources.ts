/**
 * Which knowledge-base matches a draft is built from (Sprint 1, S1-5; moved server-side in
 * Sprint 2, S2-2a). Pure, so the Edge Function, the evaluation scripts and the tests share it.
 */

/** One row from the database function match_kb_entries. */
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
  /** Sprint 12 (S12-2): the entry's language; absent from rows read before Sprint 12. */
  language?: string | null;
}

export type Language = 'en' | 'ja';

const JAPANESE = /[ぁ-ヿ一-鿿]/g;
/** Whether at least a fifth of the text (characters other than spaces, after NFKC folding) is kana or kanji. */
const mostlyJapanese = (text: string): boolean => {
  const t = text.normalize('NFKC');
  return (t.match(JAPANESE)?.length ?? 0) * 5 >= Math.max(t.replace(/\s/g, '').length, 1);
};

/**
 * Sprint 12: the one language rule, the same as kb_entries.language and public.text_language in the
 * database (security review, L3): Japanese if a fifth of the question, or of the answer, is Japanese
 * script. A question is passed with an empty answer; a draft with an empty question.
 */
export function textLanguage(question: string, answer = ''): Language {
  return mostlyJapanese(question) || mostlyJapanese(answer) ? 'ja' : 'en';
}

/** A draft's own text, without the reference list and translation label the app adds at its end. */
export function draftBody(text: string): string {
  return text.replace(/\s*\[Translated from (English|Japanese) knowledge-base entries\.[^\]]*\]\s*$/, '')
    .replace(/\s*\[References: [^\]]*\]\s*$/, '').trim();
}

/**
 * Sprint 12 (S12-2): the language a draft is translated from, or null when every entry it draws on
 * is in the question's own language. With several, the first entry in another language decides.
 */
export function translatedFrom(questionLanguage: Language, entries: { language?: Language }[]): Language | null {
  const other = entries.find((e) => (e.language ?? 'en') !== questionLanguage);
  return other ? other.language ?? 'en' : null;
}

/** A matched entry as drafting and the screen see it; `entry.id` is the entry's ref (KB-0001). */
export interface Source {
  entry: { id: string; question: string; answer: string; tags: string[]; source?: string; language?: Language };
  score: number;
}

/** Entries within this much cosine similarity of the best one are also used in the draft. */
const SIMILARITY_MARGIN = 0.05;
const MAX_SOURCES = 3;

/**
 * With vectors: the best entry plus any close runners-up (so an unrelated third entry is not
 * pulled in, as seen in the Sprint 0 end-to-end run). Keyword-only: the top two keyword matches.
 */
export function selectDraftSources(rows: MatchRow[]): Source[] {
  if (rows.length === 0) return [];
  const toSource = (r: MatchRow): Source => ({
    entry: { id: r.ref, question: r.question, answer: r.answer, tags: r.tags ?? [], source: r.source || undefined, language: r.language === 'ja' ? 'ja' : 'en' },
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
