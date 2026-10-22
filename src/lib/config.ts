/** Checks the build-time settings the app needs before anything touches Supabase. */
export type AppConfig =
  | { ok: true; supabaseUrl: string; supabaseAnonKey: string }
  | { ok: false; missing: string[] };

export const REQUIRED_SETTINGS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

export function readConfig(env: Record<string, string | boolean | undefined>): AppConfig {
  const value = (k: string) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  const missing = REQUIRED_SETTINGS.filter((k) => value(k) === '');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, supabaseUrl: value('VITE_SUPABASE_URL'), supabaseAnonKey: value('VITE_SUPABASE_ANON_KEY') };
}
