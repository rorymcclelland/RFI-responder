/**
 * Screenshots for the README and the user guide, and a layout check at 768 px (Sprint 7, S7-7 and
 * S7-4; the guide's views and the introduction since Sprint 10, S10-4).
 * Run on Rory's PC against the local app, after `npx supabase db reset` has loaded the demo seed:
 *
 *   npx playwright install chromium     (once; a test browser, about 150 MB)
 *   npm run screenshots
 *
 * Signs in as the fictional seed users with the local development password from supabase/seed.sql,
 * so it refuses any address other than localhost, for the app and for the Supabase address in .env. Writes docs/screenshots/*.png and
 * docs/screenshots/layout-check.json (each view at 768 px: whether the page scrolls sideways).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { allowedRequest, isLocalUrl, supabaseUrlsFromEnv } from './local-only';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5173';
if (!isLocalUrl(BASE)) {
  console.error(`Refusing to sign in to ${BASE}: the seed users and their password exist only on a local install.`);
  process.exit(1);
}
// Sprint 8 (F-39): the app could be local but pointed at a hosted Supabase; refuse that too.
// Every place Vite reads the address from (security review, Sprint 8), and the browser below refuses
// any request that is not local in any case.
const SUPABASE = [
  ...['.env', '.env.local'].flatMap((f) => (existsSync(join(process.cwd(), f)) ? supabaseUrlsFromEnv(readFileSync(join(process.cwd(), f), 'utf8')) : [])),
  ...(process.env.VITE_SUPABASE_URL ? [process.env.VITE_SUPABASE_URL] : []),
];
const notLocal = SUPABASE.filter((u) => !isLocalUrl(u));
if (SUPABASE.length === 0 || notLocal.length) {
  console.error(`Refusing to sign in: the app's Supabase address is ${notLocal[0] ?? 'not set'}, not a local Supabase.`);
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? 'LocalDev2026pw';
const OUT = join(process.cwd(), 'docs/screenshots');
const WIDE = { width: 1280, height: 860 };
const NARROW = { width: 768, height: 1024 };

const layout: { view: string; scrollWidth: number; clientWidth: number; fits: boolean }[] = [];

/** A fresh browser session for each user, so no sign-out is needed between them. */
async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ viewport: WIDE });
  await context.route('**/*', (route) => (allowedRequest(route.request().url()) ? route.continue() : route.abort('blockedbyclient')));
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('input[type=password]').press('Enter');
  await page.getByRole('button', { name: 'Responses', exact: true }).first().waitFor();
  await page.waitForLoadState('networkidle');
  await dismissIntroduction(page);
  return page;
}

/**
 * The seed users have not seen the introduction, so it opens on their first sign-in (S10-6).
 * Skipping it records that on the local seed; `npm run db:reset` brings it back.
 */
async function dismissIntroduction(page: Page) {
  const dialog = page.getByRole('dialog');
  if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  }
}

async function openHelp(page: Page, item: 'Open the guide' | 'Show the introduction') {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
  await page.waitForLoadState('networkidle');
}

async function nav(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.waitForLoadState('networkidle');
}

async function openResponse(page: Page, name: string) {
  await nav(page, 'Responses');
  // Sprint 17 (U-1): the card's link reads "Open"; the whole card opens the response.
  await page.getByText(name, { exact: true }).first().click();
  await page.waitForLoadState('networkidle');
}

async function shoot(page: Page, file: string, view: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, file) });
  await page.setViewportSize(NARROW);
  await page.waitForTimeout(500);
  const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  layout.push({ view, ...m, fits: m.scrollWidth <= m.clientWidth });
  await page.setViewportSize(WIDE);
  await page.waitForTimeout(300);
  console.log(`  ${file}${m.scrollWidth <= m.clientWidth ? '' : `  (does not fit 768 px: ${m.scrollWidth} > ${m.clientWidth})`}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Priya owns the response in review; the bulk bar and her questions are what an owner sees.
  let page = await signIn(browser, 'priya.sharma@example.com');
  await shoot(page, '1-overview.png', 'overview');
  await openResponse(page, 'Bluefin Freight (fictional): security questionnaire');
  await shoot(page, '2-review.png', 'review list');
  await page.getByText('How do you protect data at rest in your platform?', { exact: true }).click();
  await shoot(page, '3-draft-and-checker.png', 'card expanded');
  await page.getByText('What is the annual subscription price for 250 users?', { exact: true }).click();
  await shoot(page, '4-pricing-held.png', 'pricing card');
  // Assigning: the data-at-rest question again, with the list of suggested people open.
  await page.getByText('How do you protect data at rest in your platform?', { exact: true }).click();
  await page.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  // The list opens below the fold: bring it into view.
  await page.getByText('Top pick').first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shoot(page, '11-assign.png', 'assigning a question');

  // Tom owns the new response: the upload, and choosing the question column of a sample file.
  page = await signIn(browser, 'tom.richardson@example.com');
  await openResponse(page, 'Juniper Utilities (fictional): vendor security questionnaire');
  await shoot(page, '9-upload.png', 'upload');
  await page.locator('input[type=file]').setInputFiles(join(process.cwd(), 'sample-data/sample-questions.csv'));
  await page.getByText('Map Your Columns').waitFor();
  await shoot(page, '10-mapping.png', 'column mapping');

  // James was assigned a question by Priya, and owns the exported response.
  page = await signIn(browser, 'james.okafor@example.com');
  await nav(page, 'Assignments');
  await shoot(page, '5-assignments.png', 'assignments');
  await openResponse(page, 'Larkspur Health (fictional): data platform RFI');
  await shoot(page, '6-export-and-learning.png', 'exported response');

  // Sarah is the admin: governance, and the entries waiting for review (the seeded Japanese translations
  // come first, oldest first; James's learned edit is further down).
  page = await signIn(browser, 'sarah.chen@example.com');
  await nav(page, 'Governance');
  await shoot(page, '7-governance-usage.png', 'governance usage');
  await page.getByRole('tab', { name: 'Entries to review' }).click();
  await page.waitForLoadState('networkidle');
  await shoot(page, '8-entries-to-review.png', 'entries to review');
  await page.getByRole('tab', { name: 'Usage and limits' }).click();
  // To the top of the window, below the sticky header (it is partly visible already, so
  // scrollIntoViewIfNeeded would not move it; found in the Sprint 10 run).
  await page.getByText('Limits', { exact: true }).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96 }));
  await shoot(page, '13-governance-limits.png', 'governance limits');
  // Sprint 11 (S11-9): the audit log.
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await page.getByText(/Recorded the export|Reviewed KB-|Changed the limits|Nothing recorded yet/).first().waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await shoot(page, '16-audit-log.png', 'audit log');

  // Sprint 17 (K-1): the knowledge base is a page of its own. The overview, then all answers with one chosen.
  await nav(page, 'Knowledge');
  await page.getByText('What we know', { exact: true }).waitFor();
  await shoot(page, '17-knowledge.png', 'knowledge overview');
  await page.getByRole('button', { name: 'Browse all answers' }).click();
  await page.getByRole('region', { name: 'Answers' }).getByRole('button').first().click();
  await page.getByRole('complementary', { name: 'Selected answer' }).waitFor();
  await shoot(page, '18-knowledge-browse.png', 'knowledge browse');
  // Sprint 18 (S18-2): one answer's page, with the change proposed for it and where it was used.
  await page.getByLabel('Search by number or words').fill('KB-0015');
  await page.getByRole('region', { name: 'Answers' }).getByRole('button', { name: /KB-0015/ }).click();
  await page.getByText('A proposed change is waiting').waitFor();
  // The ask box sits above the list: bring the answer's page to the top, below the sticky header.
  await page.getByRole('complementary', { name: 'Selected answer' }).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96 }));
  await shoot(page, '19-answer-page.png', 'an answer and its history');
  // Sprint 18 (S18-4): asking it a question. It needs the Edge Functions running with their keys
  // (npx supabase functions serve); without them the run carries on without this picture.
  await page.getByLabel('Search by number or words').fill('');
  await page.getByPlaceholder('How do you encrypt customer data at rest?').fill('How do you encrypt customer data at rest?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const answered = await page.getByText('Answers it drew on').waitFor({ timeout: 60000 }).then(() => true, () => false);
  if (answered) {
    await page.getByRole('region', { name: 'Ask it a question' }).evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 96 }));
    await shoot(page, '20-ask.png', 'asking it a question');
  } else {
    console.log('  20-ask.png skipped: the question was not answered (are the Edge Functions running?)');
  }

  // Importing into the knowledge base: the synthetic Q&A file, at the column mapping.
  await page.getByRole('button', { name: 'Import a spreadsheet' }).click();
  await page.locator('.fixed.inset-0 input[type=file]').setInputFiles(join(process.cwd(), 'sample-data/security-qa.csv'));
  await page.getByText('Preview Import').waitFor();
  await shoot(page, '12-kb-import.png', 'knowledge-base import');
  await page.keyboard.press('Escape');
  await page.goto(BASE);
  await page.waitForLoadState('networkidle');
  await dismissIntroduction(page);

  // Help, and the introduction opened from it (at the step on how a draft is made).
  await openHelp(page, 'Open the guide');
  await shoot(page, '15-help.png', 'help');
  await openHelp(page, 'Show the introduction');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /^Next/ }).click();
  await shoot(page, '14-introduction.png', 'introduction');
  await page.keyboard.press('Escape');

  await browser.close();
  writeFileSync(join(OUT, 'layout-check.json'), JSON.stringify({ width: NARROW.width, checkedAt: new Date().toISOString(), views: layout }, null, 1) + '\n');
  const misfits = layout.filter((v) => !v.fits);
  console.log(misfits.length ? `${misfits.length} views do not fit 768 px: ${misfits.map((v) => v.view).join(', ')}` : 'Every view fits 768 px.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
