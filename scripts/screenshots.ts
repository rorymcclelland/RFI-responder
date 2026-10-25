/**
 * Screenshots for the README, and a layout check at 768 px (Sprint 7, S7-7 and S7-4).
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
import { isLocalUrl, supabaseUrlFromEnv } from './local-only';

const BASE = process.env.APP_URL ?? 'http://localhost:5173';
if (!isLocalUrl(BASE)) {
  console.error(`Refusing to sign in to ${BASE}: the seed users and their password exist only on a local install.`);
  process.exit(1);
}
// Sprint 8 (F-39): the app could be local but pointed at a hosted Supabase; refuse that too.
const ENV = join(process.cwd(), '.env');
const SUPABASE = existsSync(ENV) ? supabaseUrlFromEnv(readFileSync(ENV, 'utf8')) : null;
if (!SUPABASE || !isLocalUrl(SUPABASE)) {
  console.error(`Refusing to sign in: .env points the app at ${SUPABASE ?? 'no Supabase address'}, not a local Supabase.`);
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD ?? 'LocalDev2026pw';
const OUT = join(process.cwd(), 'docs/screenshots');
const WIDE = { width: 1280, height: 860 };
const NARROW = { width: 768, height: 1024 };

const layout: { view: string; scrollWidth: number; clientWidth: number; fits: boolean }[] = [];

/** A fresh browser session for each user, so no sign-out is needed between them. */
async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: WIDE })).newPage();
  await page.goto(BASE);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(PASSWORD);
  await page.locator('input[type=password]').press('Enter');
  await page.getByRole('button', { name: 'Opportunities' }).waitFor();
  await page.waitForLoadState('networkidle');
  return page;
}

async function nav(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).first().click();
  await page.waitForLoadState('networkidle');
}

async function openResponse(page: Page, name: string) {
  await nav(page, 'Opportunities');
  const card = page.locator('div', { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByText('Open workspace') }).last();
  await card.getByText('Open workspace').click();
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

  // James was assigned a question by Priya, and owns the exported response.
  page = await signIn(browser, 'james.okafor@example.com');
  await nav(page, 'Assignments');
  await shoot(page, '5-assignments.png', 'assignments');
  await openResponse(page, 'Larkspur Health (fictional): data platform RFI');
  await shoot(page, '6-export-and-learning.png', 'exported response');

  // Sarah is the admin: governance, and James's edit waiting for review.
  page = await signIn(browser, 'sarah.chen@example.com');
  await nav(page, 'Governance');
  await shoot(page, '7-governance-usage.png', 'governance usage');
  await page.getByRole('tab', { name: 'Entries to review' }).click();
  await page.waitForLoadState('networkidle');
  await shoot(page, '8-entries-to-review.png', 'entries to review');

  await browser.close();
  writeFileSync(join(OUT, 'layout-check.json'), JSON.stringify({ width: NARROW.width, checkedAt: new Date().toISOString(), views: layout }, null, 1) + '\n');
  const misfits = layout.filter((v) => !v.fits);
  console.log(misfits.length ? `${misfits.length} views do not fit 768 px: ${misfits.map((v) => v.view).join(', ')}` : 'Every view fits 768 px.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
