# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: sprint-23-main-path.spec.ts >> The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent
- Location: e2e/sprint-23-main-path.spec.ts:32:1

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('section[aria-labelledby="group-needs"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"], section[aria-labelledby="group-ready"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"]')
Expected: 0
Received: 1
Timeout:  15000ms

Call log:
  - Expect "toHaveCount" locator('section[aria-labelledby="group-needs"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"], section[aria-labelledby="group-ready"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"]') with timeout 15000ms
  - waiting for locator('section[aria-labelledby="group-needs"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"], section[aria-labelledby="group-ready"] [id="question-797083d2-53bb-460e-ab65-fab98d2aba81"]')
    34 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e3]:
    - banner [ref=f1e4]:
      - generic [ref=f1e5]:
        - generic [ref=f1e6]: RFI Respond
        - navigation [ref=f1e11]:
          - button "Home" [ref=f1e12] [cursor=pointer]
          - button "Responses" [ref=f1e17] [cursor=pointer]
          - button "Knowledge" [ref=f1e22] [cursor=pointer]
          - button "Assignments" [ref=f1e28] [cursor=pointer]
          - button "Team" [ref=f1e33] [cursor=pointer]
          - button "Governance" [ref=f1e40] [cursor=pointer]
        - generic:
          - button "Back to responses" [ref=f1e46] [cursor=pointer]
          - generic "Main path (S23-2) 1794065845340"
        - generic [ref=f1e49]:
          - button "Help" [ref=f1e51] [cursor=pointer]
          - generic [ref=f1e56]:
            - generic [ref=f1e57]: E
            - generic [ref=f1e58]:
              - paragraph [ref=f1e59]: Ellis Admin (test)
              - paragraph [ref=f1e60]: Admin
            - button "Sign out" [ref=f1e61] [cursor=pointer]
    - main [ref=f1e65]:
      - generic [ref=f1e66]:
        - generic "Response" [ref=f1e67]:
          - generic [ref=f1e68]:
            - heading "Main path (S23-2) 1794065845340" [level=1] [ref=f1e69]
            - generic [ref=f1e70]: In progress
          - generic [ref=f1e71]:
            - generic [ref=f1e72]: Ellis Admin (test)
            - generic [ref=f1e76]: No due date
          - generic [ref=f1e81]:
            - generic [ref=f1e82]:
              - generic [ref=f1e83]: 7 of 12 decided
              - generic [ref=f1e84]: across 2 files
            - progressbar "Questions decided" [ref=f1e85]
          - generic [ref=f1e87]:
            - generic [ref=f1e88]: Files
            - list "Files" [ref=f1e89]:
              - listitem [ref=f1e90]:
                - button "All files" [pressed] [ref=f1e91] [cursor=pointer]
              - listitem [ref=f1e92]:
                - button "main-path-part-2.csv" [ref=f1e93] [cursor=pointer]
              - listitem [ref=f1e98]:
                - button "main-path-part-1.csv" [ref=f1e99] [cursor=pointer]
            - button "Add a file" [ref=f1e104] [cursor=pointer]
          - navigation "Stages" [ref=f1e108]:
            - button "Questions 5 need a person · 0 ready to approve" [ref=f1e109] [cursor=pointer]:
              - generic [ref=f1e110]: Questions
              - generic [ref=f1e111]: 5 need a person · 0 ready to approve
            - button "With experts 1 asked" [ref=f1e112] [cursor=pointer]:
              - generic [ref=f1e113]: With experts
              - generic [ref=f1e114]: 1 asked
            - button "Send When every question is decided" [ref=f1e115] [cursor=pointer]:
              - generic [ref=f1e116]: Send
              - generic [ref=f1e117]: When every question is decided
        - status [ref=f1e118]: 6 approved; 4 held back for individual review (pricing, legal, unchecked, translated or Japanese, matched before every entry was indexed, or citing an entry that is unreviewed or overdue for review); 1 held because the checker said the entries answer them only in part (approve them one at a time).
        - alert [ref=f1e122]: "Your change was not saved: TypeError: Failed to fetch"
        - region [ref=f1e125]:
          - generic [ref=f1e126]:
            - heading "Questions" [level=2] [ref=f1e127]
            - paragraph [ref=f1e128]: "12 in this response, across 2 files: 5 to do, 7 approved."
            - textbox "Search questions" [ref=f1e130]:
              - /placeholder: Search questions…
          - generic [ref=f1e131]:
            - region [ref=f1e132]:
              - generic [ref=f1e133]:
                - heading "Needs a person (5)" [level=3] [ref=f1e134]
                - paragraph [ref=f1e135]: Held from bulk approval. Each says why; open it to answer, approve or assign it.
              - generic [ref=f1e137]:
                - generic [ref=f1e138] [cursor=pointer]:
                  - generic [ref=f1e141]: "03"
                  - generic [ref=f1e142]:
                    - paragraph [ref=f1e143]: What is the annual licence fee for 400 store managers?
                    - generic "The file this question came from" [ref=f1e144]: From main-path-part-2.csv
                    - generic [ref=f1e149]:
                      - 'generic "Rules matched: fee. Classifier: The question asks for the annual licence fee, which is a price or cost request." [ref=f1e150]': "Pricing: a person answers"
                      - generic [ref=f1e151]: "Low: 0%"
                  - generic [ref=f1e152]: 0%
                - generic [ref=f1e157]:
                  - generic [ref=f1e158]:
                    - generic [ref=f1e159]:
                      - generic [ref=f1e160]:
                        - generic [ref=f1e161]: Confidence
                        - generic [ref=f1e162]: The measured chance that the knowledge base answers this question with the top entry, from the matching and a check of whether the entry actually answers it, calibrated on 2026-10-22.3 (all 363 questions; checked by 5-fold cross-validation) (docs/evals). The set is small, so the top is shown as 99%+, never as certainty. 0 of 64 evaluation questions scored like this had the right entry (95% interval 0 to 6%).
                      - text: 0%
                    - generic [ref=f1e166]:
                      - generic [ref=f1e167]:
                        - generic [ref=f1e168]: Similarity
                        - generic [ref=f1e169]: Cosine similarity between the question and the best-matching entry (or the keyword score when matching was keyword-only). Not a probability.
                      - text: 20%
                  - generic [ref=f1e174]:
                    - generic [ref=f1e175]:
                      - generic [ref=f1e176]: Checker
                      - generic [ref=f1e177]: Whether the matched entries actually answer this question, as judged by the model shown in the details. Its verdict feeds the confidence above. Not available means the check failed, so the question is not calibrated and is never bulk-approved.
                    - paragraph [ref=f1e180]:
                      - text: "No"
                      - generic [ref=f1e181]: ". KB-0024: The entries cover identity provisioning, physical security, and access control in general terms; none states a licence fee or pricing for 400 store managers, so the specific fact asked for is absent."
                  - generic [ref=f1e182]:
                    - paragraph [ref=f1e183]:
                      - text: Knowledge-base sources
                      - generic [ref=f1e187]: Knowledge-base entries this draft was assembled from. Click to read the full entry.
                    - generic [ref=f1e190]:
                      - button "KB-0024 How does your organization manage user identities and access provisioning? (20%)" [ref=f1e191] [cursor=pointer]:
                        - generic [ref=f1e192]: KB-0024
                        - generic [ref=f1e193]: How does your organization manage user identities and access provisioning?
                        - generic "Similarity to the question; not a probability" [ref=f1e194]: (20%)
                      - button "KB-0014 What physical security controls protect your facilities? (18%)" [ref=f1e199] [cursor=pointer]:
                        - generic [ref=f1e200]: KB-0014
                        - generic [ref=f1e201]: What physical security controls protect your facilities?
                        - generic "Similarity to the question; not a probability" [ref=f1e202]: (18%)
                      - button "KB-0003 Describe your access control framework. (18%)" [ref=f1e207] [cursor=pointer]:
                        - generic [ref=f1e208]: KB-0003
                        - generic [ref=f1e209]: Describe your access control framework.
                        - generic "Similarity to the question; not a probability" [ref=f1e210]: (18%)
                  - generic [ref=f1e215]:
                    - paragraph [ref=f1e216]:
                      - text: Expert Assignment
                      - generic [ref=f1e220]: Route this question to team members for specialist review. Suggestions come from who wrote the cited entries, who approved similar answers before, and stated expertise; the reasons are shown.
                    - button "Assign for review 4 match" [ref=f1e224] [cursor=pointer]:
                      - text: Assign for review
                      - generic [ref=f1e228]: 4 match
                  - generic [ref=f1e231]:
                    - generic [ref=f1e232]:
                      - paragraph [ref=f1e233]:
                        - text: Proposed Response
                        - generic [ref=f1e234]: "No draft: pricing questions are always answered by a person. Write the answer, or leave it unanswered."
                      - button "Edit" [ref=f1e237] [cursor=pointer]
                    - generic [ref=f1e241]: "Pricing question: a person answers this. No draft is written, and pricing answers are never added to the knowledge base automatically."
                  - paragraph [ref=f1e243]:
                    - strong [ref=f1e244]: "Held back from bulk approval:"
                    - text: "Rules matched: fee. Classifier: The question asks for the annual licence fee, which is a price or cost request."
                  - paragraph [ref=f1e245]: Matched with voyage-4, checked by claude-haiku-5-5.
                  - generic [ref=f1e246]:
                    - button "Write an answer" [ref=f1e247] [cursor=pointer]
                    - button "Leave unanswered" [ref=f1e251] [cursor=pointer]
                  - paragraph [ref=f1e257]: "Very low confidence: the knowledge base probably does not answer this. Review carefully before approving."
              - generic [ref=f1e260] [cursor=pointer]:
                - generic [ref=f1e263]: "04"
                - generic [ref=f1e264]:
                  - paragraph [ref=f1e265]: Will you accept unlimited liability for a breach of our customer data?
                  - generic "The file this question came from" [ref=f1e266]: From main-path-part-2.csv
                  - generic [ref=f1e271]:
                    - 'generic "Rules matched: liability. Classifier: The question asks whether the company will accept unlimited liability for a data breach, which is a request to agree to a contractual liability term." [ref=f1e272]': "Legal: review individually"
                    - generic [ref=f1e273]: "Low: 0%"
                - generic [ref=f1e274]: 0%
              - generic [ref=f1e281] [cursor=pointer]:
                - generic [ref=f1e284]: "02"
                - generic [ref=f1e285]:
                  - paragraph [ref=f1e286]: What encryption protects data travelling across networks?
                  - generic "The file this question came from" [ref=f1e287]: From main-path-part-1.csv
                  - generic [ref=f1e292]:
                    - generic [ref=f1e293]: The checker found it partly answered
                    - generic [ref=f1e294]: "High: 85%"
                - generic [ref=f1e295]: 85%
              - generic [ref=f1e303] [cursor=pointer]:
                - generic [ref=f1e306]: "01"
                - generic [ref=f1e307]:
                  - paragraph [ref=f1e308]: How is customer data encrypted when it is stored?
                  - generic "The file this question came from" [ref=f1e309]: From main-path-part-1.csv
                  - generic [ref=f1e314]:
                    - 'generic "English question, answered from Japanese entries: the draft is translated, so it is reviewed individually until the Japanese evaluation items have been checked by a native reader. Also: Cites KB-0101, not reviewed by an admin yet, so it is reviewed individually." [ref=f1e315]': Translated draft
                    - generic [ref=f1e316]: "High: 95%"
                - generic [ref=f1e317]: 95%
              - generic [ref=f1e325] [cursor=pointer]:
                - generic [ref=f1e328]: "04"
                - generic [ref=f1e329]:
                  - paragraph [ref=f1e330]: How often is your platform penetration tested by an independent party?
                  - generic "The file this question came from" [ref=f1e331]: From main-path-part-1.csv
                  - generic [ref=f1e336]:
                    - 'generic "English question, answered from Japanese entries: the draft is translated, so it is reviewed individually until the Japanese evaluation items have been checked by a native reader. Also: Cites KB-0107, not reviewed by an admin yet, so it is reviewed individually." [ref=f1e337]': Translated draft
                    - generic [ref=f1e338]: "High: 99%+"
                - generic [ref=f1e339]: 99%+
            - region [ref=f1e345]:
              - generic [ref=f1e346]:
                - heading [level=3] [ref=f1e347]:
                  - button "Approved (7)" [expanded] [ref=f1e348] [cursor=pointer]
                - paragraph [ref=f1e351]: "Decided: each with who approved it and when."
              - generic [ref=f1e354] [cursor=pointer]:
                - generic [ref=f1e357]: "06"
                - generic [ref=f1e358]:
                  - paragraph [ref=f1e359]: Do you hold the Coral Bay Retail Supplier Charter accreditation?
                  - generic "The file this question came from" [ref=f1e360]: From main-path-part-2.csv
                  - generic [ref=f1e365]:
                    - generic [ref=f1e366]: "Low: 0%"
                    - generic [ref=f1e367]:
                      - text: Approved (written by a person)
                      - generic [ref=f1e371]: by Morgan Member (test), Nov 7
                    - generic [ref=f1e372]: Assigned
                - generic [ref=f1e377]: 0%
              - generic [ref=f1e384] [cursor=pointer]:
                - generic [ref=f1e387]: "01"
                - generic [ref=f1e388]:
                  - paragraph [ref=f1e389]: Which SOC 2 reports can you share with us?
                  - generic "The file this question came from" [ref=f1e390]: From main-path-part-2.csv
                  - generic [ref=f1e395]:
                    - generic [ref=f1e396]: "High: 91%"
                    - generic [ref=f1e397]:
                      - text: Approved
                      - generic [ref=f1e401]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e402]: 91%
              - generic [ref=f1e410] [cursor=pointer]:
                - generic [ref=f1e413]: "03"
                - generic [ref=f1e414]:
                  - paragraph [ref=f1e415]: Is multi-factor authentication required for staff and administrators?
                  - generic "The file this question came from" [ref=f1e416]: From main-path-part-1.csv
                  - generic [ref=f1e421]:
                    - generic [ref=f1e422]: "High: 91%"
                    - generic [ref=f1e423]:
                      - text: Approved
                      - generic [ref=f1e427]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e428]: 91%
              - generic [ref=f1e436] [cursor=pointer]:
                - generic [ref=f1e439]: "05"
                - generic [ref=f1e440]:
                  - paragraph [ref=f1e441]: How do you respond to and report a security incident?
                  - generic "The file this question came from" [ref=f1e442]: From main-path-part-1.csv
                  - generic [ref=f1e447]:
                    - generic [ref=f1e448]: "High: 91%"
                    - generic [ref=f1e449]:
                      - text: Approved
                      - generic [ref=f1e453]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e454]: 91%
              - generic [ref=f1e462] [cursor=pointer]:
                - generic [ref=f1e465]: "02"
                - generic [ref=f1e466]:
                  - paragraph [ref=f1e467]: How do you manage the security of your own suppliers?
                  - generic "The file this question came from" [ref=f1e468]: From main-path-part-2.csv
                  - generic [ref=f1e473]:
                    - generic [ref=f1e474]: "High: 95%"
                    - generic [ref=f1e475]:
                      - text: Approved
                      - generic [ref=f1e479]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e480]: 95%
              - generic [ref=f1e488] [cursor=pointer]:
                - generic [ref=f1e491]: "06"
                - generic [ref=f1e492]:
                  - paragraph [ref=f1e493]: What backup and recovery arrangements protect our data?
                  - generic "The file this question came from" [ref=f1e494]: From main-path-part-1.csv
                  - generic [ref=f1e499]:
                    - generic [ref=f1e500]: "High: 95%"
                    - generic [ref=f1e501]:
                      - text: Approved
                      - generic [ref=f1e505]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e506]: 95%
              - generic [ref=f1e514] [cursor=pointer]:
                - generic [ref=f1e517]: "05"
                - generic [ref=f1e518]:
                  - paragraph [ref=f1e519]: Do your staff receive regular security awareness training?
                  - generic "The file this question came from" [ref=f1e520]: From main-path-part-2.csv
                  - generic [ref=f1e525]:
                    - generic [ref=f1e526]: "High: 99%+"
                    - generic [ref=f1e527]:
                      - text: Approved
                      - generic [ref=f1e531]: by Ellis Admin (test), Nov 7, bulk, all eligible
                - generic [ref=f1e532]: 99%+
        - region [ref=f1e538]:
          - generic [ref=f1e539]:
            - heading "With experts" [level=2] [ref=f1e540]
            - paragraph [ref=f1e541]: 1 question asked of colleagues.
          - list "With experts" [ref=f1e542]:
            - listitem [ref=f1e543]:
              - button "Do you hold the Coral Bay Retail Supplier Charter accreditation? Morgan Member (test) Approved Open" [ref=f1e544] [cursor=pointer]:
                - generic [ref=f1e545]:
                  - paragraph [ref=f1e546]: Do you hold the Coral Bay Retail Supplier Charter accreditation?
                  - paragraph [ref=f1e547]:
                    - generic [ref=f1e548]: Morgan Member (test)
                    - generic [ref=f1e549]: Approved
                - generic [ref=f1e550]: Open
        - region [ref=f1e553]:
          - heading "Send" [level=2] [ref=f1e554]
          - paragraph [ref=f1e555]: "5 questions are still to do: approve each or leave them unanswered before downloading the answers or marking the response as sent."
  - generic [aria-hidden]: And the rest one at a time
```

# Test source

```ts
  15  |  * downloads on its own. The same twelve questions are drafted, so the real-AI cost is unchanged.
  16  |  */
  17  | import { readFileSync } from 'node:fs';
  18  | import ExcelJS from 'exceljs';
  19  | import { test, expect, PEOPLE, TARGET, signIn, caption, checks, nav, openResponse, expand, unfold } from './support';
  20  | 
  21  | const { admin, member } = PEOPLE;
  22  | /** The export's wording for a question left unanswered (NOT_ANSWERED in src/exportUtils.ts). */
  23  | const NOT_ANSWERED = 'Not answered';
  24  | const CHARTER = 'Do you hold the Coral Bay Retail Supplier Charter accreditation?';
  25  | /** The sample questionnaire in two halves, as a customer might send it (S24-1). */
  26  | const SAMPLE = readFileSync('sample-data/try-it-questionnaire.csv', 'utf8').trim().split(/\r?\n/);
  27  | const HALVES = [
  28  |   { name: 'main-path-part-1.csv', rows: SAMPLE.slice(1, 7) },
  29  |   { name: 'main-path-part-2.csv', rows: SAMPLE.slice(7) },
  30  | ].map((h) => ({ ...h, buffer: Buffer.from([SAMPLE[0], ...h.rows].join('\n') + '\n') }));
  31  | 
  32  | test('The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent', async ({ browser }) => {
  33  |   // Every step, in order, runs only on staging (bulk approval and learning need checked drafts).
  34  |   checks(...(TARGET === 'staging' ? ['S23-2 1', 'S23-2 2', 'S23-2 3', 'S24-1 3'] : ['S23-2 2']), 'S24-1 4', 'S24-1 7', 'S24-2 1');
  35  |   if (TARGET === 'staging') test.info().annotations.push({ type: 'real-ai', description: 'Drafts a whole questionnaire with the real models' });
  36  |   test.setTimeout(480_000);
  37  |   const name = `Main path (S23-2) ${Date.now()}`;
  38  |   const answer = `No; we would apply for it within 90 days of contract (synthetic answer, ${Date.now()}).`;
  39  | 
  40  |   // 1. Add a response and upload its questionnaire, which comes in two files.
  41  |   const owner = await signIn(browser, admin);
  42  |   await caption(owner, `${admin.name} adds a response`);
  43  |   await nav(owner, 'Responses');
  44  |   await owner.getByRole('button', { name: 'New response' }).click();
  45  |   await owner.getByLabel(/^Name/).fill(name);
  46  |   await owner.getByRole('button', { name: /^Create/ }).click();
  47  |   await caption(owner, 'Uploads the customer\'s questionnaire, in two files, and drafts them (the question column is found by its heading)');
  48  |   for (const [i, half] of HALVES.entries()) {
  49  |     if (i > 0) await owner.locator('header[aria-label="Response"]').getByRole('button', { name: 'Add a file' }).click();
  50  |     await owner.locator('input[type=file]').setInputFiles({ name: half.name, mimeType: 'text/csv', buffer: half.buffer });
  51  |     await owner.getByRole('button', { name: 'Match and draft' }).click();
  52  |     await owner.getByRole('heading', { name: 'Questions', level: 2 }).waitFor({ timeout: 240_000 });
  53  |     await expect(owner.getByText(/Matching, checking and drafting/)).toHaveCount(0, { timeout: 240_000 });
  54  |   }
  55  |   // The header's figures are read again once drafting ends: wait for them to count the questions.
  56  |   const header = owner.locator('header[aria-label="Response"]');
  57  |   const totalNow = async () => Number((await header.innerText()).match(/\d+ of (\d+) decided/)?.[1] ?? 0);
  58  |   await expect.poll(totalNow, { timeout: 30_000 }).toBe(HALVES[0].rows.length + HALVES[1].rows.length);
  59  |   const total = await totalNow();
  60  |   // One list: every question of both files, each card naming its file (S24-1 1).
  61  |   await unfold(owner);
  62  |   await expect(owner.locator('[id^="question-"]')).toHaveCount(total);
  63  |   for (const half of HALVES) await expect(owner.locator('[id^="question-"]', { hasText: `From ${half.name}` })).toHaveCount(half.rows.length);
  64  | 
  65  |   // 2. Assign the question the knowledge base cannot answer to a colleague.
  66  |   await caption(owner, `Asks ${member.name} to answer the question the knowledge base cannot`);
  67  |   const charter = await expand(owner, CHARTER);
  68  |   await charter.getByRole('button', { name: /^Assign (for review|another)/ }).click();
  69  |   await charter.locator('div.flex.items-start', { has: owner.getByText(member.name, { exact: true }) })
  70  |     .getByRole('button', { name: 'Assign', exact: true }).click();
  71  |   await expect(charter.getByText('Assigned', { exact: true })).toBeVisible();
  72  | 
  73  |   // 3. The colleague answers it and approves their answer, as someone asked may.
  74  |   const colleague = await signIn(browser, member);
  75  |   await caption(colleague, `${member.name} answers it from Assignments`);
  76  |   await nav(colleague, 'Assignments');
  77  |   await colleague.getByRole('region', { name: 'Questions' }).getByRole('button', { name: new RegExp(CHARTER.replace(/[?]/g, '\\?')) }).click();
  78  |   const panel = colleague.getByRole('complementary', { name: 'The question' });
  79  |   await panel.getByLabel('Your answer').fill(answer);
  80  |   await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  81  |   await expect(panel.getByText(/Approved/).first()).toBeVisible();
  82  | 
  83  |   // 4. The owner decides the rest: approves those with a draft, leaves the others unanswered.
  84  |   await caption(owner, `${admin.name} decides the rest: approves the drafts, leaves the others unanswered`);
  85  |   await owner.reload();
  86  |   await openResponse(owner, name);
  87  |   if (TARGET === 'staging') {
  88  |     await caption(owner, 'Approves in bulk the drafts nothing holds, across both files');
  89  |     const ready = owner.locator('section[aria-labelledby="group-ready"] [id^="question-"]');
  90  |     expect(await ready.count()).toBeGreaterThan(0);
  91  |     // Which questions the page calls ready, and which need a person, before the one bulk approval (S24-1 3).
  92  |     const ids = async (group: string) => owner.locator(`section[aria-labelledby="group-${group}"] [id^="question-"]`).evaluateAll((els) => els.map((e) => e.id));
  93  |     const readyIds = await ids('ready');
  94  |     const needsIds = await ids('needs');
  95  |     const readyFiles = new Set(await ready.evaluateAll((els) => els.map((e) => e.textContent?.match(/From (main-path-part-\d\.csv)/)?.[1]).filter(Boolean)));
  96  |     test.info().annotations.push({ type: 'note', description: `Ready to approve before bulk approval: ${readyIds.length}, from ${[...readyFiles].join(' and ')}` });
  97  |     await owner.getByRole('button', { name: 'All eligible' }).click();
  98  |     await expect(owner.locator('section[aria-labelledby="group-ready"]')).toHaveCount(0);
  99  |     // Exactly those: every ready question, from whichever file, is approved; every held one still needs a person.
  100 |     await unfold(owner);
  101 |     expect((await ids('approved')).filter((id) => readyIds.includes(id)).sort()).toEqual([...readyIds].sort());
  102 |     expect((await ids('needs')).sort()).toEqual([...needsIds].sort());
  103 |   }
  104 |   await caption(owner, 'And the rest one at a time');
  105 |   for (let guard = 0; guard < total + 2; guard++) {
  106 |     const next = owner.locator('section[aria-labelledby="group-needs"] [id^="question-"], section[aria-labelledby="group-ready"] [id^="question-"]').first();
  107 |     if (!(await next.count())) break;
  108 |     const id = await next.getAttribute('id');
  109 |     await next.locator('p').first().click();
  110 |     const approve = next.getByRole('button', { name: 'Approve', exact: true });
  111 |     const save = owner.waitForResponse((r) => r.url().includes('/rest/v1/') && r.request().method() !== 'GET');
  112 |     if (await approve.isVisible() && await approve.isEnabled()) await approve.click();
  113 |     else await next.getByRole('button', { name: 'Leave unanswered' }).click();
  114 |     await save;
> 115 |     await expect(owner.locator(`section[aria-labelledby="group-needs"] [id="${id}"], section[aria-labelledby="group-ready"] [id="${id}"]`)).toHaveCount(0);
      |                                                                                                                                             ^ Error: expect(locator).toHaveCount(expected) failed
  116 |   }
  117 |   await expect(owner.locator('header[aria-label="Response"]')).toContainText(`${total} of ${total} decided`);
  118 | 
  119 |   // 5. Download each file's answers: together they hold every approved answer, the colleague's among them.
  120 |   await caption(owner, 'Downloads the answers, one Excel file for each of the customer\'s files');
  121 |   const send = owner.getByRole('region', { name: 'Send the response' });
  122 |   const answers: string[] = [];
  123 |   for (const half of HALVES) {
  124 |     const download = owner.waitForEvent('download');
  125 |     await send.getByRole('group', { name: `Download ${half.name}` }).getByRole('button', { name: /^Excel/ }).click();
  126 |     const got = await download;
  127 |     // Each download is named for its file and holds that file's questions only (S24-1 7).
  128 |     expect(got.suggestedFilename()).toBe(half.name.replace(/\.csv$/, '.xlsx'));
  129 |     const book = new ExcelJS.Workbook();
  130 |     await book.xlsx.readFile(await got.path());
  131 |     // The answers sheet: a row per decided question, the answer column holding each approved answer
  132 |     // and the not-answered wording for the rest (exportRows in src/exportUtils.ts).
  133 |     const sheet = book.getWorksheet('RFI Responses')!;
  134 |     const head = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? ''));
  135 |     const col = head.indexOf('Answer');
  136 |     const qcol = head.indexOf('Question');
  137 |     const these: string[] = [];
  138 |     const asked: string[] = [];
  139 |     sheet.eachRow((row, n) => { if (n > 1) { these.push(String(row.getCell(col).text ?? '')); asked.push(String(row.getCell(qcol).text ?? '')); } });
  140 |     expect(these).toHaveLength(half.rows.length);
  141 |     // Its own questions only (QA review, M2), by their text.
  142 |     expect(asked.sort()).toEqual(half.rows.map((r) => r.slice(r.indexOf(',') + 1)).sort());
  143 |     answers.push(...these);
  144 |   }
  145 |   const count = async (title: string) => Number((await owner.locator('h3', { hasText: new RegExp(`^\\s*${title} \\(\\d+\\)$`) }).innerText().catch(() => '(0)')).match(/\((\d+)\)/)![1]);
  146 |   const approved = await count('Approved');
  147 |   const unanswered = await count('Not answered');
  148 |   expect(approved).toBeGreaterThan(0);
  149 |   expect(answers).toHaveLength(total);
  150 |   expect(answers.filter((a) => a === NOT_ANSWERED)).toHaveLength(unanswered);
  151 |   expect(answers.filter((a) => a && a !== NOT_ANSWERED)).toHaveLength(approved);
  152 |   expect(answers).toContain(answer);
  153 | 
  154 |   // 6. Mark as sent, once for the whole response, and see what the knowledge base did with the answers.
  155 |   await caption(owner, 'Marks the whole response as sent, both files at once');
  156 |   await send.getByRole('button', { name: 'Mark as sent' }).click();
  157 |   await owner.getByRole('group', { name: 'Confirm marking as sent' }).getByRole('button', { name: 'Confirm: mark as sent' }).click();
  158 |   await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  159 |   if (TARGET !== 'staging') {
  160 |     // Locally, with no checker, every answer is held as not fully checked and is not learned; the
  161 |     // page says so as soon as it is sent (the report is not kept once the response is closed).
  162 |     await caption(owner, 'Locally, with no checker, nothing was learned, and the page says so');
  163 |     await expect(send).toContainText(/not learned \(not fully checked\)/);
  164 |   }
  165 |   const report = (await send.innerText()).match(/Knowledge base: [^\n]+/)![0];
  166 |   // Opened again later, the response still says what was learned, in the same words (S24-2 1).
  167 |   await caption(owner, 'Opened again later, the response still says what the knowledge base did with it');
  168 |   await nav(owner, 'Responses');
  169 |   await openResponse(owner, name);
  170 |   await expect(send.getByRole('heading', { name: /^Sent on/ })).toBeVisible();
  171 |   await expect(send).toContainText(report);
  172 |   // Sent: no file can be added now (S24-1 8).
  173 |   await expect(owner.locator('header[aria-label="Response"]').getByRole('button', { name: 'Add a file' })).toHaveCount(0);
  174 |   await expect(owner.locator('header[aria-label="Response"]')).toContainText('Marked as sent, so no file can be added: a later questionnaire is a new response.');
  175 |   await nav(owner, 'Knowledge');
  176 |   const learned = owner.getByRole('region', { name: 'Learned recently' });
  177 |   // The list has loaded once it shows an answer learned earlier in the run (Sprint 21, Larkspur).
  178 |   await expect(learned.getByRole('button').first()).toBeVisible();
  179 |   if (TARGET === 'staging') {
  180 |     await caption(owner, `The knowledge base has ${member.name}'s answer, learned from this response`);
  181 |     const entry = learned.getByRole('button').filter({ hasText: CHARTER }).first();
  182 |     await expect(entry).toBeVisible();
  183 |     await expect(entry).toContainText(`from ${name}`);
  184 |   } else {
  185 |     await expect(learned.getByText(CHARTER)).toHaveCount(0);
  186 |   }
  187 | });
  188 | 
```