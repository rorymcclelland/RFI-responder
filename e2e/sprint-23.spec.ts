/**
 * Sprint 23's agreed cases for Try it (docs/refinement/sprint-23.md, S23-1), as browser tests. On
 * staging the visitor's try is drafted with the real AI (Q5); locally the providers are off.
 */
import { readFileSync } from 'node:fs';
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, scrollsSideways } from './support';
import { requestAllowed } from './target';
import type { Locator, Page } from '@playwright/test';

const { admin, member } = PEOPLE;
const SAMPLE = 'Coral Bay Retail (fictional): security questionnaire';
const tryOf = (name: string) => `Try it: ${SAMPLE}, ${name}`;
const PRICING = 'What is the annual licence fee for 400 store managers?';
const LEGAL = 'Will you accept unlimited liability for a breach of our customer data?';
const QUESTIONS = readFileSync('sample-data/try-it-questionnaire.csv', 'utf8').trim().split('\n').length - 1;

// The tests build on each other in order: the try made by the first is opened by the later ones
// (QA review: said, not left implicit). One worker runs them in file order.
test.describe.configure({ mode: 'serial' });

const header = (page: Page) => page.locator('header[aria-label="Response"]');
const tryPanel = (page: Page) => page.getByRole('region', { name: 'Try it' });
const sendPanel = (page: Page) => page.getByRole('region', { name: 'Send the response' });
const group = (page: Page, key: 'needs' | 'ready') => page.locator(`section[aria-labelledby="group-${key}"]`);
const cardOf = (page: Page, text: string): Locator => page.locator('[id^="question-"]').filter({ has: page.getByText(text, { exact: true }) });

/** Waits for a try's questions to be drafted: the page shows its stages and no question is waiting. */
async function drafted(page: Page) {
  await page.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 240_000 });
  await expect(page.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 240_000 });
  await expect(page.getByText('Not checked and drafted yet')).toHaveCount(0);
}

test('Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing', async ({ browser }) => {
  // S23-1 2's bulk approval runs only on staging, where the drafts are checked (QA review).
  checks(...(TARGET === 'staging' ? ['S23-1 1', 'S23-1 2', 'S23-1 3'] : ['S23-1 1', 'S23-1 3']));
  if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Drafts the try with the real models (Q5)' });
  test.setTimeout(420_000);
  const page = await signIn(browser, member);
  await caption(page, `${member.name} chooses Try it on Home`);
  await expect(tryPanel(page)).toContainText('Nothing you do in a try is learned by the knowledge base.');
  await tryPanel(page).getByRole('button', { name: 'Try it with a sample questionnaire' }).click();

  await caption(page, 'A response of their own, named for the sample and for them, drafted as an upload is');
  await expect(header(page).getByRole('heading', { level: 1, name: tryOf(member.name) })).toBeVisible({ timeout: 30_000 });
  await expect(header(page)).toContainText('A try.');
  await drafted(page);
  await expect(header(page)).toContainText(`of ${QUESTIONS} decided`);
  if (TARGET === 'staging') {
    // The real pipeline: drafts from the knowledge base, not the fallback (as S21-4 checks the ask).
    await expect(page.getByText('Drafting was unavailable', { exact: false })).toHaveCount(0);
    expect(await group(page, 'ready').locator('[id^="question-"]').count()).toBeGreaterThan(0);
  }

  await caption(page, 'The holds a visitor should see: pricing and legal need a person, each saying why');
  await expect(cardOf(page, PRICING).locator('[data-reason]')).toHaveText('Pricing: a person answers');
  await expect(cardOf(page, LEGAL).locator('[data-reason]')).toHaveText('Legal: review individually');

  if (TARGET === 'staging') {
    await caption(page, 'Approve in bulk: the drafts nothing holds');
    await page.getByRole('button', { name: 'All eligible' }).click();
    await expect(group(page, 'ready')).toHaveCount(0);
  }
  // The rest: one approved on its own where it has a draft, the others left unanswered.
  await caption(page, 'The rest one at a time: approve one, leave the others unanswered');
  let approvedOne = false;
  for (let guard = 0; guard < QUESTIONS + 2; guard++) {
    const next = page.locator('section[aria-labelledby="group-needs"] [id^="question-"], section[aria-labelledby="group-ready"] [id^="question-"]').first();
    if (!(await next.count())) break;
    const id = await next.getAttribute('id');
    await next.locator('p').first().click();
    const approve = next.getByRole('button', { name: 'Approve', exact: true });
    const save = page.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
    if (!approvedOne && await approve.isVisible() && await approve.isEnabled()) { await approve.click(); approvedOne = true; }
    else await next.getByRole('button', { name: 'Leave unanswered' }).click();
    await save;
    // A card's id may start with a digit, so it is matched as an attribute, not with #.
    await expect(page.locator(`section[aria-labelledby="group-needs"] [id="${id}"], section[aria-labelledby="group-ready"] [id="${id}"]`)).toHaveCount(0);
  }
  // An approved answer, so marking as sent has something the database must refuse to learn (QA review).
  expect(approvedOne).toBe(true);
  await expect(header(page)).toContainText(`${QUESTIONS} of ${QUESTIONS} decided`);
  // Nobody can be asked to help on a try (QA review): its cards offer no assignment.
  await expect(page.getByRole('button', { name: /^Assign (for review|another)/ })).toHaveCount(0);

  await caption(page, 'Download, then mark as sent: the confirmation says a try teaches the knowledge base nothing');
  const download = page.waitForEvent('download');
  await sendPanel(page).getByRole('button', { name: /^Excel/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await sendPanel(page).getByRole('button', { name: 'Mark as sent' }).click();
  const confirm = page.getByRole('group', { name: 'Confirm marking as sent' });
  await expect(confirm).toContainText('teach the knowledge base nothing: this is a try');
  await confirm.getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await caption(page, 'Sent, and nothing was learned');
  await expect(sendPanel(page).getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  // What the database reported: nothing learned, because it is a try (QA review: not the flag alone).
  await expect(sendPanel(page)).toContainText(/\d+ not learned \(a try\)/);
});

test('A try is in its owner\'s lists and every admin\'s, marked Try; not in other members\'', async ({ browser }) => {
  checks('S23-1 5');
  const boss = await signIn(browser, admin);
  await nav(boss, 'Responses');
  await caption(boss, `${admin.name}, an admin, sees ${member.name}'s try on Responses, marked Try`);
  const card = boss.locator('div.group', { has: boss.getByText(tryOf(member.name), { exact: true }) }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText('Try', { exact: true })).toBeVisible();

  const visitor = await signIn(browser, member);
  await nav(visitor, 'Responses');
  await caption(visitor, `${member.name} sees their own try`);
  await expect(visitor.getByText(tryOf(member.name), { exact: true }).first()).toBeVisible();

});

test('Another member does not see someone else\'s try in their lists', async ({ browser }) => {
  checks('S23-1 5');
  test.skip(TARGET === 'staging', 'Needs a third person: the seed has one, staging has two test people');
  const other = await signIn(browser, { email: 'maya.patel@example.com', name: 'Maya Patel' });
  await caption(other, 'Another member does not see it, on Responses or on Home');
  await nav(other, 'Responses');
  // The list has loaded once a seeded response shows (QA review: an empty list proves nothing).
  await expect(other.getByText('Bluefin Freight (fictional): security questionnaire', { exact: true }).first()).toBeVisible();
  await expect(other.getByText(tryOf(member.name), { exact: true })).toHaveCount(0);
  await nav(other, 'Home');
  await expect(other.getByRole('heading', { name: 'Your responses' })).toBeVisible();
  await expect(other.getByText(/^(Loading…)$/)).toHaveCount(0);
  await expect(other.getByText(tryOf(member.name), { exact: true })).toHaveCount(0);
});

test('Open your try goes back to it; Start a new try puts it away and makes a fresh one', async ({ browser }) => {
  checks('S23-1 6');
  // A new try is drafted again: locally only, so staging drafts one try a run (Q5).
  test.skip(TARGET === 'staging', 'Drafts a second try: run locally, where no AI is called');
  test.setTimeout(240_000);
  const page = await signIn(browser, member);
  await caption(page, 'Open your try: back to the one already made, sent and decided');
  await tryPanel(page).getByRole('button', { name: 'Open your try' }).click();
  await expect(header(page).getByRole('heading', { level: 1, name: tryOf(member.name) })).toBeVisible();
  await expect(header(page)).toContainText(`${QUESTIONS} of ${QUESTIONS} decided`);

  await nav(page, 'Home');
  await caption(page, 'Start a new try: the old one is archived, and a fresh one is drafted');
  await tryPanel(page).getByRole('button', { name: 'Start a new try' }).click();
  await drafted(page);
  await expect(header(page)).toContainText(`0 of ${QUESTIONS} decided`);
  await nav(page, 'Responses');
  await page.getByRole('tab', { name: /^Archived \(\d+\)$/ }).click();
  await expect(page.getByText(tryOf(member.name), { exact: true }).first()).toBeVisible();
});

test('When a limit stops a try\'s drafting, the page says which', async ({ browser }) => {
  checks('S23-1 8');
  const page = await signIn(browser, admin);
  // The limit itself is a database check (Sprint 4); here processing is given the refusal it sends
  // when the day's limit is reached, to see what the visitor is told. Nothing is drafted, so no AI.
  await page.route('**/functions/v1/process-questions', async (route) => {
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    await route.fulfill({ status: 429, json: { error: "You have reached today's limit on processing questions. An admin can raise it under Governance, Usage and limits." } });
  });
  await caption(page, `${admin.name} tries it on a day the limit has been reached`);
  await tryPanel(page).getByRole('button', { name: 'Try it with a sample questionnaire' }).click();
  await expect(page.getByRole('alert').filter({ hasText: "today's limit on processing questions" }).first()).toBeVisible({ timeout: 60_000 });
});

test('At phone width Try it and the try fit', async ({ browser }) => {
  checks('S23-1 9');
  const page = await signIn(browser, member, { width: 390, height: 844 });
  await caption(page, 'At phone width: Try it on Home, and the try itself, with no sideways scrolling');
  await expect(tryPanel(page)).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
  await tryPanel(page).getByRole('button', { name: /^(Open your try|Try it with a sample questionnaire)$/ }).click();
  await header(page).waitFor();
  await drafted(page);
  expect(await scrollsSideways(page)).toBe(false);
});
