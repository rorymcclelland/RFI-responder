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

/** Every VITE_SUPABASE_URL in the text of a .env file, in order (a later one wins in Vite). */
export function supabaseUrlsFromEnv(envText: string): string[] {
  return envText.split(/\r?\n/)
    .map((raw) => raw.trim().match(/^VITE_SUPABASE_URL\s*=\s*(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1].trim().replace(/^(['"])(.*)\1$/, '$2'));
}

/** The first VITE_SUPABASE_URL in the text of a .env file, or null. */
export function supabaseUrlFromEnv(envText: string): string | null {
  return supabaseUrlsFromEnv(envText)[0] ?? null;
}

/** Hosts the app loads that carry no credentials: the Inter font (src/index.css). */
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

/**
 * Whether the screenshot browser may make a request (security review, Sprint 8): only to this
 * machine, inline data, or the font hosts. Anything else is refused by the browser itself, so a
 * hosted Supabase address from any source (.env, .env.local, the shell) never receives the password.
 */
export function allowedRequest(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (isLocalUrl(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && FONT_HOSTS.has(u.hostname);
  } catch { return false; }
}
