/**
 * Sprint 23 (S23-1, U-8): Try it. A demo visitor's own response, made from a sample questionnaire
 * that ships with the app (synthetic, `sample-data/try-it-questionnaire.csv`), drafted as an upload
 * is. A try is marked as one when it is made and never changes (the database refuses); it learns
 * nothing when marked as sent and its questions are never gaps (enforced in the database, Q3). A
 * person has at most one open try (Q4); the lists show a person their own tries, and admins all (Q2).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import SAMPLE_CSV from '../../sample-data/try-it-questionnaire.csv?raw';
import { parseSpreadsheet } from './spreadsheet';
import { insertQuestions } from './sessions';

export const TRY_SAMPLE = 'Coral Bay Retail (fictional): security questionnaire';
export const TRY_FILE = 'coral-bay-retail-questionnaire.csv';

/** A try's name: the sample's, and whose it is. */
export const tryName = (person: string) => `Try it: ${TRY_SAMPLE}, ${person.trim() || 'a visitor'}`;

/** The sample's questions, read with the same parser as any upload. */
export async function sampleQuestions(csv: string = SAMPLE_CSV): Promise<{ position: number; question: string; customerRef: string }[]> {
  const bytes = new TextEncoder().encode(csv);
  const { rows } = await parseSpreadsheet({ name: TRY_FILE, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  return rows
    .map((r, position) => ({ position, question: String(r.Question ?? '').trim(), customerRef: String(r.Ref ?? '').trim() }))
    .filter((q) => q.question);
}

export interface TryStarted { responseId: string; sessionId: string; questionIds: string[]; created: boolean }

/** Words for a refusal, in the app's terms; the database's own message stays in the console. */
function failed(step: string, error: { code?: string; message?: string } | null): Error {
  console.error(`try it: ${step}`, error);
  if (error?.code === '23505') return new Error('You already have a try open. Open it from Responses, or start a new one.');
  // Security review, Sprint 23 (L1): five tries a person a day, refused by the database.
  if (error?.message?.includes('five tries today')) return new Error('You have made five tries today. Open your try, or come back tomorrow.');
  return new Error(`Your try could not be made (${step}). Try again in a moment.`);
}

/** Your open try, if you have one. */
export async function openTry(client: SupabaseClient, me: string): Promise<{ responseId: string; sessionId: string | null } | null> {
  // Made by you as well as owned by you (security review, M1: a try is never handed over).
  const { data, error } = await client.from('opportunities').select('id').eq('owner_id', me).eq('created_by', me).eq('trial', true).is('archived_at', null).maybeSingle();
  if (error) throw failed('reading your try', error);
  if (!data) return null;
  const { data: s } = await client.from('rfi_sessions').select('id').eq('opportunity_id', data.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
  return { responseId: String(data.id), sessionId: s ? String(s.id) : null };
}

/**
 * Try it: opens your open try, or makes one: the response, its file and the sample's questions.
 * Drafting them is the response page's, as for any file whose questions are not yet drafted.
 */
export async function startTry(client: SupabaseClient, me: string, myName: string): Promise<TryStarted> {
  const open = await openTry(client, me);
  if (open?.sessionId) return { responseId: open.responseId, sessionId: open.sessionId, questionIds: [], created: false };
  const questions = await sampleQuestions();
  let responseId = open?.responseId;
  if (!responseId) {
    const { data, error } = await client.from('opportunities').insert({ name: tryName(myName), trial: true }).select('id').single();
    if (error || !data) throw failed('the response', error);
    responseId = String(data.id);
  }
  const { data: session, error } = await client.from('rfi_sessions')
    .insert({ file_name: TRY_FILE, question_count: questions.length, opportunity_id: responseId }).select('id').single();
  if (error || !session) throw failed('its file', error);
  const questionIds = await insertQuestions(client, String(session.id), questions);
  return { responseId, sessionId: String(session.id), questionIds, created: true };
}

/** Start a new try: your open one is archived first (withdrawn, as a response never sent can be). */
export async function startNewTry(client: SupabaseClient, me: string, myName: string): Promise<TryStarted> {
  const open = await openTry(client, me);
  if (open) {
    const { error } = await client.rpc('archive_response', { p_response: open.responseId, p_outcome: 'withdrawn' });
    if (error) throw failed('putting your last try away', error);
  }
  return startTry(client, me, myName);
}

/** Q2: the lists show a person their own tries and an admin everyone's; access is unchanged. */
export const showInLists = (r: { trial?: boolean; ownerId?: string | null }, me: string, isAdmin: boolean) =>
  !r.trial || isAdmin || r.ownerId === me;
