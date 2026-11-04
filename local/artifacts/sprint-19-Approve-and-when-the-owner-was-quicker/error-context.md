# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sprint-19.spec.ts >> Approve, and when the owner was quicker
- Location: e2e/sprint-19.spec.ts:177:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.') with timeout 15000ms
  - waiting for getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.')

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
  - text: 1 being worked on
  - button "Refresh":
    - img
  - button "Questions for you"
  - button "Sent"
  - region "Questions":
    - 'button "What compliance certifications does your organization hold? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · You handed this back; the owner decides"'
    - paragraph: Decided
    - 'button "Do you give staff paid volunteering days each year? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · Approved; nothing more is needed from you"'
    - 'button "What endpoint protection solutions are deployed? Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · Approved; nothing more is needed from you" [pressed]'
  - paragraph: Approved. The owner will see it as decided.
  - complementary "The question":
    - paragraph: "Bluefin Freight (fictional): security questionnaire · due 6 Nov 2026 · asked by Sarah Chen"
    - heading "What endpoint protection solutions are deployed?" [level=2]
    - paragraph: Approved; nothing more is needed from you.
    - button "Open it in the response":
      - text: Open it in the response
      - img
    - paragraph:
      - text: "Confidence:"
      - strong: High
      - text: "(85%) · Checker:"
      - strong: Partly
      - text: ", KB-0011 states that endpoints are protected by an EDR solution, which answers the question in general terms. It does not name the specific product or vendor, which the question's request for solutions implies."
    - paragraph:
      - text: "Drawn from:"
      - button "KB-0011"
    - text: "We protect all endpoints with an EDR (Endpoint Detection and Response) solution that provides real-time threat detection, behavioral analysis, and automated response. Endpoints must be enrolled in MDM before accessing corporate resources, and compliance checks enforce OS patching, disk encryption, and screen lock policies. USB and removable media use is restricted by policy and enforced through DLP controls. [References: KB-0011]"
```

# Test source

```ts
  103 | 
  104 |   await caption(m, 'Notes for the owner');
  105 |   await panel.getByRole('button', { name: 'Add Notes' }).click();
  106 |   await panel.getByLabel('Notes, for you and the owner').fill('Checked with HR.');
  107 |   await panel.getByRole('button', { name: 'Save notes' }).click();
  108 |   await expect(m.getByText('Notes saved.')).toBeVisible();
  109 |   await expect(panel.getByText('Notes: Checked with HR.')).toBeVisible();
  110 | 
  111 |   await caption(m, 'The answer, sent to the owner to decide');
  112 |   const answer = 'Yes. Every employee has two paid volunteering days a year (synthetic answer for the demo).';
  113 |   await panel.getByLabel('Your answer').fill(answer);
  114 |   await panel.getByRole('button', { name: 'Send to the owner' }).click();
  115 |   await expect(m.getByText('Sent to the owner, who decides.')).toBeVisible();
  116 |   await expect(forYouRow(m, SEND)).toContainText('You sent your answer to the owner');
  117 | 
  118 |   await caption(boss, `${admin.name} sees it on Home, under Answered by colleagues`);
  119 |   await nav(boss, 'Home');
  120 |   const answered = boss.getByRole('button', { name: new RegExp(escape(SEND)) });
  121 |   await expect(answered).toContainText(`${member.name} answered · ${BLUEFIN}`);
  122 |   await answered.click();
  123 | 
  124 |   await caption(boss, 'It opens the response at that question, still to do, with their answer and Use their answer');
  125 |   const c = card(boss, SEND);
  126 |   await expect(c.getByText(`${member.name} marked it answered, with this answer:`)).toBeVisible();
  127 |   await expect(c.getByText(answer)).toBeVisible();
  128 |   await expect(c.getByText('Checked with HR.')).toBeVisible();
  129 |   await expect(c.getByRole('button', { name: 'Leave unanswered' })).toBeVisible();
  130 |   await c.getByRole('button', { name: 'Use their answer' }).click();
  131 |   await expect(c.locator('textarea')).toHaveValue(answer);
  132 |   await c.getByRole('button', { name: 'Save & approve' }).click();
  133 |   await expect(c.getByText(approvedBy(admin.name))).toBeVisible();
  134 | });
  135 | 
  136 | test('Hand back, with a note', async ({ browser }) => {
  137 |   checks('S19 4');
  138 |   const boss = await signIn(browser, admin);
  139 |   await assign(boss, HAND_BACK);
  140 | 
  141 |   const m = await signIn(browser, member);
  142 |   const panel = await openForYou(m, HAND_BACK);
  143 |   await caption(m, 'The question has a draft, its confidence and checker, and the answers it was drawn from');
  144 |   await expect(panel.getByLabel('Your answer')).not.toHaveValue('');
  145 |   await expect(panel).toContainText(/Confidence: .+ · Checker: /);
  146 |   await expect(panel.getByRole('button', { name: 'KB-0018' })).toBeVisible();
  147 | 
  148 |   await caption(m, `${member.name} is not the right person: Hand back, with a reason of at least 5 characters`);
  149 |   await panel.getByRole('button', { name: 'Hand back' }).click();
  150 |   const why = panel.getByLabel('Why is this not for you?');
  151 |   const send = panel.getByRole('button', { name: 'Hand it back' });
  152 |   for (const short of ['no', 'abcd', '   ab   ']) {
  153 |     await why.fill(short);
  154 |     await expect(send).toBeDisabled();
  155 |   }
  156 |   await why.fill('abcde');
  157 |   await expect(send).toBeEnabled();
  158 |   await why.fill('Ask the legal team.');
  159 |   await send.click();
  160 |   await expect(m.getByText('Handed back to the owner, with your note.')).toBeVisible();
  161 |   await expect(forYouRow(m, HAND_BACK)).toContainText('You handed this back');
  162 | 
  163 |   await caption(boss, `${admin.name} sees it handed back, on Home and on the question`);
  164 |   await nav(boss, 'Home');
  165 |   const item = boss.getByRole('button', { name: new RegExp(escape(HAND_BACK)) });
  166 |   await expect(item).toContainText(`${member.name} handed this back: Handed back: Ask the legal team. · ${BLUEFIN}`);
  167 |   await item.click();
  168 |   const c = card(boss, HAND_BACK);
  169 |   await expect(c.getByText(`${member.name} handed this back:`)).toBeVisible();
  170 |   await expect(c.getByText(/Ask the legal team\./)).toBeVisible();
  171 | 
  172 |   await caption(m, 'The answers it was drawn from open on their own page under Knowledge');
  173 |   await m.getByRole('complementary', { name: 'The question' }).getByRole('button', { name: 'KB-0018' }).click();
  174 |   await expect(m.getByRole('complementary', { name: 'Selected answer' })).toContainText('KB-0018');
  175 | });
  176 | 
  177 | test('Approve, and when the owner was quicker', async ({ browser }) => {
  178 |   checks('S19 5');
  179 |   const boss = await signIn(browser, admin);
  180 |   await assign(boss, STALE);
  181 |   const m = await signIn(browser, member);
  182 |   const panel = await openForYou(m, STALE);
  183 | 
  184 |   await caption(boss, `Meanwhile ${admin.name} approves the same question`);
  185 |   const c = card(boss, STALE);
  186 |   // The save itself, not only the card (which shows the decision at once): a reload before the
  187 |   // save answers would cut it off (the staging run of bd80749).
  188 |   const saved = boss.waitForResponse((r) => r.url().includes('/rest/v1/rpc/approve_answer') && r.ok());
  189 |   await c.getByRole('button', { name: 'Approve', exact: true }).click();
  190 |   await expect(c.getByText(approvedBy(admin.name))).toBeVisible();
  191 |   await saved;
  192 |   // The card shows the decision at once and saves it in the background; this case is about a decision
  193 |   // already saved, so wait until the database has it (the staging run of 7651216 pressed Approve between
  194 |   // the two, and got the other, also true, message).
  195 |   await boss.reload();
  196 |   await openResponse(boss, BLUEFIN);
  197 |   await expect((await expand(boss, STALE)).getByText(approvedBy(admin.name))).toBeVisible();
  198 | 
  199 |   await caption(m, `${member.name}, on the screen opened before, presses Approve: nothing is overwritten`);
  200 |   const other = 'A different answer, written on a screen opened before the owner decided.';
  201 |   await panel.getByLabel('Your answer').fill(other);
  202 |   await panel.getByRole('button', { name: 'Approve', exact: true }).click();
> 203 |   await expect(m.getByText('The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision.')).toBeVisible();
      |                                                                                                                                                            ^ Error: expect(locator).toBeVisible() failed
  204 |   await expect(forYouRow(m, STALE)).toContainText('Approved; nothing more is needed from you');
  205 | 
  206 |   await boss.reload();
  207 |   await openResponse(boss, BLUEFIN);
  208 |   const after = await expand(boss, STALE);
  209 |   await expect(after.getByText(approvedBy(admin.name))).toBeVisible();
  210 |   await expect(after.getByText(other)).toHaveCount(0);
  211 | 
  212 |   await caption(boss, `A question nobody else is deciding: ${member.name} writes the answer and approves it`);
  213 |   await assign(boss, APPROVE);
  214 |   await m.reload();
  215 |   const p2 = await openForYou(m, APPROVE);
  216 |   await p2.getByLabel('Your answer').fill('We detect phishing with mail filtering and user reports, and respond under the incident process (synthetic answer).');
  217 |   await p2.getByRole('button', { name: 'Approve', exact: true }).click();
  218 |   await expect(m.getByText('Approved. The owner will see it as decided.')).toBeVisible();
  219 |   await expect(forYouRow(m, APPROVE)).toContainText('Approved; nothing more is needed from you');
  220 |   await boss.reload();
  221 |   await openResponse(boss, BLUEFIN);
  222 |   const c2 = await expand(boss, APPROVE);
  223 |   await expect(c2.getByText(approvedBy(member.name))).toBeVisible();
  224 | });
  225 | 
  226 | test('On a phone, and the Sent list', async ({ browser }) => {
  227 |   checks('S19 6');
  228 |   const boss = await signIn(browser, admin);
  229 |   await assign(boss, SENT);
  230 | 
  231 |   const phone = await signIn(browser, member, { width: 390, height: 844 });
  232 |   await caption(phone, 'At phone width Home stacks and nothing scrolls sideways');
  233 |   expect(await overflow(phone)).toEqual([]);
  234 |   const needs = await phone.getByRole('heading', { name: 'Needs you' }).boundingBox();
  235 |   const know = await phone.getByRole('complementary', { name: 'What we know' }).boundingBox();
  236 |   expect(know!.y).toBeGreaterThan(needs!.y);
  237 |   await nav(phone, 'Assignments');
  238 |   await caption(phone, 'Assignments stacks too: the list, then the question');
  239 |   // Opening it saves "Working on it"; the owner's list below is read after that save answers
  240 |   // (the staging run of 1aed1dc read it first).
  241 |   const started = phone.waitForResponse((r) => r.url().includes('/rest/v1/question_assignments') && r.request().method() === 'PATCH' && r.ok());
  242 |   await forYouRow(phone, SENT).click();
  243 |   await started;
  244 |   const list = await phone.getByRole('region', { name: 'Questions' }).boundingBox();
  245 |   const q = await phone.getByRole('complementary', { name: 'The question' }).boundingBox();
  246 |   expect(q!.y).toBeGreaterThan(list!.y);
  247 |   expect(await overflow(phone)).toEqual([]);
  248 | 
  249 |   await caption(boss, 'Sent lists the questions you assigned, with their stages, and no buttons to move them on by hand');
  250 |   await nav(boss, 'Assignments');
  251 |   await boss.getByRole('button', { name: 'Sent', exact: true }).click();
  252 |   const row = boss.locator('div.rounded-2xl.border', { has: boss.getByText(SENT, { exact: true }) });
  253 |   await expect(row.locator('.status-pill')).toHaveText('Working on it');
  254 |   await row.getByText(SENT, { exact: true }).click();
  255 |   await expect(row.getByRole('button', { name: /Add Notes|Edit Notes/ })).toBeVisible();
  256 |   for (const old of ['Start working on it', 'Mark as answered', 'Mark as approved']) {
  257 |     await expect(row.getByRole('button', { name: old })).toHaveCount(0);
  258 |   }
  259 | });
  260 | 
  261 | test('A member who was not assigned cannot see or decide the question', async ({ browser }) => {
  262 |   test.skip(TARGET === 'staging', 'Needs a third person: the seed has one, staging has two test people');
  263 |   checks('S19 8');
  264 |   const maya = await signIn(browser, { email: 'maya.patel@example.com', name: 'Maya Patel' });
  265 |   await caption(maya, 'Maya was assigned nothing on Bluefin: Home does not list it, and the card has no decision buttons');
  266 |   await expect(maya.getByRole('button', { name: new RegExp(escape(STALE)) })).toHaveCount(0);
  267 |   await openResponse(maya, BLUEFIN);
  268 |   const c = card(maya, SENT);
  269 |   await c.getByText(SENT, { exact: true }).click();
  270 |   await expect(c.getByText('Only the response owner, an admin, or someone this question is assigned to can decide it.')).toBeVisible();
  271 |   await expect(c.getByRole('button', { name: /^(Approve|Write an answer)$/ })).toHaveCount(0);
  272 | });
  273 | 
  274 | /** Elements wider than the window at its current width: the page, or any section, aside or form. */
  275 | async function overflow(page: Page): Promise<string[]> {
  276 |   return page.evaluate(() => {
  277 |     const w = document.documentElement.clientWidth;
  278 |     const out: string[] = [];
  279 |     if (document.documentElement.scrollWidth > w) out.push(`page ${document.documentElement.scrollWidth} > ${w}`);
  280 |     for (const el of Array.from(document.querySelectorAll('section, aside, form'))) {
  281 |       const r = el.getBoundingClientRect();
  282 |       if (r.width > 0 && (r.right > w + 1 || r.left < -1)) out.push(`${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? ''} ${Math.round(r.left)}..${Math.round(r.right)}`);
  283 |     }
  284 |     return out;
  285 |   });
  286 | }
  287 | 
```