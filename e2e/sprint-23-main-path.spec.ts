/**
 * Sprint 23 (S23-2, F-66): the main path as one browser test, in order, on a response the test
 * makes: an owner adds a response, uploads a questionnaire and drafts it; a colleague answers the
 * question they were asked; the owner decides the rest, downloads the Excel file and marks the
 * response as sent, and the colleague's answer is learned with the response named as its source.
 *
 * On staging it runs with the real AI (Rory, at the Sprint 23 QA review: a third real-AI step a run),
 * where drafts are checked, so bulk approval has something to take and an answer can be learned.
 * Locally the providers are off: no checker classifies the questions, each is held as not fully
 * checked, nothing is ready to approve in bulk, and learning rightly refuses the answers; there the
 * test checks that the page says so and nothing reaches the knowledge base.
 *
 * Since Sprint 24 (S24-1, U-11) the customer's questionnaire arrives as two files, the sample's first
 * and second halves: the list, bulk approval and Mark as sent are the whole response's, and each file
 * downloads on its own. The same twelve questions are drafted, so the real-AI cost is unchanged.
 */
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, expand, unfold } from './support';

const { admin, member } = PEOPLE;
/** The export's wording for a question left unanswered (NOT_ANSWERED in src/exportUtils.ts). */
const NOT_ANSWERED = 'Not answered';
const CHARTER = 'Do you hold the Coral Bay Retail Supplier Charter accreditation?';
/** The sample questionnaire in two halves, as a customer might send it (S24-1). */
const SAMPLE = readFileSync('sample-data/try-it-questionnaire.csv', 'utf8').trim().split(/\r?\n/);
const HALVES = [
  { name: 'main-path-part-1.csv', rows: SAMPLE.slice(1, 7) },
  { name: 'main-path-part-2.csv', rows: SAMPLE.slice(7) },
].map((h) => ({ ...h, buffer: Buffer.from([SAMPLE[0], ...h.rows].join('\n') + '\n') }));

test('The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent', async ({ browser }) => {
  // Every step, in order, runs only on staging (bulk approval and learning need checked drafts).
  checks(...(TARGET === 'staging' ? ['S23-2 1', 'S23-2 2', 'S23-2 3', 'S24-1 3'] : ['S23-2 2']), 'S24-1 4', 'S24-1 7', 'S24-2 1');
  if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Drafts a whole questionnaire with the real models' });
  test.setTimeout(480_000);
  const name = `Main path (S23-2) ${Date.now()}`;
  const answer = `No; we would apply for it within 90 days of contract (synthetic answer, ${Date.now()}).`;

  // 1. Add a response and upload its questionnaire, which comes in two files.
  const owner = await signIn(browser, admin);
  await caption(owner, `${admin.name} adds a response`);
  await nav(owner, 'Responses');
  await owner.getByRole('button', { name: 'New response' }).click();
  await owner.getByLabel(/^Name/).fill(name);
  await owner.getByRole('button', { name: /^Create/ }).click();
  await caption(owner, 'Uploads the customer\'s questionnaire, in two files, and drafts them (the question column is found by its heading)');
  for (const [i, half] of HALVES.entries()) {
    if (i > 0) await owner.locator('header[aria-label="Response"]').getByRole('button', { name: 'Add a file' }).click();
    await owner.locator('input[type=file]').setInputFiles({ name: half.name, mimeType: 'text/csv', buffer: half.buffer });
    await owner.getByRole('button', { name: 'Match and draft' }).click();
    await owner.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 240_000 });
    await expect(owner.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 240_000 });
  }
  // The header's figures are read again once drafting ends: wait for them to count the questions.
  const header = owner.locator('header[aria-label="Response"]');
  const totalNow = async () => Number((await header.innerText()).match(/\d+ of (\d+) decided/)?.[1] ?? 0);
  await expect.poll(totalNow, { timeout: 30_000 }).toBe(HALVES[0].rows.length + HALVES[1].rows.length);
  const total = await totalNow();
  // One list: every question of both files, each card naming its file (S24-1 1).
  await unfold(owner);
  await expect(owner.locator('[id^="question-"]')).toHaveCount(total);
  for (const half of HALVES) await expect(owner.locator('[id^="question-"]', { hasText: `From ${half.name}` })).toHaveCount(half.rows.length);

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
  if (TARGET === 'staging') {
    await caption(owner, 'Approves in bulk the drafts nothing holds, across both files');
    const ready = owner.locator('section[aria-labelledby="group-ready"] [id^="question-"]');
    expect(await ready.count()).toBeGreaterThan(0);
    // Which questions the page calls ready, and which need a person, before the one bulk approval (S24-1 3).
    const ids = async (group: string) => owner.locator(`section[aria-labelledby="group-${group}"] [id^="question-"]`).evaluateAll((els) => els.map((e) => e.id));
    const readyIds = await ids('ready');
    const needsIds = await ids('needs');
    const readyFiles = new Set(await ready.evaluateAll((els) => els.map((e) => e.textContent?.match(/From (main-path-part-\d\.csv)/)?.[1]).filter(Boolean)));
    test.info().annotations.push({ type: 'note', description: `Ready to approve before bulk approval: ${readyIds.length}, from ${[...readyFiles].join(' and ')}` });
    await owner.getByRole('button', { name: 'All eligible' }).click();
    await expect(owner.locator('section[aria-labelledby="group-ready"]')).toHaveCount(0);
    // Exactly those: every ready question, from whichever file, is approved; every held one still needs a person.
    await unfold(owner);
    expect((await ids('approved')).filter((id) => readyIds.includes(id)).sort()).toEqual([...readyIds].sort());
    expect((await ids('needs')).sort()).toEqual([...needsIds].sort());
  }
  await caption(owner, 'And the rest one at a time');
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

  // 5. Download each file's answers: together they hold every approved answer, the colleague's among them.
  await caption(owner, 'Downloads the answers, one Excel file for each of the customer\'s files');
  const send = owner.getByRole('region', { name: 'Send the response' });
  const answers: string[] = [];
  for (const half of HALVES) {
    const download = owner.waitForEvent('download');
    await send.getByRole('group', { name: `Download ${half.name}` }).getByRole('button', { name: /^Excel/ }).click();
    const got = await download;
    // Each download is named for its file and holds that file's questions only (S24-1 7).
    expect(got.suggestedFilename()).toBe(half.name.replace(/\.csv$/, '.xlsx'));
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await got.path());
    // The answers sheet: a row per decided question, the answer column holding each approved answer
    // and the not-answered wording for the rest (exportRows in src/exportUtils.ts).
    const sheet = book.getWorksheet('RFI Responses')!;
    const head = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
    const col = head.indexOf('Answer');
    const qcol = head.indexOf('Question');
    const these: string[] = [];
    const asked: string[] = [];
    sheet.eachRow((row, n) => { if (n > 1) { these.push(String(row.getCell(col).text ?? '')); asked.push(String(row.getCell(qcol).text ?? '')); } });
    expect(these).toHaveLength(half.rows.length);
    // Its own questions only (QA review, M2), by their text.
    expect(asked.sort()).toEqual(half.rows.map((r) => r.slice(r.indexOf(',') + 1)).sort());
    answers.push(...these);
  }
  const count = async (title: string) => Number((await owner.locator('h3', { hasText: new RegExp(`^\\s*${title} \\(\\d+\\)$`) }).innerText().catch(() => '(0)')).match(/\((\d+)\)/)![1]);
  const approved = await count('Approved');
  const unanswered = await count('Not answered');
  expect(approved).toBeGreaterThan(0);
  expect(answers).toHaveLength(total);
  expect(answers.filter((a) => a === NOT_ANSWERED)).toHaveLength(unanswered);
  expect(answers.filter((a) => a && a !== NOT_ANSWERED)).toHaveLength(approved);
  expect(answers).toContain(answer);

  // 6. Mark as sent, once for the whole response, and see what the knowledge base did with the answers.
  await caption(owner, 'Marks the whole response as sent, both files at once');
  await send.getByRole('button', { name: 'Mark as sent' }).click();
  await owner.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  if (TARGET !== 'staging') {
    // Locally, with no checker, every answer is held as not fully checked and is not learned; the
    // page says so as soon as it is sent (the report is not kept once the response is closed).
    await caption(owner, 'Locally, with no checker, nothing was learned, and the page says so');
    await expect(send).toContainText(/not learned \(not fully checked\)/);
  }
  const report = (await send.innerText()).match(/Knowledge base: [^\n]+/)![0];
  // Opened again later, the response still says what was learned, in the same words (S24-2 1).
  await caption(owner, 'Opened again later, the response still says what the knowledge base did with it');
  await nav(owner, 'Responses');
  await openResponse(owner, name);
  await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  await expect(send).toContainText(report);
  // Sent: no file can be added now (S24-1 8).
  await expect(owner.locator('header[aria-label="Response"]').getByRole('button', { name: 'Add a file' })).toHaveCount(0);
  await expect(owner.locator('header[aria-label="Response"]')).toContainText('Marked as sent, so no file can be added: a later questionnaire is a new response.');
  await nav(owner, 'Knowledge');
  const learned = owner.getByRole('region', { name: 'Learned recently' });
  // The list has loaded once it shows an answer learned earlier in the run (Sprint 21, Larkspur).
  await expect(learned.getByRole('button').first()).toBeVisible();
  if (TARGET === 'staging') {
    await caption(owner, `The knowledge base has ${member.name}'s answer, learned from this response`);
    const entry = learned.getByRole('button').filter({ hasText: CHARTER }).first();
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(`from ${name}`);
  } else {
    await expect(learned.getByText(CHARTER)).toHaveCount(0);
  }
});
