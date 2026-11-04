# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sprint-23-main-path.spec.ts >> The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent
- Location: e2e/sprint-23-main-path.spec.ts:22:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'The question' }).getByText(/Approved/).first()
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'The question' }).getByText(/Approved/).first() with timeout 15000ms
  - waiting for getByRole('complementary', { name: 'The question' }).getByText(/Approved/).first()

```

```yaml
- banner:
  - img
  - text: RFI Respond
  - navigation:
    - button "Home":
      - img
      - text: Home
    - button "Responses":
      - img
      - text: Responses
    - button "Knowledge":
      - img
      - text: Knowledge
    - button "Assignments":
      - img
      - text: Assignments
    - button "Team":
      - img
      - text: Team
  - button "Help":
    - img
    - text: Help
  - text: T
  - paragraph: Tom Richardson
  - button "Sign out":
    - img
- main:
  - heading "Assignments" [level=1]
  - paragraph: Questions a colleague asked you about, and the ones you asked others about.
  - img
  - text: 3 being worked on
  - button "Refresh":
    - img
  - button "Questions for you"
  - button "Sent"
  - region "Questions":
    - 'button "What compliance certifications does your organization hold? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · You handed this back; the owner decides"'
    - 'button "What is the annual subscription price for 250 users? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · Working on it"'
    - button "Do you hold the Coral Bay Retail Supplier Charter accreditation? Main path (S23-2) 1793829407323 · Working on it" [pressed]
    - paragraph: Decided
    - 'button "Do you give staff paid volunteering days each year? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · Approved; nothing more is needed from you"'
    - 'button "What endpoint protection solutions are deployed? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · Approved; nothing more is needed from you"'
  - paragraph: Approved. The owner will see it as decided.
  - complementary "The question":
    - paragraph: Main path (S23-2) 1793829407323 · asked by Sarah Chen
    - heading "Do you hold the Coral Bay Retail Supplier Charter accreditation?" [level=2]
    - paragraph: Working on it.
    - button "Open it in the response":
      - text: Open it in the response
      - img
    - paragraph:
      - text: "Confidence:"
      - strong: Not calibrated
    - paragraph:
      - strong: "Held back from bulk approval:"
      - text: The classifier was unavailable, so this question was not fully checked for pricing or legal terms; review it individually.
    - paragraph:
      - text: "Drawn from:"
      - button "KB-0017"
      - text: ","
      - button "KB-0018"
    - button "Add Notes"
    - text: Your answer
    - textbox "Your answer": "We maintain a SOC 2 Type II report covering the Trust Services Criteria for Security, Availability, and Confidentiality, issued by an independent AICPA-accredited auditor. The audit period covers a minimum of six months and reports are refreshed annually, with bridge letters available upon request for periods between reports. Our Information Security Management System (ISMS) is certified to ISO/IEC 27001:2022 by an accredited certification body, covering all in-scope systems and processes defined in the Statement of Applicability (SoA). Surveillance audits occur annually, with full recertification every three years. [References: KB-0017, KB-0018]"
    - button "Approve"
    - button "Send to the owner"
    - button "Hand back"
    - paragraph:
      - strong: Approve
      - text: decides the question with your answer, as the owner could.
      - strong: Send to the owner
      - text: leaves the decision to them. Either way a person has approved every answer before it is sent.
```

# Test source

```ts
  1   | /**
  2   |  * Sprint 23 (S23-2, F-66): the main path as one browser test, in order, on a response the test
  3   |  * makes: an owner adds a response, uploads a questionnaire and drafts it; a colleague answers the
  4   |  * question they were asked; the owner decides the rest, downloads the Excel file and marks the
  5   |  * response as sent, and the colleague's answer is learned with the response named as its source.
  6   |  *
  7   |  * On staging it runs with the real AI (Rory, at the Sprint 23 QA review: a third real-AI step a run),
  8   |  * where drafts are checked, so bulk approval has something to take and an answer can be learned.
  9   |  * Locally the providers are off: no checker classifies the questions, each is held as not fully
  10  |  * checked, nothing is ready to approve in bulk, and learning rightly refuses the answers; there the
  11  |  * test checks that the page says so and nothing reaches the knowledge base.
  12  |  */
  13  | import { readFileSync } from 'node:fs';
  14  | import ExcelJS from 'exceljs';
  15  | import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, expand } from './support';
  16  | 
  17  | const { admin, member } = PEOPLE;
  18  | /** The export's wording for a question left unanswered (NOT_ANSWERED in src/exportUtils.ts). */
  19  | const NOT_ANSWERED = 'Not answered';
  20  | const CHARTER = 'Do you hold the Coral Bay Retail Supplier Charter accreditation?';
  21  | 
  22  | test('The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent', async ({ browser }) => {
  23  |   // Every step, in order, runs only on staging (bulk approval and learning need checked drafts).
  24  |   checks(...(TARGET === 'staging' ? ['S23-2 1', 'S23-2 2', 'S23-2 3'] : ['S23-2 2']));
  25  |   if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Drafts a whole questionnaire with the real models' });
  26  |   test.setTimeout(480_000);
  27  |   const name = `Main path (S23-2) ${Date.now()}`;
  28  |   const answer = `No; we would apply for it within 90 days of contract (synthetic answer, ${Date.now()}).`;
  29  | 
  30  |   // 1. Add a response and upload its questionnaire.
  31  |   const owner = await signIn(browser, admin);
  32  |   await caption(owner, `${admin.name} adds a response`);
  33  |   await nav(owner, 'Responses');
  34  |   await owner.getByRole('button', { name: 'New response' }).click();
  35  |   await owner.getByLabel(/^Name/).fill(name);
  36  |   await owner.getByRole('button', { name: /^Create/ }).click();
  37  |   await caption(owner, 'Uploads the customer\'s questionnaire and drafts it (the question column is found by its heading)');
  38  |   await owner.locator('input[type=file]').setInputFiles({ name: 'main-path-questionnaire.csv', mimeType: 'text/csv', buffer: readFileSync('sample-data/try-it-questionnaire.csv') });
  39  |   await owner.getByRole('button', { name: 'Match and draft' }).click();
  40  |   await owner.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 240_000 });
  41  |   await expect(owner.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 240_000 });
  42  |   // The header's figures are read again once drafting ends: wait for them to count the questions.
  43  |   const header = owner.locator('header[aria-label="Response"]');
  44  |   const totalNow = async () => Number((await header.innerText()).match(/\d+ of (\d+) decided/)?.[1] ?? 0);
  45  |   await expect.poll(totalNow, { timeout: 30_000 }).toBeGreaterThan(5);
  46  |   const total = await totalNow();
  47  | 
  48  |   // 2. Assign the question the knowledge base cannot answer to a colleague.
  49  |   await caption(owner, `Asks ${member.name} to answer the question the knowledge base cannot`);
  50  |   const charter = await expand(owner, CHARTER);
  51  |   await charter.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  52  |   await charter.locator('div.flex.items-start', { has: owner.getByText(member.name, { exact: true }) })
  53  |     .getByRole('button', { name: 'Assign', exact: true }).click();
  54  |   await expect(charter.getByText('Assigned', { exact: true })).toBeVisible();
  55  | 
  56  |   // 3. The colleague answers it and approves their answer, as someone asked may.
  57  |   const colleague = await signIn(browser, member);
  58  |   await caption(colleague, `${member.name} answers it from Assignments`);
  59  |   await nav(colleague, 'Assignments');
  60  |   await colleague.getByRole('region', { name: 'Questions' }).getByRole('button', { name: new RegExp(CHARTER.replace(/[?]/g, '\\?')) }).click();
  61  |   const panel = colleague.getByRole('complementary', { name: 'The question' });
  62  |   await panel.getByLabel('Your answer').fill(answer);
  63  |   await panel.getByRole('button', { name: 'Approve', exact: true }).click();
> 64  |   await expect(panel.getByText(/Approved/).first()).toBeVisible();
      |                                                     ^ Error: expect(locator).toBeVisible() failed
  65  | 
  66  |   // 4. The owner decides the rest: approves those with a draft, leaves the others unanswered.
  67  |   await caption(owner, `${admin.name} decides the rest: approves the drafts, leaves the others unanswered`);
  68  |   await owner.reload();
  69  |   await openResponse(owner, name);
  70  |   if (TARGET === 'staging') {
  71  |     await caption(owner, 'Approves in bulk the drafts nothing holds');
  72  |     const ready = owner.locator('section[aria-labelledby="group-ready"] [id^="question-"]');
  73  |     expect(await ready.count()).toBeGreaterThan(0);
  74  |     await owner.getByRole('button', { name: 'All eligible' }).click();
  75  |     await expect(owner.locator('section[aria-labelledby="group-ready"]')).toHaveCount(0);
  76  |   }
  77  |   await caption(owner, 'And the rest one at a time');
  78  |   for (let guard = 0; guard < total + 2; guard++) {
  79  |     const next = owner.locator('section[aria-labelledby="group-needs"] [id^="question-"], section[aria-labelledby="group-ready"] [id^="question-"]').first();
  80  |     if (!(await next.count())) break;
  81  |     const id = await next.getAttribute('id');
  82  |     await next.locator('p').first().click();
  83  |     const approve = next.getByRole('button', { name: 'Approve', exact: true });
  84  |     const save = owner.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
  85  |     if (await approve.isVisible() && await approve.isEnabled()) await approve.click();
  86  |     else await next.getByRole('button', { name: 'Leave unanswered' }).click();
  87  |     await save;
  88  |     await expect(owner.locator(`section[aria-labelledby="group-needs"] [id="${id}"], section[aria-labelledby="group-ready"] [id="${id}"]`)).toHaveCount(0);
  89  |   }
  90  |   await expect(owner.locator('header[aria-label="Response"]')).toContainText(`${total} of ${total} decided`);
  91  | 
  92  |   // 5. Download the Excel file: it holds every approved answer, the colleague's among them.
  93  |   await caption(owner, 'Downloads the answers: the Excel file holds every approved answer');
  94  |   const send = owner.getByRole('region', { name: 'Send the response' });
  95  |   const download = owner.waitForEvent('download');
  96  |   await send.getByRole('button', { name: /^Excel/ }).click();
  97  |   const file = await (await download).path();
  98  |   const book = new ExcelJS.Workbook();
  99  |   await book.xlsx.readFile(file);
  100 |   // The answers sheet: a row per decided question, the answer column holding each approved answer
  101 |   // and the not-answered wording for the rest (exportRows in src/exportUtils.ts).
  102 |   const sheet = book.getWorksheet('RFI Responses')!;
  103 |   const head = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  104 |   const col = head.indexOf('Answer');
  105 |   const answers: string[] = [];
  106 |   sheet.eachRow((row, n) => { if (n > 1) answers.push(String(row.getCell(col).text ?? '')); });
  107 |   const count = async (title: string) => Number((await owner.locator('h3', { hasText: new RegExp(`^\\s*${title} \\(\\d+\\)$`) }).innerText().catch(() => '(0)')).match(/\((\d+)\)/)![1]);
  108 |   const approved = await count('Approved');
  109 |   const unanswered = await count('Not answered');
  110 |   expect(approved).toBeGreaterThan(0);
  111 |   expect(answers).toHaveLength(total);
  112 |   expect(answers.filter((a) => a === NOT_ANSWERED)).toHaveLength(unanswered);
  113 |   expect(answers.filter((a) => a && a !== NOT_ANSWERED)).toHaveLength(approved);
  114 |   expect(answers).toContain(answer);
  115 | 
  116 |   // 6. Mark as sent, and see what the knowledge base did with the answers.
  117 |   await caption(owner, 'Marks the response as sent');
  118 |   await send.getByRole('button', { name: 'Mark as sent' }).click();
  119 |   await owner.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  120 |   await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  121 |   if (TARGET !== 'staging') {
  122 |     // Locally, with no checker, every answer is held as not fully checked and is not learned; the
  123 |     // page says so as soon as it is sent (the report is not kept once the response is closed).
  124 |     await caption(owner, 'Locally, with no checker, nothing was learned, and the page says so');
  125 |     await expect(send).toContainText(/not learned \(not fully checked\)/);
  126 |   }
  127 |   await nav(owner, 'Knowledge');
  128 |   const learned = owner.getByRole('region', { name: 'Learned recently' });
  129 |   // The list has loaded once it shows an answer learned earlier in the run (Sprint 21, Larkspur).
  130 |   await expect(learned.getByRole('button').first()).toBeVisible();
  131 |   if (TARGET === 'staging') {
  132 |     await caption(owner, `The knowledge base has ${member.name}'s answer, learned from this response`);
  133 |     const entry = learned.getByRole('button').filter({ hasText: CHARTER }).first();
  134 |     await expect(entry).toBeVisible();
  135 |     await expect(entry).toContainText(`from ${name}`);
  136 |   } else {
  137 |     await expect(learned.getByText(CHARTER)).toHaveCount(0);
  138 |   }
  139 | });
  140 | 
```