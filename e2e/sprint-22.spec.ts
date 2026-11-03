/**
 * Sprint 22's agreed cases (docs/refinement/sprint-22.md), as browser tests.
 */
import { test, expect, PEOPLE, signIn, caption, checks, nav } from './support';
import { requestAllowed } from './target';
import type { Page } from '@playwright/test';

const { admin } = PEOPLE;

// ── S22-2: plain settings, spend by use, and the audit log by person and response ───────────────

async function governance(page: Page, tab: string) {
  await nav(page, 'Governance');
  await page.getByRole('tab', { name: tab }).click();
}

test('Plain settings first, the tuning under Advanced, and spend by use', async ({ browser }) => {
  checks('S22-2 1');
  const page = await signIn(browser, admin);
  await governance(page, 'Usage and limits');
  await caption(page, 'What an admin changes most often is in view: the budget, the warning point and the daily limits');
  for (const label of ['Monthly budget (£)', 'Warn admins at (% of budget)', 'Questions per person per day', 'Review knowledge-base entries every (months)']) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Spend by use', { exact: true })).toBeVisible();
  // The tuning is one click away, closed until opened.
  const advanced = page.locator('details').filter({ hasText: 'Advanced: reserves, exchange rate, prices and spend by model' });
  await expect(page.getByLabel('Reserve per question (US$)', { exact: true })).toBeHidden();
  await expect(page.getByLabel('Pounds per US dollar', { exact: true })).toBeHidden();
  await caption(page, 'Advanced holds the reserves, the exchange rate, the prices and the spend by model');
  await advanced.locator('summary').click();
  await expect(page.getByLabel('Reserve per question (US$)', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Pounds per US dollar', { exact: true })).toBeVisible();
  await expect(advanced.getByText('Spend by model', { exact: true })).toBeVisible();
  await expect(advanced.getByText('Prices used for the estimates', { exact: false })).toBeVisible();

  // Saving from either part works and is audited. The values are saved as they are, so nothing on
  // the target changes.
  await caption(page, 'Saving from either part works, and the change is in the audit log');
  await page.getByRole('button', { name: 'Save advanced settings' }).click();
  await expect(advanced.getByRole('status').filter({ hasText: 'Saved. The change is in the audit log.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. The change is in the audit log.' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Settings and prices' });
  await page.getByLabel('Person', { exact: true }).selectOption({ label: admin.name });
  await expect(page.getByRole('list', { name: 'Audit log' }).getByRole('listitem').first()).toContainText('Changed the limits');
});

test('The audit log by person and by response, with the kind, together', async ({ browser }) => {
  checks('S22-2 3', 'S22-2 4', 'S22-2 5');
  const page = await signIn(browser, admin);
  await governance(page, 'Audit log');
  const log = page.getByRole('list', { name: 'Audit log' });
  await expect(log).toBeVisible();

  await caption(page, 'One person: only what they did');
  await page.getByLabel('Person', { exact: true }).selectOption({ label: admin.name });
  await expect(log.getByRole('listitem').first()).toBeVisible();
  for (const meta of await log.locator('li > p:nth-child(2)').allInnerTexts()) expect(meta.startsWith(`${admin.name} · `)).toBe(true);

  // Larkspur was marked as sent again by the admin in the Sprint 21 tests, earlier in this run.
  await caption(page, 'One response: what happened to it, its files and its questions');
  await page.getByLabel('Person', { exact: true }).selectOption({ label: 'Anyone' });
  await page.getByLabel('Response', { exact: true }).selectOption({ label: 'Larkspur Health (fictional): data platform RFI' });
  await expect(log.getByRole('listitem').filter({ hasText: /^Marked as sent/ }).first()).toBeVisible();
  // Nothing about settings, people or the knowledge base belongs to a response.
  await expect(log.getByRole('listitem').filter({ hasText: /Changed the limits|admin rights|Invited|Reviewed KB-/ })).toHaveCount(0);

  await caption(page, 'All three together: marked as sent, by this admin, on this response');
  await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Exports and changes after export' });
  await page.getByLabel('Person', { exact: true }).selectOption({ label: admin.name });
  const rows = log.getByRole('listitem');
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.allInnerTexts()) {
    expect(text).toMatch(/^(Marked as sent|Changed a question after the response was marked as sent)/);
    expect(text).toContain(`${admin.name} · `);
  }
  await page.getByRole('button', { name: 'Clear the filters' }).click();
  await expect(page.getByLabel('Response', { exact: true })).toHaveValue('');
});

test('The audit log says when more entries match than it shows', async ({ browser }) => {
  checks('S22-2 5');
  const page = await signIn(browser, admin);
  // The database's limit and its "more" flag are database case 5; here the page is given a reply
  // with more to show how it says so.
  await page.route('**/rest/v1/rpc/audit_log_search', async (route) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch();
    const body = (await res.json()) as { rows: unknown[]; more: boolean };
    await route.fulfill({ response: res, json: { ...body, more: true } });
  });
  await governance(page, 'Audit log');
  await caption(page, 'When more than 200 match, the log says so, and how to see older ones');
  await expect(page.getByRole('status').filter({ hasText: 'older entries match too' })).toBeVisible();
});

test('Names with markup show as text in the audit log\'s filters and rows', async ({ browser }) => {
  checks('S22-2 7');
  const page = await signIn(browser, admin);
  const markup = '<img src=x onerror="document.title=\'pwned\'"> <b>Markup (S22)</b>';
  // Names are stored as people type them; here one with markup is added to what the database
  // returned, as a hostile name would put it there, to see how the page shows it.
  const guard = async (route: Parameters<Parameters<Page['route']>[1]>[0], change: (body: unknown) => unknown) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch();
    await route.fulfill({ response: res, json: change(await res.json()) });
  };
  await page.route('**/rest/v1/rpc/audit_log_people', (route) => guard(route, (b) => [{ id: '00000000-0000-4000-8000-000000000022', name: markup }, ...(b as unknown[])]));
  await page.route((url) => url.pathname.endsWith('/rest/v1/opportunities') && url.searchParams.get('select') === 'id,name', (route) => guard(route, (b) => [{ id: '00000000-0000-4000-8000-000000000023', name: markup }, ...(b as unknown[])]));
  await page.route('**/rest/v1/rpc/audit_log_search', (route) => guard(route, (b) => {
    const body = b as { rows: Record<string, unknown>[]; more: boolean };
    return { ...body, rows: [{ id: -1, at: new Date().toISOString(), action: 'response.deleted', actor: null, actorName: markup, targetId: null, details: { name: markup, questions: 1, reason: markup } }, ...body.rows] };
  }));
  await governance(page, 'Audit log');
  await caption(page, 'A name containing markup shows as the text it is, in the filters and in the log');
  await expect(page.getByRole('list', { name: 'Audit log' }).getByText(`${markup} · `, { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel('Person', { exact: true }).locator('option', { hasText: 'Markup (S22)' })).toHaveCount(1);
  await expect(page.getByLabel('Response', { exact: true }).locator('option', { hasText: 'Markup (S22)' })).toHaveCount(1);
  await expect(page.locator('ul[aria-label="Audit log"] img, ul[aria-label="Audit log"] b')).toHaveCount(0);
  expect(await page.title()).not.toBe('pwned');
});
