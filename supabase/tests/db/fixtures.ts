// Shared builders for the database tests (Sprint 4 onwards). Rows are written as the superuser,
// so tests set up exactly the state they need and then act as a member, owner or admin.
import { asSuperuser } from './harness';

export const one = async <T>(sql: string, params: unknown[] = []) => (await asSuperuser<T & object>(sql, params)).rows[0];

export async function response(ownerId: string, opts: { name?: string } = {}): Promise<string> {
  return (await one<{ id: string }>(
    `INSERT INTO opportunities (name, created_by, owner_id) VALUES ($1, $2, $2) RETURNING id`,
    [opts.name ?? 'Response', ownerId])).id;
}

export async function session(opp: string): Promise<string> {
  return (await one<{ id: string }>(
    `INSERT INTO rfi_sessions (file_name, status, question_count, opportunity_id) VALUES ('s.xlsx', 'in_progress', 0, $1) RETURNING id`, [opp])).id;
}

/** A processed, drafted, ungated question; `cited` defaults to the first source. */
export async function question(s: string, o: {
  confidence?: number; gate?: string | null; sources?: string[]; cited?: string[]; text?: string; generated?: string; final?: string | null;
} = {}): Promise<string> {
  const sources = o.sources ?? [];
  return (await one<{ id: string }>(
    `INSERT INTO rfi_questions (session_id, position, question, generated_answer, final_answer, confidence, status, gate, language,
       verdict, sources_json, embedding_model, judge_model, draft_model, prompt_version, calibration_set, draft_kind, processed_at,
       judge_best_ref, cited_refs)
     VALUES ($1, 0, $2, $3, $4, $5, 'pending', $6, 'en', 'yes', $7, 'voyage-4', 'claude-haiku-5-5', 'claude-haiku-5-5', 'draft-1', 'set 1',
       'generated', now(), $8, $9)
     RETURNING id`,
    [s, o.text ?? 'How is data encrypted at rest?', o.generated ?? 'We encrypt data at rest.', o.final === undefined ? null : o.final,
      o.confidence ?? 0.9, o.gate ?? null, JSON.stringify(sources.map((id, i) => ({ id, score: 0.9 - i / 100 }))),
      sources[0] ?? null, o.cited ?? sources.slice(0, 1)])).id;
}

/** A knowledge-base entry; reviewed unless `reviewed` is false. */
export async function entry(o: { question?: string; answer?: string; createdBy?: string | null; origin?: string;
  reviewed?: boolean; createdAt?: string; lastReviewedAt?: string | null } = {}): Promise<{ id: string; ref: string }> {
  return one<{ id: string; ref: string }>(
    `INSERT INTO kb_entries (question, answer, tags, origin, created_by, created_at, reviewed_at, last_reviewed_at)
     VALUES ($1, $2, '{}', $3::kb_origin, $4, coalesce($5::timestamptz, now()),
             CASE WHEN $6 THEN coalesce($5::timestamptz, now()) END, $7::timestamptz)
     RETURNING id, ref`,
    [o.question ?? `Question ${Math.random()}`, o.answer ?? 'Answer.', o.origin ?? 'seed', o.createdBy ?? null,
      o.createdAt ?? null, o.reviewed ?? true, o.lastReviewedAt ?? null]);
}
