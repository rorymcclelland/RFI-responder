/**
 * Responses (opportunities) through the Sprint 3 database functions: the overview, due dates,
 * recorded export, archive and admin delete. The database enforces who may do each of these;
 * these helpers only call it and turn its answers into the screen's shapes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Opportunity, ResponseOutcome, ResponseStage } from '../types';

export interface OverviewRow {
  id: string; name: string; owner_id: string | null; owner_name: string | null; due_date: string | null;
  created_at: string; updated_at: string; exported_at: string | null; archived_at: string | null;
  outcome: ResponseOutcome | null; stage: ResponseStage; total: number; decided: number; accepted: number;
  skipped: number; pending: number; gated_pending: number; open_assignments: number; overdue: boolean; at_risk: boolean;
}

export function toResponse(r: OverviewRow): Opportunity {
  return {
    id: r.id, name: r.name, ownerId: r.owner_id, ownerName: r.owner_name, dueDate: r.due_date,
    createdAt: r.created_at, updatedAt: r.updated_at, exportedAt: r.exported_at, archivedAt: r.archived_at,
    outcome: r.outcome, stage: r.stage, total: r.total, decided: r.decided, accepted: r.accepted,
    skipped: r.skipped, pending: r.pending, gatedPending: r.gated_pending, openAssignments: r.open_assignments,
    overdue: r.overdue, atRisk: r.at_risk,
  };
}

/** Every response, soonest due first (no due date last). */
export async function loadOverview(client: SupabaseClient): Promise<Opportunity[]> {
  const { data, error } = await client
    .from('response_overview')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`Could not load responses: ${error.message}`);
  return (data as OverviewRow[]).map(toResponse);
}

export async function loadResponse(client: SupabaseClient, id: string): Promise<Opportunity | null> {
  const { data } = await client.from('response_overview').select('*').eq('id', id).maybeSingle();
  return data ? toResponse(data as OverviewRow) : null;
}

const fail = (what: string, message: string) => new Error(`${what}: ${message}`);

export async function createResponse(client: SupabaseClient, name: string, dueDate: string | null): Promise<string> {
  const { data, error } = await client.from('opportunities').insert({ name, due_date: dueDate || null }).select('id').single();
  if (error || !data) throw fail('The response was not created', error?.message ?? 'no response');
  return data.id as string;
}

export async function updateResponse(client: SupabaseClient, id: string, patch: { name?: string; dueDate?: string | null }) {
  const db: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) db.name = patch.name;
  if (patch.dueDate !== undefined) db.due_date = patch.dueDate || null;
  const { data, error } = await client.from('opportunities').update(db).eq('id', id).select('id');
  if (error) throw fail('Not saved', error.message);
  if (!data?.length) throw new Error('Not saved: only the response owner or an admin can change it.');
}

export async function archiveResponse(client: SupabaseClient, id: string, outcome: ResponseOutcome) {
  const { error } = await client.rpc('archive_response', { p_response: id, p_outcome: outcome });
  if (error) throw fail('Not archived', error.message);
}

export async function deleteResponse(client: SupabaseClient, id: string, reason: string) {
  const { error } = await client.rpc('delete_response', { p_response: id, p_reason: reason });
  if (error) throw fail('Not deleted', error.message);
}

export interface ExportSummary {
  accepted: number; skipped: number; added?: number; superseded?: number; confirmed?: number;
  not_learned_pricing?: number; not_learned_japanese?: number; not_learned_empty?: number;
}

export async function recordExport(client: SupabaseClient, sessionId: string): Promise<ExportSummary> {
  const { data, error } = await client.rpc('record_export', { p_session: sessionId });
  if (error) throw fail('Export not recorded', error.message);
  return data as ExportSummary;
}

/** What learning did, in plain words, for the export panel. */
export function describeLearning(s: ExportSummary): string {
  const parts: string[] = [];
  const add = (n: number | undefined, text: string) => { if (n) parts.push(`${n} ${text}`); };
  add(s.added, 'added as new entries');
  add(s.superseded, 'replaced an older entry for the same question');
  add(s.confirmed, 'confirmed existing entries unchanged');
  add(s.not_learned_pricing, 'not learned (pricing)');
  add(s.not_learned_japanese, 'not learned (Japanese, until the knowledge base is multilingual)');
  add(s.not_learned_empty, 'not learned (no answer)');
  return parts.length ? `Knowledge base: ${parts.join('; ')}.` : 'Knowledge base: nothing new to learn from this export.';
}

export interface ExpertSuggestion { userId: string; displayName: string; score: number; reasons: string[] }

export async function suggestExperts(client: SupabaseClient, questionId: string): Promise<ExpertSuggestion[]> {
  const { data, error } = await client.rpc('suggest_experts', { p_question: questionId });
  if (error) return [];
  return (data as { user_id: string; display_name: string; score: number; reasons: string[] }[])
    .map((r) => ({ userId: r.user_id, displayName: r.display_name, score: r.score, reasons: r.reasons }));
}
