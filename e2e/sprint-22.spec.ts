/**
 * Sprint 22's agreed cases (docs/refinement/sprint-22.md), as browser tests.
 */
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, card, expand, unfold, scrollsSideways } from './support';
import { requestAllowed } from './target';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const { admin, member } = PEOPLE;

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
  await caption(page, 'Saving from either part works, and each save is in the audit log');
  const settingsRows = async () => {
    await page.getByRole('tab', { name: 'Audit log' }).click();
    await page.getByLabel('Show', { exact: true }).selectOption({ label: 'Settings and prices' });
    await page.getByLabel('Person', { exact: true }).selectOption({ label: admin.name });
    const list = page.getByRole('list', { name: 'Audit log' });
    await expect(list.or(page.getByText('Nothing recorded that matches these filters.'))).toBeVisible();
    const n = await list.getByRole('listitem').filter({ hasText: 'Changed the limits' }).count();
    await page.getByRole('tab', { name: 'Usage and limits' }).click();
    await advanced.locator('summary').waitFor();
    if (!(await advanced.evaluate((d) => (d as HTMLDetailsElement).open))) await advanced.locator('summary').click();
    return n;
  };
  const before = await settingsRows();
  test.skip(before >= 198, 'The newest 200 are settings rows by this admin: a count would not move');
  await page.getByRole('button', { name: 'Save advanced settings' }).click();
  await expect(advanced.getByRole('status').filter({ hasText: 'Saved. The change is in the audit log.' })).toBeVisible();
  await page.getByRole('button', { name: 'Save limits' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. The change is in the audit log.' }).first()).toBeVisible();
  await expect.poll(settingsRows).toBe(before + 2);
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
  // Its questions' rows too: the admin changed Larkspur's answers after it was sent.
  await expect(log.getByRole('listitem').filter({ hasText: /^Changed a question after the response was marked as sent/ }).first()).toBeVisible();
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
    const res = await route.fetch({ maxRedirects: 0 });
    const body = (await res.json()) as { rows: unknown[]; more: boolean };
    await route.fulfill({ response: res, json: { ...body, more: true } });
  });
  await governance(page, 'Audit log');
  await caption(page, 'When more than 200 match, the log says so, and how to see older ones');
  await expect(page.getByRole('status').filter({ hasText: 'older entries match too' })).toBeVisible();
});

test('Someone whose account was deleted is a former user in the person filter and the rows', async ({ browser }) => {
  checks('S22-2 3');
  const page = await signIn(browser, admin);
  const gone = '00000000-0000-4000-8000-0000000000a1';
  // The database keeps who acted after a profile is deleted, with no name (database case 3); here
  // such a person is added to what it returned, to see how the page shows them.
  const guard = async (route: Parameters<Parameters<Page['route']>[1]>[0], change: (body: unknown) => unknown) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch({ maxRedirects: 0 });
    await route.fulfill({ response: res, json: change(await res.json()) });
  };
  await page.route('**/rest/v1/rpc/audit_log_people', (route) => guard(route, (b) => [...(b as unknown[]), { id: gone, name: null }]));
  await page.route('**/rest/v1/rpc/audit_log_search', (route) => guard(route, (b) => {
    const body = b as { rows: Record<string, unknown>[]; more: boolean };
    return { ...body, rows: [{ id: -2, at: new Date().toISOString(), action: 'question.held', actor: gone, actorName: null, targetId: null, details: { to: 'stale_source' } }, ...body.rows] };
  }));
  await governance(page, 'Audit log');
  await caption(page, 'A person whose account was deleted shows as a former user');
  await expect(page.getByLabel('Person', { exact: true }).locator('option', { hasText: 'Former user' })).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Audit log' }).getByText(/^Former user · /).first()).toBeVisible();
});

test('Names with markup show as text in the audit log\'s filters and rows', async ({ browser }) => {
  checks('S22-2 7');
  const page = await signIn(browser, admin);
  const markup = '<img src=x onerror="document.title=\'pwned\'"> <b>Markup (S22)</b>';
  // Names are stored as people type them; here one with markup is added to what the database
  // returned, as a hostile name would put it there, to see how the page shows it.
  const guard = async (route: Parameters<Parameters<Page['route']>[1]>[0], change: (body: unknown) => unknown) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch({ maxRedirects: 0 });
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

// ── S22-1: the response as a journey ─────────────────────────────────────────────────────────────

const BLUEFIN = 'Bluefin Freight (fictional): security questionnaire';
const HARBOUR = 'Harbour Logistics (fictional): RFQ security schedule';
const PRICING = 'What is the annual subscription price for 250 users?'; // Bluefin: pricing, never drafted
const ACCESS = 'Describe how user access is granted, reviewed and removed.'; // Bluefin A2: ready to approve, never assigned in the tests

const header = (page: Page) => page.locator('header[aria-label="Response"]');
const groupHeading = (page: Page, title: string) => page.locator('h3', { hasText: new RegExp(`^\\s*${title} \\(\\d+\\)$`) });
async function groupCount(page: Page, title: string): Promise<number> {
  const h = groupHeading(page, title);
  if ((await h.count()) === 0) return 0;
  return Number((await h.innerText()).match(/\((\d+)\)/)![1]);
}

test('The header says where the response stands, as its card on Responses does; every question in one group', async ({ browser }) => {
  checks('S22-1 1', 'S22-1 2');
  const page = await signIn(browser, admin);
  await nav(page, 'Responses');
  const cardOnResponses = page.locator('div.group', { has: page.getByText(BLUEFIN, { exact: true }) }).first();
  await caption(page, 'Bluefin on Responses: its stage, due date and progress');
  const cardText = await cardOnResponses.innerText();
  const decided = cardText.match(/(\d+) of (\d+) decided/)!;
  // The browser's own date format: "Nov 5, 2026" or "5 Nov 2026".
  const due = cardText.match(/Due (?:\w{3,4} \d{1,2}, \d{4}|\d{1,2} \w{3,4} \d{4})/)?.[0] ?? 'No due date';
  const stage = cardText.match(/In progress|Ready to send|Changed since sent|Sent|No questions yet/)![0];

  await openResponse(page, BLUEFIN);
  await caption(page, 'The response opens with its header: owner, due date, progress, stage, files and the three stages');
  const h = header(page);
  await expect(h.getByRole('heading', { level: 1, name: BLUEFIN })).toBeVisible();
  await expect(h).toContainText(`${decided[1]} of ${decided[2]} decided`);
  await expect(h).toContainText(due);
  await expect(h).toContainText(stage);
  for (const flag of ['Overdue', 'At risk']) {
    await expect(h.getByText(flag, { exact: true })).toHaveCount(cardText.includes(flag) ? 1 : 0);
  }
  await expect(h.getByRole('navigation', { name: 'Stages' }).getByRole('button')).toHaveText([/^Questions/, /^With experts/, /^Send/]);
  await expect(h.getByRole('list', { name: 'Files' }).locator('[aria-current="true"]')).toContainText('(open)');

  await caption(page, 'Every question is in one group, and the groups add up to the header\'s count');
  const counts = await Promise.all(['Needs a person', 'Ready to approve', 'Approved', 'Not answered'].map((g) => groupCount(page, g)));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(Number(decided[2]));
  expect(counts[2] + counts[3]).toBe(Number(decided[1]));
});

test('A question that needs a person says why, first; Ready to approve holds the rest', async ({ browser }) => {
  checks('S22-1 3');
  const page = await signIn(browser, admin);
  await openResponse(page, BLUEFIN);
  const needs = page.locator('section[aria-labelledby="group-needs"]');
  await caption(page, 'Needs a person: one reason on each, first');
  const cards = needs.locator('[id^="question-"]');
  expect(await cards.count()).toBeGreaterThan(0);
  for (const c of await cards.all()) await expect(c.locator('[data-reason]')).toHaveCount(1);
  await expect(card(page, PRICING).locator('[data-reason]')).toHaveText('Pricing: a person answers');
  // Ready to approve has cards (two in the demo data since Sprint 22), and none carries a reason.
  const ready = page.locator('section[aria-labelledby="group-ready"]');
  await caption(page, 'Ready to approve: nothing holds these, so they carry no reason');
  expect(await ready.locator('[id^="question-"]').count()).toBeGreaterThan(0);
  await expect(ready.locator('[data-reason]')).toHaveCount(0);
});

test('With experts: every question asked of a colleague, an answer first; choosing one opens it', async ({ browser }) => {
  checks('S22-1 5');
  const page = await signIn(browser, admin);
  await openResponse(page, BLUEFIN);
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('button', { name: /^With experts/ }).click();
  const list = page.getByRole('list', { name: 'With experts' });
  await caption(page, 'With experts: who was asked, where each stands, and their note');
  await expect(list).toBeVisible();
  const words = (await list.locator('.status-pill').allInnerTexts()).map((w) => w.trim());
  expect(words.length).toBeGreaterThan(0);
  for (const w of words) expect(['Asked', 'Working on it', 'Answered', 'Approved', 'Closed']).toContain(w);
  // An answer to look at comes before everything else: the Sprint 19 tests leave one, sent to the owner.
  expect(words[0]).toBe('Answered');
  const firstOther = words.findIndex((w) => w !== 'Answered');
  if (firstOther >= 0) expect(words.slice(firstOther)).not.toContain('Answered');
  await expect(page.getByText('assignments with notes to review', { exact: false })).toHaveCount(0);

  const first = list.getByRole('listitem').first();
  const text = (await first.locator('p').first().innerText()).trim();
  await caption(page, 'Choosing one opens it at its question');
  await first.getByRole('button').click();
  const opened = card(page, text);
  await expect(opened).toBeInViewport();
  await expect(opened.getByRole('button', { name: /^(Approve|Write an answer|Revise Answer|Restore|Edit First)$/ }).first()).toBeVisible();
});

test('A member who does not own the response sees where it stands, and no approval, assignment or send control', async ({ browser }) => {
  checks('S22-1 8');
  const page = await signIn(browser, member);
  await openResponse(page, BLUEFIN);
  await caption(page, `${member.name} sees the header, the groups and the reasons`);
  await expect(header(page)).toBeVisible();
  await expect(groupHeading(page, 'Needs a person')).toBeVisible();
  await expect(card(page, PRICING).locator('[data-reason]')).toHaveText('Pricing: a person answers');
  await expect(page.getByText('Approve in bulk:', { exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Add a file' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Send the response' })).toHaveCount(0);
  await expect(page.locator('#stage-send')).toContainText('Only the response owner');
  // A question not asked of them (the Sprint 19 tests asked them others) offers no decision and no assignment.
  const access = await expand(page, ACCESS);
  await expect(access.getByText('Only the response owner, an admin, or someone this question is assigned to can decide it.')).toBeVisible();
  await expect(access.getByRole('button', { name: /^(Approve|Edit First|Write an answer|Leave unanswered|Assign for review)$/ })).toHaveCount(0);
});

test('An archived response shows the same page, read-only', async ({ browser }) => {
  checks('S22-1 10');
  const page = await signIn(browser, admin);
  await nav(page, 'Responses');
  await page.getByRole('tab', { name: /^Archived \(\d+\)$/ }).click();
  await page.getByText(HARBOUR, { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Questions', level: 2 }).waitFor();
  await caption(page, 'An archived response: the same header and groups, with nothing to change');
  await expect(header(page)).toContainText('Archived');
  await expect(page.getByText('This response is archived. It is kept as a record and can no longer be changed.')).toBeVisible();
  await expect(page.getByText('Approve in bulk:', { exact: true })).toHaveCount(0);
  await expect(header(page).getByRole('button', { name: 'Add a file' })).toHaveCount(0);
  await unfold(page);
  const first = page.locator('[id^="question-"]').first();
  await first.locator('p').first().click();
  await expect(first.getByRole('button', { name: /^(Approve|Edit First|Write an answer|Leave unanswered|Revise Answer|Restore|Assign for review)$/ })).toHaveCount(0);
});

test('At phone width the header, the stages and the groups fit', async ({ browser }) => {
  checks('S22-1 9');
  const page = await signIn(browser, admin, { width: 390, height: 844 });
  await openResponse(page, BLUEFIN);
  await caption(page, 'At phone width: the header, the stages and the groups, with no sideways scrolling');
  await expect(header(page).getByRole('navigation', { name: 'Stages' })).toBeVisible();
  await expect(groupHeading(page, 'Needs a person')).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await page.locator('#stage-send').scrollIntoViewIfNeeded();
  expect(await scrollsSideways(page)).toBe(false);
});

test('A question or file name containing markup shows as text', async ({ browser }) => {
  checks('S22-1 11');
  const page = await signIn(browser, admin);
  const markup = '<img src=x onerror="document.title=\'pwned\'"> <b>Markup (S22-1)</b>';
  // Names and questions are stored as written; here markup is put in what the database returned, as
  // a hostile upload would, to see how the page shows it.
  const change = async (route: Parameters<Parameters<Page['route']>[1]>[0], edit: (rows: Record<string, unknown>[]) => void) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch({ maxRedirects: 0 });
    const body = await res.json();
    if (Array.isArray(body) && body.length) edit(body as Record<string, unknown>[]);
    await route.fulfill({ response: res, json: body });
  };
  await page.route((url) => url.pathname.endsWith('/rest/v1/rfi_questions'), (route) => (route.request().method() === 'GET'
    ? change(route, (rows) => {
      // A question still to do, so its card is not in a folded group.
      const open = rows.find((r) => 'question' in r && r.status === 'pending');
      if (open) open.question = markup;
    }) : route.fallback()));
  await page.route((url) => url.pathname.endsWith('/rest/v1/rfi_sessions'), (route) => (route.request().method() === 'GET'
    ? change(route, (rows) => { for (const r of rows) if ('file_name' in r) r.file_name = markup; }) : route.fallback()));
  await openResponse(page, BLUEFIN);
  await caption(page, 'A question and a file name containing markup show as the text they are');
  await expect(card(page, markup)).toHaveCount(1);
  await expect(header(page).getByText(markup, { exact: false }).first()).toBeVisible();
  await expect(page.locator('header[aria-label="Response"] img, header[aria-label="Response"] b, #stage-questions img, #stage-questions b')).toHaveCount(0);
  expect(await page.title()).not.toBe('pwned');
});

test('A response with two files lists both in the header; choosing the other opens it', async ({ browser }) => {
  checks('S22-1 7');
  // Locally only: it adds a response and two files (the providers are off, so no AI is used).
  test.skip(TARGET === 'staging', 'Adds a response and two files: run locally, where no AI is called and the data is thrown away');
  const page = await signIn(browser, admin);
  await nav(page, 'Responses');
  await page.getByRole('button', { name: 'New response' }).click();
  const name = `Two files (S22-1 7) ${Date.now()}`;
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('button', { name: /^Create/ }).click();
  const csv = readFileSync('sample-data/sample-questions.csv');
  const upload = async (fileName: string) => {
    await page.locator('input[type=file]').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: csv });
    await page.getByRole('button', { name: 'Match and draft' }).click();
    await page.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 120_000 });
  };
  await upload('first-file-s22.csv');
  await caption(page, 'A second file for the same response');
  await header(page).getByRole('button', { name: 'Add a file' }).click();
  await upload('second-file-s22.csv');
  const files = header(page).getByRole('list', { name: 'Files' });
  await expect(files.getByRole('listitem')).toHaveCount(2);
  await expect(files.locator('[aria-current="true"]')).toContainText('second-file-s22.csv');
  await caption(page, 'Choosing the other file opens it');
  await files.getByRole('button', { name: /first-file-s22\.csv/ }).click();
  await expect(files.locator('[aria-current="true"]')).toContainText('first-file-s22.csv');
  await expect(files.getByRole('button', { name: /second-file-s22\.csv/ })).toBeVisible();
  await expect(header(page)).toContainText('across 2 files');
});

test('Bulk approval takes only Ready to approve, and the groups update', async ({ browser }) => {
  checks('S22-1 4');
  const page = await signIn(browser, admin);
  await openResponse(page, BLUEFIN);
  const ready = await groupCount(page, 'Ready to approve');
  const needs = await groupCount(page, 'Needs a person');
  const approved = await groupCount(page, 'Approved');
  // The demo data leaves two drafts at 91% ready to approve (Sprint 22, QA review).
  expect(ready).toBeGreaterThan(0);
  await caption(page, `Approve in bulk at 80% or more: ${ready} ready to approve, ${needs} needing a person`);
  await page.getByRole('button', { name: 'High ≥80%' }).click();
  await expect(page.getByRole('status').filter({ hasText: /approved/i }).first()).toBeVisible();
  await caption(page, 'Only Ready to approve was taken: Needs a person is unchanged');
  await expect(groupHeading(page, 'Ready to approve')).toHaveCount(0);
  expect(await groupCount(page, 'Needs a person')).toBe(needs);
  expect(await groupCount(page, 'Approved')).toBe(approved + ready);
});
