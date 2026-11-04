/**
 * Sprint 23 (S23-2, F-66): the main path as one browser test, in order, on a response the test
 * makes: an owner adds a response, uploads a questionnaire and drafts it; a colleague answers the
 * question they were asked; the owner decides the rest, downloads the Excel file and marks the
 * response as sent, and the page says what the knowledge base did. Locally only (Q5): the providers
 * are off, and staging's real-AI steps are the ask and the try.
 */
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, expand } from './support';

const { admin, member } = PEOPLE;
/** The export's wording for a question left unanswered (NOT_ANSWERED in src/exportUtils.ts). */
const NOT_ANSWERED = 'Not answered';
const CHARTER = 'Do you hold the Coral Bay Retail Supplier Charter accreditation?';

test('The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent', async ({ browser }) => {
  checks('S23-2 1', 'S23-2 2', 'S23-2 3');
  test.skip(TARGET === 'staging', 'Locally only (Q5): it drafts a whole questionnaire');
  test.setTimeout(420_000);
  const name = `Main path (S23-2) ${Date.now()}`;
  const answer = `No; we would apply for it within 90 days of contract (synthetic answer, ${Date.now()}).`;

  // 1. Add a response and upload its questionnaire.
  const owner = await signIn(browser, admin);
  await caption(owner, `${admin.name} adds a response`);
  await nav(owner, 'Responses');
  await owner.getByRole('button', { name: 'New response' }).click();
  await owner.getByLabel(/^Name/).fill(name);
  await owner.getByRole('button', { name: /^Create/ }).click();
  await caption(owner, 'Uploads the customer\'s questionnaire, checks the question column, and drafts it');
  await owner.locator('input[type=file]').setInputFiles({ name: 'main-path-questionnaire.csv', mimeType: 'text/csv', buffer: readFileSync('sample-data/try-it-questionnaire.csv') });
  await owner.getByRole('button', { name: 'Match and draft' }).click();
  await owner.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 240_000 });
  await expect(owner.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 240_000 });
  const total = Number((await owner.locator('header[aria-label="Response"]').innerText()).match(/\d+ of (\d+) decided/)![1]);
  expect(total).toBeGreaterThan(5);

  // 2. Assign the question the knowledge base cannot answer to a colleague.
  await caption(owner, `Asks ${member.name} to answer the question the knowledge base cannot`);
  const charter = await expand(owner, CHARTER);
  await charter.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  await charter.locator('div.flex.items-start', { has: owner.getByText(member.name, { exact: true }) })
    .getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(charter.getByText('Assigned', { exact: true })).toBeVisible();

  // 3. The colleague answers it and approves their answer, as someone asked may.
  const colleague = await signIn(browser, member);
  await caption(colleague, `${member.name} answers it from Assignments`);
  await nav(colleague, 'Assignments');
  await colleague.getByRole('region', { name: 'Questions' }).getByRole('button', { name: new RegExp(CHARTER.replace(/[?]/g, '\\?')) }).click();
  const panel = colleague.getByRole('complementary', { name: 'The question' });
  await panel.getByLabel('Your answer').fill(answer);
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(panel.getByText(/Approved/).first()).toBeVisible();

  // 4. The owner decides the rest: approves those with a draft, leaves the others unanswered.
  await caption(owner, `${admin.name} decides the rest: approves the drafts, leaves the others unanswered`);
  await owner.reload();
  await openResponse(owner, name);
  for (let guard = 0; guard < total + 2; guard++) {
    const next = owner.locator('section[aria-labelledby="group-needs"] [id^="question-"], section[aria-labelledby="group-ready"] [id^="question-"]').first();
    if (!(await next.count())) break;
    const id = await next.getAttribute('id');
    await next.locator('p').first().click();
    const approve = next.getByRole('button', { name: 'Approve', exact: true });
    const save = owner.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
    if (await approve.isVisible() && await approve.isEnabled()) await approve.click();
    else await next.getByRole('button', { name: 'Leave unanswered' }).click();
    await save;
    await expect(owner.locator(`section[aria-labelledby="group-needs"] [id="${id}"], section[aria-labelledby="group-ready"] [id="${id}"]`)).toHaveCount(0);
  }
  await expect(owner.locator('header[aria-label="Response"]')).toContainText(`${total} of ${total} decided`);

  // 5. Download the Excel file: it holds every approved answer, the colleague's among them.
  await caption(owner, 'Downloads the answers: the Excel file holds every approved answer');
  const send = owner.getByRole('region', { name: 'Send the response' });
  const download = owner.waitForEvent('download');
  await send.getByRole('button', { name: /^Excel/ }).click();
  const file = await (await download).path();
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  // The answers sheet: a row per decided question, the answer column holding each approved answer
  // and the not-answered wording for the rest (exportRows in src/exportUtils.ts).
  const sheet = book.getWorksheet('RFI Responses')!;
  const head = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  const col = head.indexOf('Answer');
  const answers: string[] = [];
  sheet.eachRow((row, n) => { if (n > 1) answers.push(String(row.getCell(col).text ?? '')); });
  const count = async (title: string) => Number((await owner.locator('h3', { hasText: new RegExp(`^\\s*${title} \\(\\d+\\)$`) }).innerText().catch(() => '(0)')).match(/\((\d+)\)/)![1]);
  const approved = await count('Approved');
  const unanswered = await count('Not answered');
  expect(approved).toBeGreaterThan(0);
  expect(answers).toHaveLength(total);
  expect(answers.filter((a) => a === NOT_ANSWERED)).toHaveLength(unanswered);
  expect(answers.filter((a) => a && a !== NOT_ANSWERED)).toHaveLength(approved);
  expect(answers).toContain(answer);

  // 6. Mark as sent, and see what the knowledge base did with the answers. Locally the providers are
  // off, so no checker classified the questions: each is held as not fully checked, and learning
  // refuses such answers (the allow list, Sprint 3). The page must say so, and nothing may reach the
  // knowledge base. That a checked answer becomes an entry is proven by the database tests
  // (the workflow tests in supabase/tests/db/workflow.test.ts and the later sprints' tests).
  await caption(owner, 'Marks the response as sent');
  await send.getByRole('button', { name: 'Mark as sent' }).click();
  await owner.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  await caption(owner, 'The page says what the knowledge base did: here, with no checker, nothing was learned');
  await expect(send).toContainText(/not learned \(not fully checked\)/);
  await nav(owner, 'Knowledge');
  await expect(owner.getByRole('region', { name: 'Learned recently' })).toBeVisible();
  await expect(owner.getByRole('region', { name: 'Learned recently' }).getByText(CHARTER)).toHaveCount(0);
});
