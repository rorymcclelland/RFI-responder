/**
 * Sprint 18 (S18-2, K-2): one answer and its history. The data comes from one database call,
 * `entry_detail(ref)`, which reads under the caller's own rights; its history is that entry's own
 * knowledge-base events from the audit log (Rory, Q1). The wording here is pure and tested.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseTags, reviewEntry, validateEntry } from './entryReview';

export type DetailState = 'reviewed' | 'overdue' | 'waiting' | 'translation' | 'proposal' | 'replaced' | 'retired';

export const DETAIL_STATE_LABEL: Record<DetailState, string> = {
  reviewed: 'Reviewed and current', overdue: 'Overdue for review', waiting: 'Waiting for review',
  translation: 'Translation to check', proposal: 'Proposed change, waiting for review', replaced: 'Replaced', retired: 'Retired',
};

export interface EntryDetail {
  entry: {
    id: string; ref: string; question: string; answer: string; tags: string[]; source: string; origin: string;
    createdBy: string | null; createdAt: string; language: 'en' | 'ja'; translatedFrom: string[] | null;
    reviewedAt: string | null; reviewedBy: string | null; lastReviewedAt: string | null; due: string;
    state: DetailState; replacedBy: string | null; proposalFor: string | null;
    retiredAt?: string | null; retiredBy?: string | null; retiredReason?: string | null;
  };
  proposal: { id: string; ref: string; question: string; answer: string; source: string; createdBy: string | null; createdAt: string } | null;
  replaced: { ref: string; question: string }[];
  translations: { ref: string; language: 'en' | 'ja'; reviewed: boolean }[];
  usedCount: number;
  used: {
    questionId: string; question: string; status: 'pending' | 'accepted' | 'skipped'; edited: boolean;
    responseId: string; response: string; outcome: 'won' | 'lost' | 'withdrawn' | null; exportedAt: string | null; archivedAt: string | null; at: string;
  }[];
  history: { at: string; action: string; actor: string | null; details: Record<string, unknown> | null }[];
}

/** A typed number in any of the forms search accepts, as the database stores it ("101" -> "KB-0101"), or null. */
export function normaliseRef(text: string): string | null {
  const m = /^\s*(?:kb[-\s]?)?(\d{1,9})\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return `KB-${n < 10000 ? String(n).padStart(4, '0') : String(n)}`;
}

export async function loadEntryDetail(client: SupabaseClient, ref: string): Promise<EntryDetail | null> {
  const { data, error } = await client.rpc('entry_detail', { p_ref: ref });
  if (error) {
    console.error('entry_detail failed', error);
    throw new Error('This answer could not be loaded. Check your connection and try again.');
  }
  return (data as EntryDetail | null) ?? null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').join(', ') : '');
const who = (id: string | null, names: Map<string, string>) => (id && names.get(id)) || 'a former team member';

/** One line of an answer's history, in words. */
export function describeEvent(e: EntryDetail['history'][number], names: Map<string, string>): string {
  const d = e.details ?? {};
  const by = who(e.actor, names);
  switch (e.action) {
    case 'kb.reviewed':
      if (d.replaced) return `Reviewed by ${by}, replacing ${str(d.replaced)}${d.edited ? ', with corrections' : ''}`;
      return d.edited ? `Corrected and reviewed by ${by}` : `Reviewed by ${by}: correct as it stands`;
    case 'kb.changed': {
      const before = (d.before ?? {}) as Record<string, unknown>;
      const after = (d.after ?? {}) as Record<string, unknown>;
      const parts: string[] = [];
      if (list(before.tags) !== list(after.tags)) parts.push(`topics from ${list(before.tags) || 'none'} to ${list(after.tags) || 'none'}`);
      if (str(before.source) !== str(after.source)) parts.push(`source from ${str(before.source) || 'none'} to ${str(after.source) || 'none'}`);
      return parts.length ? `${by} changed the ${parts.join(', and the ')}` : `${by} saved it without changes`;
    }
    case 'kb.confirmed':
      return `Confirmed by use: approved unedited in ${str(d.response) || 'a response'}${str(d.question) ? ` (“${str(d.question)}”)` : ''}`;
    case 'kb.retired':
      return `Retired by ${by}: ${str(d.reason)}`;
    case 'kb.restored':
      return `Restored by ${by}`;
    default:
      return `Recorded by ${by} (${e.action})`;
  }
}

/** How a response used the answer, in words. */
export function describeUse(u: EntryDetail['used'][number]): string {
  const decision = u.status === 'accepted' ? (u.edited ? 'approved after editing' : 'approved as drafted')
    : u.status === 'skipped' ? 'not answered' : 'still to do';
  const outcome = u.outcome === 'won' ? 'won' : u.outcome === 'lost' ? 'lost' : u.outcome === 'withdrawn' ? 'withdrawn'
    : u.archivedAt ? 'archived' : u.exportedAt ? 'exported' : 'in progress';
  return `${decision}; the response is ${outcome}`;
}

/**
 * Save an admin's edits from the answer's page. A change to the question or answer is a review
 * (review_entry, audited as kb.reviewed); topics and source are a direct update (audited as kb.changed).
 */
export async function saveEntryEdits(
  client: SupabaseClient,
  current: Pick<EntryDetail['entry'], 'id' | 'question' | 'answer' | 'tags' | 'source'>,
  edits: { question: string; answer: string; tags: string; source: string },
): Promise<{ reviewed: boolean; changed: boolean }> {
  const problem = validateEntry({ question: edits.question, answer: edits.answer, tags: parseTags(edits.tags), source: edits.source });
  if (problem) throw new Error(problem);
  const tags = parseTags(edits.tags);
  const source = edits.source.trim();
  const changed = tags.join('\u0000') !== current.tags.join('\u0000') || source !== (current.source ?? '');
  const textChanged = edits.question.trim() !== current.question || edits.answer.trim() !== current.answer;
  if (changed) {
    const { error } = await client.from('kb_entries').update({ tags, source }).eq('id', current.id);
    if (error) throw new Error(`The topics and source were not saved: ${error.message}`);
  }
  if (textChanged) await reviewEntry(client, current.id, { question: edits.question.trim(), answer: edits.answer.trim() });
  return { reviewed: textChanged, changed };
}

/** The reason a retirement needs (5 to 500 characters, as the database checks), or a problem. */
export function retireReasonProblem(reason: string): string | null {
  const r = reason.trim();
  if (r.length < 5) return 'Say why it is being retired, in at least 5 characters.';
  if (r.length > 500) return 'Keep the reason to 500 characters.';
  return null;
}

/** Sprint 18 (S18-3): retire an answer, or decline a proposed change, with a reason (admins; audited). */
export async function retireEntry(client: SupabaseClient, id: string, reason: string): Promise<void> {
  const problem = retireReasonProblem(reason);
  if (problem) throw new Error(problem);
  const { error } = await client.rpc('retire_entry', { p_entry: id, p_reason: reason.trim() });
  if (error) throw new Error(`It was not retired: ${error.message}`);
}

export async function restoreEntry(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc('restore_entry', { p_entry: id });
  if (error) throw new Error(`It was not restored: ${error.message}`);
}

type Text = { question?: string; answer?: string };
/**
 * What a correction changed (security review, L6): the text before it, only where it differs from
 * the text after it (the next correction's "before", or the answer as it is now).
 */
export function correctionBefore(detail: EntryDetail, i: number): Text | null {
  const prev = (h: EntryDetail['history'][number] | undefined) =>
    (h?.action === 'kb.reviewed' ? (h.details?.previous as Text | null | undefined) : null) ?? null;
  const before = prev(detail.history[i]);
  if (!before) return null;
  const next = detail.history.slice(i + 1).map(prev).find((t) => t) ?? { question: detail.entry.question, answer: detail.entry.answer };
  const out: Text = {};
  if (before.question && before.question !== next.question) out.question = before.question;
  if (before.answer && before.answer !== next.answer) out.answer = before.answer;
  return out.question || out.answer ? out : null;
}

