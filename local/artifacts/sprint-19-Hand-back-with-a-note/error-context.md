# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sprint-19.spec.ts >> Hand back, with a note
- Location: e2e/sprint-19.spec.ts:111:1

# Error details

```
Test timeout of 120000ms exceeded.
```

```
Error: locator.waitFor: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('heading', { name: /^Hello, / }) to be visible

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]: RFI Respond
        - navigation [ref=e11]:
          - button "Home" [ref=e12] [cursor=pointer]
          - button "Responses" [ref=e17] [cursor=pointer]
          - button "Knowledge" [ref=e22] [cursor=pointer]
          - button "Assignments" [ref=e28] [cursor=pointer]
          - button "Team" [ref=e33] [cursor=pointer]
          - button "Governance" [ref=e40] [cursor=pointer]
        - generic [ref=e46]:
          - button "Help" [ref=e48] [cursor=pointer]
          - generic [ref=e53]:
            - generic [ref=e54]: S
            - generic [ref=e55]:
              - paragraph [ref=e56]: Sarah Chen
              - paragraph [ref=e57]: Admin
            - button "Sign out" [ref=e58] [cursor=pointer]
    - main [ref=e62]:
      - generic [ref=e63]:
        - generic [ref=e64]:
          - heading "Welcome" [level=1] [ref=e65]
          - paragraph [ref=e66]: What needs you today, your responses, and what the organisation knows.
        - generic [ref=e67]:
          - generic [ref=e68]:
            - region [ref=e69]:
              - heading "Needs you" [level=2] [ref=e70]
              - generic [ref=e71]:
                - paragraph [ref=e72]: For admins (1)
                - list [ref=e73]:
                  - listitem [ref=e74]:
                    - button "Answers to review 30 translations to check, 2 proposed changes" [ref=e75] [cursor=pointer]:
                      - generic [ref=e76]:
                        - generic [ref=e77]: Answers to review
                        - generic [ref=e78]: 30 translations to check, 2 proposed changes
            - region [ref=e81]:
              - heading "Your responses" [level=2] [ref=e82]
              - paragraph [ref=e83]: You own no response in progress.
              - list
          - complementary "What we know" [ref=e84]:
            - generic [ref=e85]:
              - heading "What we know" [level=2] [ref=e86]
              - paragraph [ref=e87]: 130 answers, 100 in English and 30 in Japanese. 100 reviewed and current, 0 waiting for review and 30 translations to check.
              - button "Open Knowledge" [ref=e88] [cursor=pointer]
            - region [ref=e91]:
              - generic [ref=e92]:
                - heading "Ask it a question" [level=2] [ref=e93]
                - paragraph [ref=e97]: Type a question as a customer would. You see the answer it would draft, and why, before any questionnaire arrives. Nothing about your question is saved; it counts towards your daily limit like a question in a response.
              - generic [ref=e98]:
                - generic [ref=e99]:
                  - generic [ref=e100]: Your question
                  - textbox "Your question" [ref=e101]:
                    - /placeholder: How do you encrypt customer data at rest?
                - button "Ask" [disabled] [ref=e102]
  - generic [aria-hidden]: Sarah Chen signs in
```

# Test source

```ts
  1   | /**
  2   |  * Sprint 20 (S20-1, S20-4): what every browser acceptance test shares. Two targets:
  3   |  *
  4   |  * - local (the default): the app and Supabase on this machine, signed in as the fictional seed users
  5   |  *   with the local development password from supabase/seed.sql. Refuses any address that is not local,
  6   |  *   as the screenshot script does (scripts/local-only.ts).
  7   |  * - staging: the sprint's Vercel preview, talking to the staging Supabase project. The users and their
  8   |  *   password are made for the run by scripts/e2e-staging-users.ts and passed in by CI; nobody types or
  9   |  *   reads them. Requests to the live demo's Supabase project are refused by the browser itself.
  10  |  */
  11  | import { test as base, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
  12  | 
  13  | import { BASE_URL, PASSWORD, requestAllowed } from './target';
  14  | export { TARGET, BASE_URL, PEOPLE, targetProblem, type Person } from './target';
  15  | import type { Person } from './target';
  16  | 
  17  | const BYPASS = process.env.E2E_VERCEL_BYPASS ?? '';
  18  | 
  19  | /** A fresh browser session, with the request guard and (on staging) Vercel's bypass header for the app's own host only. */
  20  | export async function newSession(browser: Browser, viewport = { width: 1280, height: 860 }, label = 'session'): Promise<BrowserContext> {
  21  |   const context = await browser.newContext({
  22  |     viewport,
  23  |     baseURL: BASE_URL,
  24  |     recordVideo: { dir: test.info().outputPath('videos'), size: viewport },
  25  |   });
  26  |   opened.push({ context, label });
  27  |   const appHost = new URL(BASE_URL).host;
  28  |   await context.route('**/*', (route) => {
  29  |     const url = route.request().url();
  30  |     if (!requestAllowed(url)) return route.abort('blockedbyclient');
  31  |     if (BYPASS && new URL(url).host === appHost) {
  32  |       return route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': BYPASS, 'x-vercel-set-bypass-cookie': 'true' } });
  33  |     }
  34  |     return route.continue();
  35  |   });
  36  |   return context;
  37  | }
  38  | 
  39  | /** Signs in and lands on Home, with the first-sign-in introduction closed. */
  40  | export async function signIn(browser: Browser, person: Person, viewport?: { width: number; height: number }): Promise<Page> {
  41  |   const context = await newSession(browser, viewport, `${person.name}${viewport && viewport.width < 600 ? ', phone' : ''}`);
  42  |   const page = await context.newPage();
  43  |   await caption(page, `${person.name} signs in`);
  44  |   await page.goto('/');
  45  |   await page.locator('input[type=email]').fill(person.email);
  46  |   await page.locator('input[type=password]').fill(PASSWORD);
  47  |   await page.locator('input[type=password]').press('Enter');
> 48  |   await page.getByRole('heading', { name: /^Hello, / }).waitFor();
      |                                                         ^ Error: locator.waitFor: Target page, context or browser has been closed
  49  |   const dialog = page.getByRole('dialog');
  50  |   if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
  51  |     await page.keyboard.press('Escape');
  52  |     await dialog.waitFor({ state: 'hidden' });
  53  |   }
  54  |   return page;
  55  | }
  56  | 
  57  | /**
  58  |  * A caption across the bottom of the page, so a recording explains itself without sound (S20-4).
  59  |  * Kept across page loads, and recorded as a step in the report.
  60  |  */
  61  | export async function caption(page: Page, text: string): Promise<void> {
  62  |   const draw = (t: string) => {
  63  |     const w = window as unknown as { __e2eCaption?: string };
  64  |     w.__e2eCaption = t;
  65  |     const show = () => {
  66  |       let el = document.getElementById('e2e-caption');
  67  |       if (!el) {
  68  |         el = document.createElement('div');
  69  |         el.id = 'e2e-caption';
  70  |         el.setAttribute('aria-hidden', 'true');
  71  |         el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;'
  72  |           + 'background:rgba(17,24,39,.88);color:#fff;font:600 15px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:10px;max-width:90vw;text-align:center';
  73  |         document.body.appendChild(el);
  74  |       }
  75  |       el.textContent = w.__e2eCaption ?? '';
  76  |     };
  77  |     if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  78  |   };
  79  |   await test.step(text, async () => {
  80  |     await page.addInitScript(draw, text).catch(() => undefined);
  81  |     await page.evaluate(draw, text).catch(() => undefined);
  82  |   });
  83  | }
  84  | 
  85  | /** Goes to a page in the main menu. */
  86  | export async function nav(page: Page, name: string) {
  87  |   const menu = page.getByRole('button', { name: 'Menu', exact: true });
  88  |   if (await menu.isVisible().catch(() => false) && (await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
  89  |   await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
  90  | }
  91  | 
  92  | /** Opens a response from the Responses page by its name. */
  93  | export async function openResponse(page: Page, name: string) {
  94  |   await nav(page, 'Responses');
  95  |   await page.getByText(name, { exact: true }).first().click();
  96  |   await page.getByRole('button', { name: /^(To do|All)/ }).first().waitFor();
  97  | }
  98  | 
  99  | /** A question's card in an open response, found by its text. */
  100 | export function card(page: Page, question: string) {
  101 |   return page.locator('[id^="question-"]', { has: page.getByText(question, { exact: true }) });
  102 | }
  103 | 
  104 | /** Opens a question's card (expands it) if it is not open. */
  105 | export async function expand(page: Page, question: string) {
  106 |   const c = card(page, question);
  107 |   await c.scrollIntoViewIfNeeded();
  108 |   // An open card shows its decision buttons; a closed one shows none.
  109 |   if (!(await c.getByRole('button', { name: /^(Approve|Write an answer|Revise Answer|Restore|Edit)$/ }).first().isVisible().catch(() => false))) {
  110 |     await c.getByText(question, { exact: true }).click();
  111 |   }
  112 |   return c;
  113 | }
  114 | 
  115 | /** Whether the page scrolls sideways at its current width. */
  116 | export async function scrollsSideways(page: Page): Promise<boolean> {
  117 |   return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  118 | }
  119 | 
  120 | /** Tags a test with the agreed case it checks, for the demo page (S20-4): for example `S19 2`. */
  121 | export function checks(...cases: string[]) {
  122 |   for (const c of cases) test.info().annotations.push({ type: 'case', description: c });
  123 | }
  124 | 
  125 | /** The browser sessions a test opened, closed at its end so each recording is saved and attached. */
  126 | const opened: { context: BrowserContext; label: string }[] = [];
  127 | 
  128 | export const test = base.extend<{ recordings: void }>({
  129 |   // Playwright reads a fixture's needs from its first argument, so it must be a pattern.
  130 |   // eslint-disable-next-line no-empty-pattern
  131 |   recordings: [async ({}, use, testInfo) => {
  132 |     opened.length = 0;
  133 |     await use();
  134 |     for (const { context, label } of opened.splice(0)) {
  135 |       const pages = context.pages();
  136 |       await context.close();
  137 |       for (const [i, p] of pages.entries()) {
  138 |         const path = await p.video()?.path().catch(() => null);
  139 |         if (path) await testInfo.attach(`recording: ${label}${pages.length > 1 ? ` ${i + 1}` : ''}`, { path, contentType: 'video/webm' });
  140 |       }
  141 |     }
  142 |   }, { auto: true }],
  143 | });
  144 | export { expect };
  145 | 
```