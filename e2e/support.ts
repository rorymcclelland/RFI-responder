/**
 * Sprint 20 (S20-1, S20-4): what every browser acceptance test shares. Two targets:
 *
 * - local (the default): the app and Supabase on this machine, signed in as the fictional seed users
 *   with the local development password from supabase/seed.sql. Refuses any address that is not local,
 *   as the screenshot script does (scripts/local-only.ts).
 * - staging: the sprint's Vercel preview, talking to the staging Supabase project. The users and their
 *   password are made for the run by scripts/e2e-staging-users.ts and passed in by CI; nobody types or
 *   reads them. Requests to the live demo's Supabase project are refused by the browser itself.
 */
import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { allowedRequest, isLocalUrl } from '../scripts/local-only';

export type Target = 'local' | 'staging';
export const TARGET: Target = process.env.E2E_TARGET === 'staging' ? 'staging' : 'local';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';

export interface Person { email: string; name: string }

/** The people the tests play: an admin, and a member who owns nothing and is assigned questions. */
export const PEOPLE: { admin: Person; member: Person } = TARGET === 'staging'
  ? {
    admin: { email: process.env.E2E_ADMIN_EMAIL ?? '', name: process.env.E2E_ADMIN_NAME ?? 'Test Admin' },
    member: { email: process.env.E2E_MEMBER_EMAIL ?? '', name: process.env.E2E_MEMBER_NAME ?? 'Test Member' },
  }
  : {
    admin: { email: 'sarah.chen@example.com', name: 'Sarah Chen' },
    member: { email: 'tom.richardson@example.com', name: 'Tom Richardson' },
  };

const PASSWORD = TARGET === 'staging' ? process.env.E2E_PASSWORD ?? '' : 'LocalDev2026pw';

/** Hosts a staging run must never reach: the live demo's app and Supabase project. */
const FORBIDDEN = (process.env.E2E_FORBIDDEN_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

/** Why this run must not start, or null. Checked once, before any browser opens. */
export function targetProblem(): string | null {
  if (TARGET === 'local') {
    if (!isLocalUrl(BASE_URL)) return `Refusing to sign in to ${BASE_URL}: the seed users and their password exist only on a local install.`;
    return null;
  }
  let u: URL;
  try { u = new URL(BASE_URL); } catch { return `E2E_BASE_URL is not an address: ${BASE_URL}`; }
  if (u.protocol !== 'https:') return 'A staging run needs an https address.';
  if (!FORBIDDEN.length) return 'A staging run needs E2E_FORBIDDEN_HOSTS (the live demo\'s hosts), so it can refuse them.';
  if (FORBIDDEN.includes(u.hostname.toLowerCase())) return `Refusing to run against ${u.hostname}: it is the live demo.`;
  if (!PEOPLE.admin.email || !PEOPLE.member.email || !PASSWORD) return 'A staging run needs E2E_ADMIN_EMAIL, E2E_MEMBER_EMAIL and E2E_PASSWORD from CI.';
  return null;
}

/** Whether the browser may make this request. */
export function requestAllowed(url: string): boolean {
  if (TARGET === 'local') return allowedRequest(url);
  if (url.startsWith('data:') || url.startsWith('blob:')) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !FORBIDDEN.includes(host);
  } catch { return false; }
}

const BYPASS = process.env.E2E_VERCEL_BYPASS ?? '';

/** A fresh browser session, with the request guard and (on staging) Vercel's bypass header for the app's own host only. */
export async function newSession(browser: Browser, viewport = { width: 1280, height: 860 }): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    baseURL: BASE_URL,
    recordVideo: { dir: test.info().outputPath('videos'), size: viewport },
  });
  const appHost = new URL(BASE_URL).host;
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (!requestAllowed(url)) return route.abort('blockedbyclient');
    if (BYPASS && new URL(url).host === appHost) {
      return route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } });
    }
    return route.continue();
  });
  return context;
}

/** Signs in and lands on Home, with the first-sign-in introduction closed. */
export async function signIn(browser: Browser, person: Person, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await newSession(browser, viewport);
  const page = await context.newPage();
  await caption(page, `${person.name} signs in`);
  await page.goto('/');
  await page.locator('input[type=email]').fill(person.email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('input[type=password]').press('Enter');
  await page.getByRole('heading', { name: /^Hello, / }).waitFor();
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
  return page;
}

/**
 * A caption across the bottom of the page, so a recording explains itself without sound (S20-4).
 * Kept across page loads, and recorded as a step in the report.
 */
export async function caption(page: Page, text: string): Promise<void> {
  const draw = (t: string) => {
    const w = window as unknown as { __e2eCaption?: string };
    w.__e2eCaption = t;
    const show = () => {
      let el = document.getElementById('e2e-caption');
      if (!el) {
        el = document.createElement('div');
        el.id = 'e2e-caption';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;'
          + 'background:rgba(17,24,39,.88);color:#fff;font:600 15px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;max-width:90vw;text-align:center';
        document.body.appendChild(el);
      }
      el.textContent = w.__e2eCaption ?? '';
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  };
  await test.step(text, async () => {
    await page.addInitScript(draw, text).catch(() => undefined);
    await page.evaluate(draw, text).catch(() => undefined);
  });
}

/** Goes to a page in the main menu. */
export async function nav(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible().catch(() => false) && (await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

/** Opens a response from the Responses page by its name. */
export async function openResponse(page: Page, name: string) {
  await nav(page, 'Responses');
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole('button', { name: /^(To do|All)/ }).first().waitFor();
}

/** A question's card in an open response, found by its text. */
export function card(page: Page, question: string) {
  return page.locator('[id^="question-"]', { has: page.getByText(question, { exact: true }) });
}

/** Opens a question's card (expands it) if it is not open. */
export async function expand(page: Page, question: string) {
  const c = card(page, question);
  await c.scrollIntoViewIfNeeded();
  if (!(await c.getByText(/Proposed Response|Edit Response|Written answer|Approved|Draft/).first().isVisible().catch(() => false))) {
    await c.getByText(question, { exact: true }).click();
  }
  return c;
}

/** Whether the page scrolls sideways at its current width. */
export async function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
}

/** Tags a test with the agreed case it checks, for the demo page (S20-4): for example `S19 2`. */
export function checks(...cases: string[]) {
  for (const c of cases) test.info().annotations.push({ type: 'case', description: c });
}

export const test = base;
export { expect };
