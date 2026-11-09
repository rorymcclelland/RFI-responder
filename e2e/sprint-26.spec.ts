// Sprint 26 acceptance tests (S26-1): the page refuses, before uploading anything, a file that would take
// a response past 2,000 questions, saying why. The database's own check is proved in
// supabase/tests/db/sprint26.test.ts; here the page is made to see a response that already holds 1,999
// questions, by changing what the database returned, so no data is added on either target.
import { test, expect, PEOPLE, signIn, caption, checks, openResponse } from './support';
import { requestAllowed } from './target';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

const admin = PEOPLE.admin;
const BLUEFIN = 'Bluefin Freight (fictional): security questionnaire';
const header = (page: Page) => page.locator('header[aria-label="Response"]');

test('A file that would take a response past 2,000 questions is refused before anything is uploaded', async ({ browser }) => {
  checks('S26-1 9');
  const page = await signIn(browser, admin);
  // The response's file, as the page reads it, now holds 1,999 questions.
  await page.route((url) => url.pathname.endsWith('/rest/v1/rfi_sessions'), async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch({ maxRedirects: 0 });
    const body = await res.json();
    if (Array.isArray(body)) for (const r of body as Record<string, unknown>[]) if ('question_count' in r) r.question_count = 1999;
    await route.fulfill({ response: res, json: body });
  });
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /\/rest\/v1\/(rfi_sessions|rfi_questions)/.test(r.url())) writes.push(`${r.method()} ${r.url()}`);
  });
  await openResponse(page, BLUEFIN);
  await caption(page, 'A response that already holds 1,999 questions: adding a file of 40');
  await header(page).getByRole('button', { name: 'Add a file' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'forty-more-s26.csv', mimeType: 'text/csv', buffer: readFileSync('sample-data/sample-questions.csv') });
  await page.getByRole('button', { name: 'Match and draft' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /This response would have [2-9],\d{3} questions; a response can have at most 2,000, so that it can be marked as sent in one go\. Put the rest in a new response\./ })).toBeVisible();
  await caption(page, 'Refused before uploading: nothing was added');
  expect(writes).toEqual([]);
});
