/**
 * AI usage, caps and budget (Sprint 4, S4-1). The database records and prices every call and
 * enforces the caps; this module reads the figures for the admin's Usage tab and saves changes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface UsageStatus {
  questionsToday: number; questionCap: number;
  embedToday: number; embedCap: number;
  budgetGbp: number; spentGbp: number | null;
  alert: boolean; exhausted: boolean;
}
export interface UsageReport {
  byUser: { userId: string | null; name: string | null; calls: number; spentGbp: number }[];
  byModel: { provider: string; model: string; kind: string; calls: number; inputTokens: number; outputTokens: number; spentGbp: number }[];
  unpricedCalls: number;
  /** Sprint 11 (S11-6): the models those calls used, as 'provider model'. */
  unpricedModels: string[];
  /** F-29: questions processed this month and the measured processing cost per question (dollars). */
  questionsProcessed: number;
  avgUsdPerQuestion: number | null;
}
export interface AiSettings {
  daily_question_cap: number; daily_embed_cap: number; monthly_budget_gbp: number;
  alert_share: number; gbp_per_usd: number; review_interval_months: number;
  est_usd_per_question: number; est_usd_per_embed_text: number;
  daily_extract_cap: number; est_usd_per_extract_kchar: number;
  updated_at: string;
}
export interface AiPrice { provider: string; model: string; input_usd_per_mtok: number; output_usd_per_mtok: number; checked_on: string; source_url: string }

const num = (v: unknown) => Number(v);

export async function loadUsageStatus(client: SupabaseClient): Promise<UsageStatus> {
  const { data, error } = await client.rpc('usage_status');
  if (error || !data) throw new Error(`Usage could not be read: ${error?.message ?? 'no response'}`);
  const d = data as Record<string, unknown>;
  return {
    questionsToday: num(d.questionsToday), questionCap: num(d.questionCap),
    embedToday: num(d.embedToday), embedCap: num(d.embedCap),
    budgetGbp: num(d.budgetGbp), spentGbp: d.spentGbp === null || d.spentGbp === undefined ? null : num(d.spentGbp),
    alert: Boolean(d.alert), exhausted: Boolean(d.exhausted),
  };
}

export async function loadUsageAdmin(client: SupabaseClient): Promise<{ report: UsageReport; settings: AiSettings; prices: AiPrice[] }> {
  const [report, settings, prices] = await Promise.all([
    client.rpc('usage_report'),
    client.from('ai_settings').select('*').single(),
    client.from('ai_prices').select('*').order('provider').order('model'),
  ]);
  const err = report.error ?? settings.error ?? prices.error;
  if (err) throw new Error(`Usage could not be read: ${err.message}`);
  const r = report.data as UsageReport;
  return {
    report: {
      byUser: r.byUser.map((u) => ({ ...u, spentGbp: num(u.spentGbp) })),
      byModel: r.byModel.map((m) => ({ ...m, spentGbp: num(m.spentGbp), inputTokens: num(m.inputTokens), outputTokens: num(m.outputTokens) })),
      unpricedCalls: num(r.unpricedCalls),
      unpricedModels: Array.isArray(r.unpricedModels) ? (r.unpricedModels as unknown[]).map(String) : [],
      questionsProcessed: num(r.questionsProcessed ?? 0),
      avgUsdPerQuestion: r.avgUsdPerQuestion === null || r.avgUsdPerQuestion === undefined ? null : num(r.avgUsdPerQuestion),
    },
    settings: settings.data as AiSettings,
    prices: (prices.data ?? []) as AiPrice[],
  };
}

export type SettingsChange = Partial<Pick<AiSettings, 'daily_question_cap' | 'daily_embed_cap' | 'monthly_budget_gbp' | 'alert_share' | 'gbp_per_usd' | 'review_interval_months' | 'est_usd_per_question' | 'est_usd_per_embed_text' | 'daily_extract_cap' | 'est_usd_per_extract_kchar'>>;

/** Checks the values before sending them; the database checks them again. */
export function validateSettings(change: SettingsChange): string | null {
  const whole = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
  if (change.daily_question_cap !== undefined && !whole(change.daily_question_cap)) return 'The daily question limit must be a whole number, 0 or more.';
  if (change.daily_embed_cap !== undefined && !whole(change.daily_embed_cap)) return 'The daily indexing limit must be a whole number, 0 or more.';
  if (change.daily_extract_cap !== undefined && !whole(change.daily_extract_cap)) return 'The daily document limit must be a whole number, 0 or more.';
  if (change.monthly_budget_gbp !== undefined && !(Number.isFinite(change.monthly_budget_gbp) && change.monthly_budget_gbp >= 0)) return 'The monthly budget must be 0 or more.';
  if (change.alert_share !== undefined && !(change.alert_share > 0 && change.alert_share <= 1)) return 'The warning point must be between 1% and 100%.';
  if (change.gbp_per_usd !== undefined && !(change.gbp_per_usd > 0)) return 'The exchange rate must be more than 0.';
  if (change.est_usd_per_question !== undefined && !(change.est_usd_per_question > 0)) return 'The reserve per question must be more than 0.';
  if (change.est_usd_per_embed_text !== undefined && !(change.est_usd_per_embed_text > 0)) return 'The reserve per knowledge-base text must be more than 0.';
  if (change.est_usd_per_extract_kchar !== undefined && !(change.est_usd_per_extract_kchar > 0)) return 'The reserve per 1,000 characters must be more than 0.';
  if (change.review_interval_months !== undefined && !(Number.isInteger(change.review_interval_months) && change.review_interval_months >= 1 && change.review_interval_months <= 60)) {
    return 'The review interval must be between 1 and 60 months.';
  }
  return null;
}

export async function saveSettings(client: SupabaseClient, change: SettingsChange): Promise<void> {
  const problem = validateSettings(change);
  if (problem) throw new Error(problem);
  const { data, error } = await client.from('ai_settings').update(change).eq('id', true).select('id');
  if (error) throw new Error(`The settings were not saved: ${error.message}`);
  if (!data || data.length === 0) throw new Error('The settings were not saved: only an admin can change them.');
}

export const formatGbp = (v: number) => `£${v.toFixed(v < 1 ? 4 : 2)}`;
