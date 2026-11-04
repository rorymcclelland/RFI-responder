# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sprint-21.spec.ts >> Gaps: what the knowledge base could not answer, where each stands, and one step to act
- Location: e2e/sprint-21.spec.ts:207:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'Gaps' }).getByRole('article', { name: 'フィッシング攻撃をどのように検知し、対応していますか？' })
Expected substring: "Answered, learned when sent"
Received string:    "フィッシング攻撃をどのように検知し、対応していますか？Not answered yetAsked in 1 response · to do in Bluefin Freight (fictional): security questionnaireStill to do in its response: open it there to write the answer or assign it.Open it in the response "
Timeout: 15000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: 'Gaps' }).getByRole('article', { name: 'フィッシング攻撃をどのように検知し、対応していますか？' }) with timeout 15000ms
  - waiting for getByRole('region', { name: 'Gaps' }).getByRole('article', { name: 'フィッシング攻撃をどのように検知し、対応していますか？' })
    34 × locator resolved to <article aria-label="フィッシング攻撃をどのように検知し、対応していますか？" class="bg-white rounded-2xl border border-ink-100 px-4 py-3 space-y-2">…</article>
       - unexpected value "フィッシング攻撃をどのように検知し、対応していますか？Not answered yetAsked in 1 response · to do in Bluefin Freight (fictional): security questionnaireStill to do in its response: open it there to write the answer or assign it.Open it in the response "

```

```yaml
- article "フィッシング攻撃をどのように検知し、対応していますか？":
  - paragraph: フィッシング攻撃をどのように検知し、対応していますか？
  - text: Not answered yet
  - paragraph: "Asked in 1 response · to do in Bluefin Freight (fictional): security questionnaire"
  - paragraph: "Still to do in its response: open it there to write the answer or assign it."
  - button "Open it in the response":
    - text: Open it in the response
    - img
```

# Test source

```ts
  132 |   ]) {
  133 |     c = await expand(page, question);
  134 |     await c.getByRole('button', { name: 'Revise Answer' }).click();
  135 |     await c.locator('textarea').fill(answer);
  136 |     await c.getByRole('button', { name: 'Save & approve' }).click();
  137 |     await expect(c.getByText('Approved (edited)')).toBeVisible();
  138 |   }
  139 |   await caption(page, 'The pricing question, left unanswered before, now gets an answer written by a person');
  140 |   c = await expand(page, FEES);
  141 |   await c.getByRole('button', { name: 'Restore' }).click();
  142 |   await c.getByRole('button', { name: 'Write an answer' }).click();
  143 |   await c.locator('textarea').fill('Implementation is quoted per project; a typical project is fixed price.');
  144 |   // The page is reloaded below: wait for this save to answer first.
  145 |   const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/rpc/approve_answer') && r.ok());
  146 |   await c.getByRole('button', { name: 'Save & approve' }).click();
  147 |   await saved;
  148 |   await expect(c.getByText('Approved (written by a person)')).toBeVisible();
  149 | 
  150 |   await caption(page, 'A change after sending: the stage reads Changed since sent');
  151 |   const panel = sendPanel(page);
  152 |   await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();
  153 | 
  154 |   await caption(page, 'Downloading does not mark it as sent');
  155 |   const download = page.waitForEvent('download');
  156 |   await panel.getByRole('button', { name: /^Excel/ }).click();
  157 |   expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);
  158 |   await expect(panel.getByText('Downloading does not mark the response as sent.')).toBeVisible();
  159 |   // As the database has it, after a reload (QA review): still not sent, the assignment still open.
  160 |   await page.reload();
  161 |   await openResponse(page, LARKSPUR);
  162 |   await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();
  163 |   await showQuestions(page);
  164 |   await expect((await expand(page, TEST_DATA)).getByText('Asked', { exact: true })).toBeVisible();
  165 | 
  166 |   await caption(page, 'Mark as sent says first what it will do; Cancel changes nothing');
  167 |   await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  168 |   const confirm = panel.getByRole('group', { name: 'Confirm marking as sent' });
  169 |   await expect(confirm).toContainText('record that it was sent, with your name and the time');
  170 |   await expect(confirm).toContainText('the approved answers changed since it was last marked as sent: 2 answers edited or written by a person');
  171 |   await expect(confirm).toContainText('0 drafts approved as written');
  172 |   await expect(confirm).toContainText('1 pricing answer, never learned');
  173 |   await expect(confirm).toContainText('close the 1 open assignment on it');
  174 |   await confirm.getByRole('button', { name: 'Cancel' }).click();
  175 |   await expect(confirm).toHaveCount(0);
  176 |   await expect(panel.getByRole('heading', { name: 'Changed since sent' })).toBeVisible();
  177 | 
  178 |   await caption(page, 'Confirmed: Sent again, the assignment closed, and what the knowledge base learned');
  179 |   await panel.getByRole('button', { name: 'Mark as sent', exact: true }).click();
  180 |   await confirm.getByRole('button', { name: 'Confirm: mark as sent' }).click();
  181 |   await expect(panel.getByRole('heading', { name: /^Sent on / })).toBeVisible();
  182 |   // Something was learned from the two edited answers, and the pricing answer was not (QA review).
  183 |   await expect(panel.getByText(/^Knowledge base: (?=.*(added as new entries|replaced an older entry|proposed as replacements)).*1 not learned \(pricing\)/)).toBeVisible();
  184 |   await expect(panel.getByRole('button', { name: 'Mark as sent', exact: true })).toHaveCount(0);
  185 |   await showQuestions(page);
  186 |   await expand(page, TEST_DATA);
  187 |   await expect(card(page, TEST_DATA).getByText('Closed', { exact: true })).toBeVisible();
  188 | 
  189 |   await caption(page, 'The audit log records who marked it as sent, and when');
  190 |   await nav(page, 'Governance');
  191 |   await page.getByRole('tab', { name: 'Audit log' }).click();
  192 |   const entry = page.getByRole('listitem').filter({ hasText: /^Marked as sent again after changes/ }).first();
  193 |   await expect(entry).toBeVisible();
  194 |   await expect(entry).toContainText(admin.name);
  195 |   await expect(entry).toContainText('response.exported');
  196 |   // Today, as the page writes dates (QA review: not an older row).
  197 |   const today = await page.evaluate(() => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
  198 |   await expect(entry).toContainText(today);
  199 | });
  200 | 
  201 | // ── S21-2: Gaps ──────────────────────────────────────────────────────────────────────────────────
  202 | 
  203 | const REGIONS = 'In which regions is customer data stored?'; // Larkspur: no draft; a person's answer, learned when sent
  204 | const PHISHING = 'フィッシング攻撃をどのように検知し、対応していますか？'; // Bluefin: no draft; approved by the member in sprint-19.spec.ts
  205 | const DETECT = 'What is your mean time to detect a security incident?'; // Bluefin: no draft; left unanswered here
  206 | 
  207 | test('Gaps: what the knowledge base could not answer, where each stands, and one step to act', async ({ browser }) => {
  208 |   checks('S21-2 4', 'S21-2 5');
  209 |   // The admin, who can act on what they open (every member sees the same gaps: database case 6).
  210 |   const page = await signIn(browser, admin);
  211 |   await caption(page, 'First, one question the knowledge base could not answer is left unanswered');
  212 |   await openResponse(page, BLUEFIN);
  213 |   // Waits for the save, not only the card, before Gaps is read (the staging run of 1aed1dc).
  214 |   const saved = page.waitForResponse((r) => r.url().includes('/rest/v1/rfi_questions') && r.request().method() === 'PATCH' && r.ok());
  215 |   await (await expand(page, DETECT)).getByRole('button', { name: 'Leave unanswered' }).click();
  216 |   await expect(card(page, DETECT).getByText('Not answered', { exact: true })).toBeVisible();
  217 |   await saved;
  218 |   await nav(page, 'Knowledge');
  219 |   await caption(page, 'Knowledge counts the gaps not answered yet, beside the other states');
  220 |   const count = page.getByRole('region', { name: 'Health' }).getByRole('button', { name: /gaps? not answered yet/ });
  221 |   await expect(count).toContainText(/^[1-9]\d*/);
  222 |   await count.click();
  223 |   await expect(page.getByRole('heading', { name: 'Gaps', exact: true })).toBeVisible();
  224 |   const list = page.getByRole('region', { name: 'Gaps' });
  225 |   await expect(page.getByRole('checkbox', { name: /^Not answered yet/ })).toBeChecked();
  226 | 
  227 |   await caption(page, 'Every state, with how many responses asked each question');
  228 |   for (const label of ['Answered, learned when sent', 'Learned', 'Learned as a proposed change', 'Answered, not in the knowledge base', 'Left unanswered']) {
  229 |     await page.getByRole('checkbox', { name: new RegExp(`^${label} \\(`) }).check();
  230 |   }
  231 |   // Each state as the page shows it (QA review: not only the filter labels).
> 232 |   await expect(list.getByRole('article', { name: PHISHING })).toContainText('Answered, learned when sent');
      |                                                               ^ Error: expect(locator).toContainText(expected) failed
  233 |   await expect(list.getByRole('article', { name: DETECT })).toContainText('Left unanswered');
  234 |   const learned = list.getByRole('article', { name: REGIONS });
  235 |   await expect(learned).toContainText('Learned');
  236 |   await expect(learned).toContainText('Asked in 1 response');
  237 |   const ref = learned.getByRole('button', { name: /^KB-\d{4,}$/ });
  238 |   const entryRef = (await ref.textContent())!.trim();
  239 | 
  240 |   await caption(page, 'A learned gap opens the answer it became');
  241 |   await ref.click();
  242 |   await expect(page.getByRole('complementary', { name: 'Selected answer' })).toContainText(entryRef);
  243 |   await expect(page.getByRole('complementary', { name: 'Selected answer' })).toContainText(REGIONS);
  244 | 
  245 |   await caption(page, 'One not answered yet opens in its response, at that question');
  246 |   await nav(page, 'Knowledge');
  247 |   await page.getByRole('button', { name: 'Gaps', exact: true }).click();
  248 |   const open = list.getByRole('article').filter({ hasText: 'Not answered yet' }).first();
  249 |   const question = (await open.getByRole('paragraph').first().textContent())!.trim();
  250 |   await open.getByRole('button', { name: 'Open it in the response' }).click();
  251 |   const c = card(page, question);
  252 |   await expect(c).toBeVisible();
  253 |   // Opened at that question: its card is open, with what can be done next.
  254 |   await expect(c.getByRole('button', { name: /^(Approve|Write an answer|Edit First)$/ }).first()).toBeVisible();
  255 | });
  256 | 
  257 | test('Gaps show a question\'s markup as text', async ({ browser }) => {
  258 |   checks('S21-2 7');
  259 |   const page = await signIn(browser, member);
  260 |   const markup = '<img src=x onerror="document.title=\'pwned\'"> <b>Do you scan uploads?</b>';
  261 |   // The database returns question text as written (database case 7); here one with markup is added
  262 |   // to what it returned, as a hostile upload would put it there, to see how the page shows it.
  263 |   await page.route('**/rest/v1/rpc/knowledge_gaps', async (route) => {
  264 |     // The request guard first (security review): this handler runs before the session's own.
  265 |     if (!requestAllowed(route.request().url())) return route.abort('blockedbyclient');
  266 |     const res = await route.fetch({ maxRedirects: 0 });
  267 |     const body = (await res.json()) as { total: number; gaps: Record<string, unknown>[] };
  268 |     const first = body.gaps[0] ?? { state: 'open', responses: 1, lastAsked: new Date().toISOString(), entryRef: null, responseId: 'x', response: 'x', sessionId: 'x' };
  269 |     await route.fulfill({ response: res, json: { total: body.total + 1, gaps: [{ ...first, question: markup, questionId: 'markup-test', state: 'open' }, ...body.gaps] } });
  270 |   });
  271 |   await nav(page, 'Knowledge');
  272 |   await page.getByRole('button', { name: 'Gaps', exact: true }).click();
  273 |   await caption(page, 'A question containing markup shows as the text it is');
  274 |   await expect(page.getByRole('region', { name: 'Gaps' }).getByText(markup, { exact: true })).toBeVisible();
  275 |   await expect(page.locator('section[aria-label="Gaps"] img, section[aria-label="Gaps"] b')).toHaveCount(0);
  276 |   expect(await page.title()).not.toBe('pwned');
  277 | });
  278 | 
```