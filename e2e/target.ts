/**
 * Sprint 20 (S20-1): where a browser test run may go, and as whom. Kept apart from Playwright so the
 * guard can be unit-tested (target.test.ts).
 */
import { allowedRequest, isLocalUrl } from '../scripts/local-only';

type Env = Record<string, string | undefined>;
export type Target = 'local' | 'staging';
export interface Person { email: string; name: string }

const targetOf = (env: Env): Target => (env.E2E_TARGET === 'staging' ? 'staging' : 'local');
const baseOf = (env: Env) => env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
/** Hosts a staging run must never reach: the live demo's app and Supabase project. */
const forbiddenOf = (env: Env) => (env.E2E_FORBIDDEN_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

/** The people the tests play: an admin, and a member who owns nothing and is assigned questions. */
export function peopleOf(env: Env): { admin: Person; member: Person } {
  return targetOf(env) === 'staging'
    ? {
      admin: { email: env.E2E_ADMIN_EMAIL ?? '', name: env.E2E_ADMIN_NAME ?? 'Test Admin' },
      member: { email: env.E2E_MEMBER_EMAIL ?? '', name: env.E2E_MEMBER_NAME ?? 'Test Member' },
    }
    : {
      admin: { email: 'sarah.chen@example.com', name: 'Sarah Chen' },
      member: { email: 'tom.richardson@example.com', name: 'Tom Richardson' },
    };
}

/** Local: the seed's development password (supabase/seed.sql). Staging: made for the run by CI. */
const passwordOf = (env: Env) => (targetOf(env) === 'staging' ? env.E2E_PASSWORD ?? '' : 'LocalDev2026pw');

/** Why this run must not start, or null. Checked once, before any browser opens. */
export function targetProblem(env: Env = process.env): string | null {
  const base = baseOf(env);
  if (targetOf(env) === 'local') {
    return isLocalUrl(base) ? null : `Refusing to sign in to ${base}: the seed users and their password exist only on a local install.`;
  }
  let u: URL;
  try { u = new URL(base); } catch { return `E2E_BASE_URL is not an address: ${base}`; }
  if (u.protocol !== 'https:') return 'A staging run needs an https address.';
  const forbidden = forbiddenOf(env);
  if (!forbidden.length) return 'A staging run needs E2E_FORBIDDEN_HOSTS (the live demo\'s hosts), so it can refuse them.';
  if (forbidden.includes(u.hostname.toLowerCase())) return `Refusing to run against ${u.hostname}: it is the live demo.`;
  const people = peopleOf(env);
  if (!people.admin.email || !people.member.email || !passwordOf(env)) return 'A staging run needs E2E_ADMIN_EMAIL, E2E_MEMBER_EMAIL and E2E_PASSWORD from CI.';
  return null;
}

/** Whether the browser may make this request. */
export function requestAllowedIn(env: Env, url: string): boolean {
  if (targetOf(env) === 'local') return allowedRequest(url);
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  try {
    return !forbiddenOf(env).includes(new URL(url).hostname.toLowerCase());
  } catch { return false; }
}

export const TARGET = targetOf(process.env);
export const BASE_URL = baseOf(process.env);
export const PEOPLE = peopleOf(process.env);
export const PASSWORD = passwordOf(process.env);
export const requestAllowed = (url: string) => requestAllowedIn(process.env, url);
