/**
 * Sprint 21's agreed cases (docs/refinement/sprint-21.md), as browser tests.
 */
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, card, expand } from './support';
import type { Page } from '@playwright/test';

const { admin, member } = PEOPLE;

test('Ask it a question: the real pipeline on staging, the fallback locally', async ({ browser }) => {
  checks(TARGET === 'staging' ? 'S21-4 1' : 'S21-4 2');
  // The demo page names the step that used the real AI model (Sprint 20, Q2).
  if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Asks one question with the real models' });
  const page = await signIn(browser, admin);
  const ask = page.getByRole('region', { name: 'Ask it a question' });
  await caption(page, TARGET === 'staging'
    ? 'One question to the real models: matching, the checker and drafting'
    : 'The same question with every AI provider switched off: the fallback answer');
  await ask.getByRole('textbox', { name: 'Your question' }).fill('How do you encrypt data at rest?');
  await ask.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(ask.getByText('Answers it drew on')).toBeVisible({ timeout: 90_000 });
  await expect(ask.getByRole('button', { name: /^KB-\d{4,}$/ }).first()).toBeVisible();
  const confidence = ask.getByText(/^Confidence:/);
  if (TARGET === 'staging') {
    await expect(confidence).not.toContainText('Not calibrated');
    await expect(confidence).toContainText('Checker:');
  } else {
    await expect(confidence).toContainText('Not calibrated');
  }
});

// ── S21-1: download separate from Mark as sent ───────────────────────────────────────────────────

const BLUEFIN = 'Bluefin Freight (fictional): security questionnaire';
const LARKSPUR = 'Larkspur Health (fictional): data platform RFI';
// Larkspur is sent in the demo data (every question decided). Its questions used here:
const IN_TRANSIT = 'How does your organisation encrypt data in transit between services?'; // a draft, approved as written
const TEST_DATA = 'How is sensitive data handled in test and development environments?'; // a draft, approved as written
const FEES = 'What are your fees for implementation services?'; // pricing, left unanswered

const sendPanel = (page: Page) => page.getByRole('region', { name: 'Send the response' });

/** Opens a sent response's question list, which is folded away. */
async function showQuestions(page: Page) {
  const show = page.getByRole('button', { name: /^Show \d+ questions$/ });
  if (await show.isVisible({ timeout: 3000 }).catch(() => false)) await show.click();
}

test('Nothing to download or mark as sent while questions are still to do', async ({ browser }) => {
  checks('S21-1 1');
  const page = await signIn(browser, admin);
  await caption(page, 'Bluefin still has questions to do: no download, no Mark as sent, and the reason');
  await openResponse(page, BLUEFIN);
  await expect(page.getByText(/questions? (is|are) still to do: approve .* before downloading the answers or marking the response as sent\./)).toBeVisible();
  await expect(sendPanel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Excel/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
});

test('A member who does not own the response sees neither Download nor Mark as sent', async ({ browser }) => {
  checks('S21-1 7');
  const page = await signIn(browser, member);
  await caption(page, `${member.name} opens Larkspur, which they do not own`);
  await openResponse(page, LARKSPUR);
  await expect(sendPanel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);
});

/**
 * One story in order, on Larkspur (the demo's sent response, so no new upload and no AI processing):
 * the admin changes three answers and assigns one question, which reopens it as "Changed since sent";
 * downloads without marking anything; sees what Mark as sent will do and cancels; then confirms.
 * Learning adds entries, which on staging are indexed with the real embedding model (a fraction of a penny).
 */
test('Changed since sent, download, the confirmation, and marking as sent again', async ({ browser }) => {
  checks('S21-1 5', 'S21-1 2', 'S21-1 3', 'S21-1 4');
  const page = await signIn(browser, admin);
  await openResponse(page, LARKSPUR);
  await caption(page, 'Larkspur was sent: the stage reads Sent, with the date');
  await expect(sendPanel(page).getByRole('heading', { name: /^Sent on \d{1,2} \w{3,4} \d{4}$/ })).toBeVisible();
  await showQuestions(page);

  await caption(page, `${admin.name} assigns a question to ${member.name}, then edits two answers`);
  let c = await expand(page, TEST_DATA);
  await c.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  const row = c.locator('div.flex.items-start', { has: page.getByText(member.name, { exact: true }) });
  await row.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(c.getByText('Asked', { exact: true })).toBeVisible();
  for (const [question, answer] of [
    [TEST_DATA, 'Production data is never used in test or development. Test data is synthetic, generated for each environment.'],
    [IN_TRANSIT, 'All traffic between services uses mutual TLS 1.3, inside a private network.'],
  ]) {
    c = await expand(page, question);
    await c.getByRole('button', { name: 'Revise Answer' }).click();
    await c.locator('textarea').fill(answer);
    await c.getByRole('button', { name: 'Save & approve' }).click();
    await expect(c.getByText('Approved (edited)')).toBeVisible();
  }
  await caption(page, 'The pricing question, left unanswered before, now gets an answer written by a person');
  c = await expand(page, FEES);
  await c.getByRole('button', { name: 'Restore' }).click();
  await c.getByRole('button', { name: 'Write an answer' }).click();
  await c.locator('textarea').fill('Implementation is quoted per project; a typical project is fixed price.');
  await c.getByRole('button', { name: 'Save & approve' }).click();
  await expect(c.getByText('Approved (written by a person)')).toBeVisible();

  await caption(page, 'A change after sending: the stage reads Changed since sent');
  const panel = sendPanel(page);
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();

  await caption(page, 'Downloading does not mark it as sent');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: /^Excel/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(panel.getByText('Downloading does not mark the response as sent.')).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();
  await expect(card(page, TEST_DATA).getByText('Asked', { exact: true })).toBeVisible();

  await caption(page, 'Mark as sent says first what it will do; Cancel changes nothing');
  await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  const confirm = panel.getByRole('group', { name: 'Confirm marking as sent' });
  await expect(confirm).toContainText('record that it was sent, with your name and the time');
  await expect(confirm).toContainText('the answers people edited or wrote since it was last marked as sent (2 answers here)');
  await expect(confirm).toContainText('the 1 pricing answer is never learned');
  await expect(confirm).toContainText('close the 1 open assignment on it');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();

  await caption(page, 'Confirmed: Sent again, the assignment closed, and what the knowledge base learned');
  await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  await confirm.getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(panel.getByRole('heading', { name: /^Sent on / })).toBeVisible();
  await expect(panel.getByText(/^Knowledge base: .*1 not learned \(pricing\)/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Mark as sent', exact: true })).toHaveCount(0);
  await showQuestions(page);
  await expand(page, TEST_DATA);
  await expect(card(page, TEST_DATA).getByText('Closed', { exact: true })).toBeVisible();

  await caption(page, 'The audit log records who marked it as sent, and when');
  await nav(page, 'Governance');
  await page.getByRole('tab', { name: 'Audit log' }).click();
  const entry = page.getByRole('listitem').filter({ hasText: /^Marked as sent again after changes/ }).first();
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(admin.name);
});
