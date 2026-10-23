/** Checks the build-time settings the app needs before anything touches Supabase. */
export type AppConfig =
  | { ok: true; supabaseUrl: string; supabaseAnonKey: string }
  | { ok: false; missing: string[]; problem?: string };

export const REQUIRED_SETTINGS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

export function readConfig(env: Record<string, string | boolean | undefined>): AppConfig {
  const value = (k: string) => (typeof env[k] === 'string' ? (env[k] as string).trim() : '');
  const missing = REQUIRED_SETTINGS.filter((k) => value(k) === '');
  if (missing.length > 0) return { ok: false, missing };
  // Project rule 3: only the public anon key may reach the browser. A service-role key there
  // bypasses every access rule (found on Rory's PC in the Sprint 2 end-to-end run).
  if (keyRole(value('VITE_SUPABASE_ANON_KEY')) === 'service_role' || /^sb_secret_/.test(value('VITE_SUPABASE_ANON_KEY'))) {
    return {
      ok: false,
      missing: [],
      problem: 'VITE_SUPABASE_ANON_KEY holds the service-role (secret) key. Use the anon (publishable) key from "npx supabase status"; the secret key must never reach the browser.',
    };
  }
  return { ok: true, supabaseUrl: value('VITE_SUPABASE_URL'), supabaseAnonKey: value('VITE_SUPABASE_ANON_KEY') };
}

/** The role claim of a Supabase JWT key, or null if the key is not a JWT. */
export function keyRole(key: string): string | null {
  const part = key.split('.')[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === 'string' ? role : null;
  } catch {
    return null;
  }
}
