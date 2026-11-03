/**
 * Sprint 21's agreed cases (docs/refinement/sprint-21.md), as browser tests.
 */
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, card, expand } from './support';
import { requestAllowed } from './target';
import type { Page } from '@playwright/test';

const { admin, member } = PEOPLE;

/**
 * Sprint 22 (S22-3, F-69): the calls recorded this month as Asking the knowledge base, from Spend by
 * use on Governance (S22-2); 0 when there is no such line yet.
 */
async function askingCalls(page: Page): Promise<number> {
  await nav(page, 'Governance');
  const table = page.getByRole('table', { name: 'Spend by use' });
  const none = page.getByText('No AI calls this month.').first();
  await expect(table.or(none).first()).toBeVisible();
  if (!(await table.isVisible())) return 0;
  const row = table.getByRole('row').filter({ hasText: 'Asking the knowledge base' });
  if ((await row.count()) === 0) return 0;
  const calls = (await row.getByRole('cell').nth(1).innerText()).match(/\d+/);
  return calls ? Number(calls[0]) : 0;
}

test('Ask it a question: the real pipeline on staging, the fallback locally', async ({ browser }) => {
  checks(...(TARGET === 'staging' ? ['S21-4 1', 'S22-3 1'] : ['S21-4 2', 'S22-3 2']));
  // The demo page names the step that used the real AI model (Sprint 20, Q2).
  if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Asks one question with the real models' });
  const page = await signIn(browser, admin);
  await caption(page, 'Before asking: the calls recorded as Asking the knowledge base this month');
  const before = await askingCalls(page);
  await nav(page, 'Home');
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
    // Drafted by the real model, not assembled from the entries (QA review), and citing one.
    await expect(ask.getByText('Drafting was unavailable', { exact: false })).toHaveCount(0);
    await expect(ask.getByRole('listitem').filter({ hasText: '(cited in the draft)' }).first()).toBeVisible();
  } else {
    await expect(confidence).toContainText('Not calibrated');
  }
  // S22-3: the ask is recorded as spend the admin can see. Locally no real model is called, so the
  // count is read but not compared (case 2).
  await caption(page, 'After asking: the ask is recorded under Spend by use');
  const after = await askingCalls(page);
  if (TARGET === 'staging') expect(after).toBeGreaterThan(before);
  else test.info().annotations.push({ type: 'note', description: `Locally the providers are off: calls ${before} before, ${after} after, not compared` });
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
  // The control (QA review): the admin sees both on the same response.
  const boss = await signIn(browser, admin);
  await openResponse(boss, LARKSPUR);
  await expect(sendPanel(boss).getByRole('button', { name: /^Excel/ })).toBeVisible();
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
  // The page is reloaded below: wait for this save to answer first.
  const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/approve_answer') && r.ok());
  await c.getByRole('button', { name: 'Save & approve' }).click();
  await saved;
  await expect(c.getByText('Approved (written by a person)')).toBeVisible();

  await caption(page, 'A change after sending: the stage reads Changed since sent');
  const panel = sendPanel(page);
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();

  await caption(page, 'Downloading does not mark it as sent');
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: /^Excel/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  await expect(panel.getByText('Downloading does not mark the response as sent.')).toBeVisible();
  // As the database has it, after a reload (QA review): still not sent, the assignment still open.
  await page.reload();
  await openResponse(page, LARKSPUR);
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();
  await showQuestions(page);
  await expect((await expand(page, TEST_DATA)).getByText('Asked', { exact: true })).toBeVisible();

  await caption(page, 'Mark as sent says first what it will do; Cancel changes nothing');
  await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  const confirm = panel.getByRole('group', { name: 'Confirm marking as sent' });
  await expect(confirm).toContainText('record that it was sent, with your name and the time');
  await expect(confirm).toContainText('the approved answers changed since it was last marked as sent: 2 answers edited or written by a person');
  await expect(confirm).toContainText('0 drafts approved as written');
  await expect(confirm).toContainText('1 pricing answer, never learned');
  await expect(confirm).toContainText('close the 1 open assignment on it');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();

  await caption(page, 'Confirmed: Sent again, the assignment closed, and what the knowledge base learned');
  await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  await confirm.getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(panel.getByRole('heading', { name: /^Sent on / })).toBeVisible();
  // Something was learned from the two edited answers, and the pricing answer was not (QA review).
  await expect(panel.getByText(/^Knowledge base: (?=.*(added as new entries|replaced an older entry|proposed as replacements)).*1 not learned \(pricing\)/)).toBeVisible();
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
  await expect(entry).toContainText('response.exported');
  // Today, as the page writes dates (QA review: not an older row).
  const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
  await expect(entry).toContainText(today);
});

// ── S21-2: Gaps ──────────────────────────────────────────────────────────────────────────────────

const REGIONS = 'In which regions is customer data stored?'; // Larkspur: no draft; a person's answer, learned when sent
const PHISHING = 'フィッシング攻撃をどのように検知し、対応していますか？'; // Bluefin: no draft; approved by the member in sprint-19.spec.ts
const DETECT = 'What is your mean time to detect a security incident?'; // Bluefin: no draft; left unanswered here

test('Gaps: what the knowledge base could not answer, where each stands, and one step to act', async ({ browser }) => {
  checks('S21-2 4', 'S21-2 5');
  // The admin, who can act on what they open (every member sees the same gaps: database case 6).
  const page = await signIn(browser, admin);
  await caption(page, 'First, one question the knowledge base could not answer is left unanswered');
  await openResponse(page, BLUEFIN);
  // Waits for the save, not only the card, before Gaps is read (the staging run of 1aed1dc).
  const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/rfi_questions') && r.request().method() === 'PATCH' && r.ok());
  await (await expand(page, DETECT)).getByRole('button', { name: 'Leave unanswered' }).click();
  await expect(card(page, DETECT).getByText('Not answered', { exact: true })).toBeVisible();
  await saved;
  await nav(page, 'Knowledge');
  await caption(page, 'Knowledge counts the gaps not answered yet, beside the other states');
  const count = page.getByRole('region', { name: 'Health' }).getByRole('button', { name: /gaps? not answered yet/ });
  await expect(count).toContainText(/^[1-9]\d*/);
  await count.click();
  await expect(page.getByRole('heading', { name: 'Gaps', exact: true })).toBeVisible();
  const list = page.getByRole('region', { name: 'Gaps' });
  await expect(page.getByRole('checkbox', { name: /^Not answered yet/ })).toBeChecked();

  await caption(page, 'Every state, with how many responses asked each question');
  for (const label of ['Answered, learned when sent', 'Learned', 'Learned as a proposed change', 'Answered, not in the knowledge base', 'Left unanswered']) {
    await page.getByRole('checkbox', { name: new RegExp(`^${label} \\(`) }).check();
  }
  // Each state as the page shows it (QA review: not only the filter labels).
  await expect(list.getByRole('article', { name: PHISHING })).toContainText('Answered, learned when sent');
  await expect(list.getByRole('article', { name: DETECT })).toContainText('Left unanswered');
  const learned = list.getByRole('article', { name: REGIONS });
  await expect(learned).toContainText('Learned');
  await expect(learned).toContainText('Asked in 1 response');
  const ref = learned.getByRole('button', { name: /^KB-\d{4,}$/ });
  const entryRef = (await ref.textContent())!.trim();

  await caption(page, 'A learned gap opens the answer it became');
  await ref.click();
  await expect(page.getByRole('complementary', { name: 'Selected answer' })).toContainText(entryRef);
  await expect(page.getByRole('complementary', { name: 'Selected answer' })).toContainText(REGIONS);

  await caption(page, 'One not answered yet opens in its response, at that question');
  await nav(page, 'Knowledge');
  await page.getByRole('button', { name: 'Gaps', exact: true }).click();
  const open = list.getByRole('article').filter({ hasText: 'Not answered yet' }).first();
  const question = (await open.getByRole('paragraph').first().textContent())!.trim();
  await open.getByRole('button', { name: 'Open it in the response' }).click();
  const c = card(page, question);
  await expect(c).toBeVisible();
  // Opened at that question: its card is open, with what can be done next.
  await expect(c.getByRole('button', { name: /^(Approve|Write an answer|Edit First)$/ }).first()).toBeVisible();
});

test('Gaps show a question\'s markup as text', async ({ browser }) => {
  checks('S21-2 7');
  const page = await signIn(browser, member);
  const markup = '<img src=x onerror="document.title=\'pwned\'"> <b>Do you scan uploads?</b>';
  // The database returns question text as written (database case 7); here one with markup is added
  // to what it returned, as a hostile upload would put it there, to see how the page shows it.
  await page.route('**/rest/v1/rpc/knowledge_gaps', async (route) => {
    // The request guard first (security review): this handler runs before the session's own.
    if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
    const res = await route.fetch();
    const body = (await res.json()) as { total: number; gaps: Record<string, unknown>[] };
    const first = body.gaps[0] ?? { state: 'open', responses: 1, lastAsked: new Date().toISOString(), entryRef: null, responseId: 'x', response: 'x', sessionId: 'x' };
    await route.fulfill({ response: res, json: { total: body.total + 1, gaps: [{ ...first, question: markup, questionId: 'markup-test', state: 'open' }, ...body.gaps] } });
  });
  await nav(page, 'Knowledge');
  await page.getByRole('button', { name: 'Gaps', exact: true }).click();
  await caption(page, 'A question containing markup shows as the text it is');
  await expect(page.getByRole('region', { name: 'Gaps' }).getByText(markup, { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Gaps"] img, section[aria-label="Gaps"] b')).toHaveCount(0);
  expect(await page.title()).not.toBe('pwned');
});
