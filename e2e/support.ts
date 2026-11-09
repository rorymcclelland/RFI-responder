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

import { BASE_URL, PASSWORD, requestAllowed } from './target';
export { TARGET, BASE_URL, PEOPLE, targetProblem, type Person } from './target';
import type { Person } from './target';

const BYPASS = process.env.E2E_VERCEL_BYPASS ?? '';

/** A fresh browser session, with the request guard and (on staging) Vercel's bypass header for the app's own host only. */
export async function newSession(browser: Browser, viewport = { width: 1280, height: 860 }, label = 'session'): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport,
    baseURL: BASE_URL,
    recordVideo: { dir: test.info().outputPath('videos'), size: viewport },
  });
  opened.push({ context, label });
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
  const context = await newSession(browser, viewport, `${person.name}${viewport && viewport.width < 600 ? ', phone' : ''}`);
  const page = await context.newPage();
  // The app asks before leaving while a decision is saving (Sprint 21); a test that reloads means to
  // leave, and waits for its saves first. Any other dialog is dismissed, as before.
  page.on('dialog', (d) => { void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()); });
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
  // In CI the AI providers are off, so the first sign-in's indexing reports that it could not run;
  // the notice is true but not what a test is about, and it would cover the recording.
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  if (await dismiss.isVisible({ timeout: 1500 }).catch(() => false)) await dismiss.click();
  return page;
}

/**
 * A caption near the top of the page, below the menu (the app's notices appear at the bottom), so a recording explains itself without sound (S20-4).
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
        el.style.cssText = 'position:fixed;left:50%;top:76px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;'
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
    // Rory, 9 November 2026: hold each captioned moment on screen, so a person watching the recording
    // can read the caption and see the page before the test moves on (E2E_CAPTION_HOLD, milliseconds).
    await page.waitForTimeout(CAPTION_HOLD_MS);
  });
}

/** How long each caption stays on screen before the test carries on (Rory, 9 November 2026). */
export const CAPTION_HOLD_MS = Math.max(0, Number(process.env.E2E_CAPTION_HOLD ?? 1500) || 0);

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
  // Sprint 22 (S22-1): the response's page shows its stages once its questions are read.
  await page.getByRole('heading', { name: 'Questions', level: 2 }).waitFor();
}

/** A question's card in an open response, found by its text. */
export function card(page: Page, question: string) {
  return page.locator('[id^="question-"]', { has: page.getByText(question, { exact: true }) });
}

/**
 * Sprint 22 (S22-1): Approved and Not answered are folded while questions are still to do. Unfolds
 * them, so a decided question's card is on the page (QA review).
 */
export async function unfold(page: Page) {
  const folded = page.locator('#stage-questions h3 button[aria-expanded="false"]');
  while (await folded.count()) await folded.first().click();
}

/** Opens a question's card (expands it) if it is not open, unfolding its group first. */
export async function expand(page: Page, question: string) {
  if (!(await card(page, question).count())) await unfold(page);
  const c = card(page, question);
  await c.scrollIntoViewIfNeeded();
  // An open card shows its decision buttons; a closed one shows none.
  if (!(await c.getByRole('button', { name: /^(Approve|Write an answer|Revise Answer|Restore|Edit)$/ }).first().isVisible().catch(() => false))) {
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

/** The browser sessions a test opened, closed at its end so each recording is saved and attached. */
const opened: { context: BrowserContext; label: string }[] = [];

export const test = base.extend<{ recordings: void }>({
  // Playwright reads a fixture's needs from its first argument, so it must be a pattern.
  // eslint-disable-next-line no-empty-pattern
  recordings: [async ({}, use, testInfo) => {
    opened.length = 0;
    await use();
    for (const { context, label } of opened.splice(0)) {
      const pages = context.pages();
      await context.close();
      for (const [i, p] of pages.entries()) {
        const path = await p.video()?.path().catch(() => null);
        if (path) await testInfo.attach(`recording: ${label}${pages.length > 1 ? ` ${i + 1}` : ''}`, { path, contentType: 'video/webm' });
      }
    }
  }, { auto: true }],
});
export { expect };
