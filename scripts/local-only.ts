/**
 * The screenshot script signs in with the seed users' local development password, so it must only
 * ever talk to a local app and a local Supabase (Sprint 7; the Supabase check added in Sprint 8, F-39).
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** True only for http(s) on this machine, with no user name or password in the address. */
export function isLocalUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTS.has(u.hostname) && !u.username && !u.password;
}

/** VITE_SUPABASE_URL from the text of a .env file, or null. */
export function supabaseUrlFromEnv(envText: string): string | null {
  for (const raw of envText.split(/\r?\n/)) {
    const m = raw.trim().match(/^VITE_SUPABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return null;
}
