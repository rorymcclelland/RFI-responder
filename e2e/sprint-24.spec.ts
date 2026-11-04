/**
 * Sprint 24 (S24-1, U-11): one response, one list, sent as a whole. Test numbers refer to
 * docs/refinement/sprint-24.md. Locally only: these add a response and two files (the providers are
 * off, so no AI is used and the data is thrown away). On staging the main path covers the whole
 * response with the real AI (e2e/sprint-23-main-path.spec.ts).
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, unfold, scrollsSideways } from './support';

const { admin } = PEOPLE;
const SAMPLE = readFileSync('sample-data/try-it-questionnaire.csv', 'utf8').trim().split(/\r?\n/);
const FILES = [
  { name: 'first-part-s24.csv', rows: SAMPLE.slice(1, 4) },
  { name: 'second-part-s24.csv', rows: SAMPLE.slice(4, 7) },
].map((f) => ({ ...f, buffer: Buffer.from([SAMPLE[0], ...f.rows].join('\n') + '\n') }));
const NAME = `Two files (S24-1) ${Date.now()}`;

test.describe.configure({ mode: 'serial' });
test.skip(TARGET === 'staging', 'Adds a response and two files: run locally, where no AI is called and the data is thrown away');

const header = (page: Page) => page.locator('header[aria-label="Response"]');
const files = (page: Page) => header(page).getByRole('list', { name: 'Files' });
const send = (page: Page) => page.getByRole('region', { name: 'Send the response' });
const cards = (page: Page) => page.locator('#stage-questions [id^="question-"]');

/** Leaves every question still to do in this file unanswered, one at a time, waiting for each save. */
async function leaveUnanswered(page: Page, fileName: string) {
  for (let guard = 0; guard < 10; guard++) {
    const next = page.locator('section[aria-labelledby="group-needs"] [id^="question-"], section[aria-labelledby="group-ready"] [id^="question-"]')
      .filter({ hasText: `From ${fileName}` }).first();
    if (!(await next.count())) return;
    const id = await next.getAttribute('id');
    await next.locator('p').first().click();
    const save = page.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
    await next.getByRole('button', { name: 'Leave unanswered' }).click();
    await save;
    await expect(page.locator(`section[aria-labelledby="group-needs"] [id="${id}"]`)).toHaveCount(0);
  }
}

test('One list across a response\'s files, with a filter by file', async ({ browser }) => {
  checks('S24-1 1', 'S24-1 2');
  const page = await signIn(browser, admin);
  await nav(page, 'Responses');
  await page.getByRole('button', { name: 'New response' }).click();
  await page.getByLabel(/^Name/).fill(NAME);
  await page.getByRole('button', { name: /^Create/ }).click();
  await caption(page, 'A response whose customer sent two questionnaires');
  for (const [i, f] of FILES.entries()) {
    if (i > 0) await header(page).getByRole('button', { name: 'Add a file' }).click();
    await page.locator('input[type=file]').setInputFiles({ name: f.name, mimeType: 'text/csv', buffer: f.buffer });
    await page.getByRole('button', { name: 'Match and draft' }).click();
    await page.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 120_000 });
    await expect(page.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 120_000 });
  }

  await caption(page, 'Every question of both files in one list, each saying which file it came from');
  const total = FILES[0].rows.length + FILES[1].rows.length;
  await unfold(page);
  await expect(cards(page)).toHaveCount(total);
  for (const f of FILES) await expect(cards(page).filter({ hasText: `From ${f.name}` })).toHaveCount(f.rows.length);
  await expect(page.locator('#stage-questions')).toContainText(`${total} in this response, across 2 files`);
  // The header's figures and the groups' counts agree (S24-1 1).
  await expect(header(page)).toContainText(`0 of ${total} decided`);
  await expect(files(page).getByRole('button', { name: 'All files' })).toHaveAttribute('aria-pressed', 'true');

  await caption(page, 'Choosing a file shows only its questions, and the page says so');
  await files(page).getByRole('button', { name: FILES[0].name }).click();
  await expect(files(page).getByRole('button', { name: FILES[0].name })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(FILES[0].rows.length);
  await expect(page.locator('#stage-questions')).toContainText(`Showing the ${FILES[0].rows.length} in ${FILES[0].name} only.`);
  // The header still speaks for the whole response.
  await expect(header(page)).toContainText(`0 of ${total} decided`);
  await files(page).getByRole('button', { name: 'All files' }).click();
  await expect(cards(page)).toHaveCount(total);
});

test('Marked as sent once, for the whole response, when every file is decided; downloads one per file; no file added after', async ({ browser }) => {
  checks('S24-1 4', 'S24-1 7', 'S24-1 8');
  const page = await signIn(browser, admin);
  await openResponse(page, NAME);
  await caption(page, 'One file decided, the other not: the response cannot be marked as sent yet');
  await leaveUnanswered(page, FILES[0].name);
  await expect(page.locator('#stage-send')).toContainText(`${FILES[1].rows.length} questions are still to do`);
  await expect(send(page)).toHaveCount(0);

  await caption(page, 'Both decided: one download for each file, and one Mark as sent');
  await leaveUnanswered(page, FILES[1].name);
  for (const f of FILES) {
    const group = send(page).getByRole('group', { name: `Download ${f.name}` });
    await expect(group).toContainText(`(${f.rows.length} questions)`);
    const download = page.waitForEvent('download');
    await group.getByRole('button', { name: /^CSV/ }).click();
    const got = await download;
    expect(got.suggestedFilename()).toBe(f.name);
    // Only this file's questions (the CSV has a header row, then one row each).
    const text = readFileSync(await got.path(), 'utf8');
    for (const row of f.rows) expect(text).toContain(row.split(',')[0]);
    for (const other of FILES.filter((x) => x !== f)) for (const row of other.rows) expect(text).not.toContain(row.split(',')[0]);
  }
  await send(page).getByRole('button', { name: 'Mark as sent' }).click();
  await page.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(send(page).getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  await expect(header(page)).toContainText('Sent');

  await caption(page, 'Sent: the response is the record of what was sent, so no file can be added');
  await expect(header(page).getByRole('button', { name: 'Add a file' })).toHaveCount(0);
  await nav(page, 'Responses');
  await expect(page.locator('div.group', { has: page.getByText(NAME, { exact: true }) }).first()).toContainText('Sent');
});

test('A change after sending reopens the whole response, and it is marked as sent again', async ({ browser }) => {
  checks('S24-1 6', 'S24-2 4');
  const page = await signIn(browser, admin);
  await openResponse(page, NAME);
  await caption(page, 'A decision in the second file changes after sending');
  await page.getByRole('button', { name: /^Show \d+ questions/ }).click();
  await unfold(page);
  const id = await cards(page).filter({ hasText: `From ${FILES[1].name}` }).first().getAttribute('id');
  const changed = page.locator(`[id="${id}"]`);
  await changed.locator('p').first().click();
  let save = page.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
  await changed.getByRole('button', { name: /^Restore/ }).click();
  await save;
  await caption(page, 'Left unanswered again, it is a change since the response was sent');
  if (!(await changed.getByRole('button', { name: 'Leave unanswered' }).isVisible())) await changed.locator('p').first().click();
  save = page.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
  await changed.getByRole('button', { name: 'Leave unanswered' }).click();
  await save;
  await expect(header(page)).toContainText('Changed since sent');
  await expect(send(page)).toContainText('This is what was learned when it was last marked as sent.');
  await send(page).getByRole('button', { name: 'Mark as sent' }).click();
  await page.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(send(page).getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  await expect(header(page)).not.toContainText('Changed since sent');
});

test('At phone width the files filter and the file on each card fit', async ({ browser }) => {
  checks('S24-1 11');
  const page = await signIn(browser, admin, { width: 390, height: 844 });
  await openResponse(page, NAME);
  await page.getByRole('button', { name: /^Show \d+ questions/ }).click();
  await expect(files(page).getByRole('button', { name: 'All files' })).toBeVisible();
  await expect(cards(page).filter({ hasText: `From ${FILES[0].name}` }).first()).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});
