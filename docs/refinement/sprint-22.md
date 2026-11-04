# Sprint 22 refinement: the response as a journey, plain settings, and the ask's usage on staging

Refined 3 November 2026, as proposed at the Sprint 21 review: the first slice of U-5 (the spike's response page), U-9 (plain settings and a filterable audit log), and F-69 (returned from Sprint 21). U-8 **Try it** follows in Sprint 23, on the rebuilt response page.

## What refinement found

- **The response page is still one file at a time.** `RFIWorkspace.tsx` opens one file (session) of a response: a line of counts, the bulk bar, the filter tabs **All**, **To do**, **Approved**, **Not answered**, a confidence filter, and the question cards in confidence order. Other files are reached through **Add a file** or **Other files**. There is no header naming the response, its owner, due date or progress: those are on the Responses page's card only.
- **Sending and bulk approval are per file in the database.** `record_export` and `bulk_accept` take a session; a response's stage comes from its files' `exported_at` and `changed_since_export_at`. One question list across files, sent as one, needs new database functions and their role-matrix tests. Every response in the demo data has one file.
- **The one reason a question needs a person already exists in parts.** The card shows a gate label (eight of them, "Pricing: a person answers" and so on), the draft kind (no draft) and the checker's verdict; `bulkEligible` in `questionRows.ts` is the screen's copy of the database's rule for what bulk approval can take. What is missing is one reason per question, chosen in a fixed order, and grouping by it.
- **Notes from colleagues are a banner.** `ReadyForReviewBanner` lists assignments with notes above the questions; assignments without notes show only on their card.
- **Settings are one flat list of ten fields.** Five are everyday (three daily limits, the budget, the warning point) and one is a review interval; four are tuning (three reserves in US dollars and pounds per dollar), followed by the price table. Spend is shown by person and "by model and job" (model names and `judge`, `gate`, `draft`, `embed`, `rerank`).
- **Asking is already recorded under its own name.** `ai_usage.function` holds the Edge Function's name (`ask-knowledge`, `process-questions`, `embed`, `embed-entries`, `extract-questions`), so spend by what it was used for needs no new data (the Sprint 18 review's open note).
- **The audit log filters by kind only,** newest 200. Who acted is kept as `actor_ref` even after a profile is deleted. Targets differ by action: a question (`question.*`), a file (`response.exported`), a response (`response.archived`, `response.deleted`), an entry (`kb.*`), or none (settings, prices, demo reset). Filtering by response means following a question or file to its response.

## Stories

### S22-1 The response as a journey, first slice. L (U-5, with U-10 for this page)

**The job.** An owner opens a response and sees at once where it stands and what needs them, in the order they work: the questions that need a person, each with one reason; the ones ready to approve; what colleagues are doing; and sending. Nobody needs to know what a file, a gate or a session is to get through it.

**Before and after.**
- Today: a file name and counts, the bulk bar, status tabs and a confidence filter over one list; notes from colleagues in a banner; downloads and **Mark as sent** at the end of the list.
- After (Q1 a): a **header** with the response's name, owner, due date (with **Overdue** or **At risk** as on Responses), progress (decided of total, as a bar) and stage, and its files, the open one marked, with **Add a file** for those who may. Below it, three **stages**:
  - **Questions**: the to-do questions grouped as **Needs a person** (each with one reason, in a fixed order) and **Ready to approve** (nothing holds them from bulk approval, Q2; the bulk bar is here), then **Approved** and **Not answered**, folded. Search stays.
  - **With experts**: every question asked of a colleague, with who and where it stands (**Asked**, **Working on it**, **Answered**, **Approved**, **Closed**) and their note; one with an answer opens at its question. It replaces the banner.
  - **Send**: the Sprint 21 send region (downloads, **Mark as sent** and its confirmation), unchanged.
- The question card is unchanged, apart from showing its one reason first.

**What changes.** A `needReason(q)` rule beside `bulkEligible` in `workspace/questionRows.ts` (one reason, in this order: not processed, the gate, no draft, not calibrated, the checker's verdict; corrected while building to match the code and the guide); a header and stage layout in `RFIWorkspace.tsx`, split into `workspace/ResponseHeader.tsx` and `workspace/WithExperts.tsx`; `ReadyForReviewBanner` retired; the glossary (new words: **Needs a person**, **Ready to approve**, **With experts**); the guide's response pages, the introduction's steps and their screenshots. No database change.

**Test cases.**
1. The header shows the response's name, owner, due date, progress and stage, matching its card on Responses, with **Overdue** or **At risk** when the card shows it (browser).
2. Every question is in exactly one group; the groups' counts add up to the total and match the header's progress (unit, over every gate, draft kind and verdict; browser on a demo response).
3. A to-do question is **Ready to approve** if and only if bulk approval could take it (unit: `needReason(q) === null` exactly when `bulkEligible(q)`, over every combination). Every question in **Needs a person** shows exactly one reason, the first in the fixed order (unit; browser for how it shows).
4. Bulk approval takes only **Ready to approve** questions at the chosen line, and the groups update after it (browser).
5. **With experts** lists every assigned question with the colleague and the stage word; an answered one opens at its question in **Questions** (browser). The banner is gone.
6. **Send** works as in Sprint 21: the Sprint 21 browser tests pass on the new layout, unchanged in what they check (browser).
7. A response with two files lists both in the header, the open one marked; choosing the other opens it (browser, locally: the demo data has one file per response, so the test adds a spreadsheet without AI).
8. A member who does not own the response sees the header, the groups and the reasons, and no approval, assignment or send control (browser).
9. At phone width the header, the stages and the groups fit without scrolling sideways (browser, phone).
10. An archived response shows the same page read-only, with the archived line (browser).
11. A question or file name containing markup shows as text (browser).
12. The glossary has the new words and its test passes; the guide describes the page as it is (`docs/guide.test.ts`); the screenshots are retaken (CI, and the screenshot run).

**Out of scope (Q1).** One question list across a response's files, bulk approval and **Mark as sent** for a whole response (both need new database functions): the second slice, Sprint 23 or later. Editing the due date from the header (it stays on Responses).

**Boundaries.** Rule 1: a reason names only what the code checked (the gate, the verdict, calibration); **Ready to approve** promises nothing bulk approval would refuse (case 3). Rule 4 and decision 0003: no rule changes; the database still refuses what the screen does not offer. Synthetic data only.

### S22-2 Plain settings, spend by use, and the audit log by person and response. M (U-9)

**The job.** An admin finds what they change most often first, sees what the money was spent on in plain words, and answers "who decided this, and when?" for one person or one response without reading the whole log.

**Before and after.**
- Today: ten settings in one list, then prices; spend by person and by model and job; the audit log by kind, newest 200.
- After (Q3 a):
  - **Usage and limits** shows the monthly budget, the warning point, the three daily limits and the review interval. **Advanced**, closed until opened, holds the three reserves, pounds per dollar, the price table and the spend by model. **Save limits** saves both, as today.
  - **Spend by use** replaces "by model and job" on the main view: **Processing responses**, **Asking the knowledge base**, **Indexing knowledge-base entries**, **Reading Word documents**, with calls and spend this month. A function the app does not know by name shows under its own name, never dropped.
  - The **audit log** filters by person and by response, as well as by kind, together. It still shows the newest 200 that match, and says so when there are more.

**What changes.** `GovernanceAdmin.tsx` (Advanced, spend by use, two filters); `lib/usage.ts` (spend by function, from `ai_usage.function`); an invoker function `public.audit_log_search(p_group text[], p_actor uuid, p_response uuid)` that follows each row's target to its response (a question or file to its response; a response itself), readable only by admins as the log is today; `lib/auditLog.ts`; the guide's admin page and its screenshot. The function needs the role-matrix tests (decision 0003).

**Test cases.**
1. The everyday settings show first; **Advanced** is closed until opened and holds the reserves, pounds per dollar, the prices and the spend by model; saving from either works and is audited (browser).
2. Spend by use: each function's name maps to its plain name; an unknown one shows as itself; the uses add up to the month's total (unit, database).
3. The person filter shows only rows that person did, including someone whose profile was deleted since, shown as **Former user** (database; browser for the list).
4. The response filter shows the response's own rows (archived), its files' (marked as sent) and its questions' (held, changed after sending), and never a row about another response or one with no response (database).
5. The filters combine with the kind filter; at most 200 rows, newest first, with a line when more match (database, browser).
6. A member and a signed-out caller get nothing from the function; an admin gets the rows (database, every row of the role matrix).
7. A response name or a person's name containing markup shows as text in the filters and the rows (browser).
8. With 50,000 audit rows the filtered read answers in under a second (database, as Sprint 21's case 8).

**Out of scope.** Changing what the log records; exporting the log; a deleted response in the response filter (its deletion row stays under **Archives and deletions**, with its name).

**Boundaries.** Decision 0003: the function runs with the caller's rights and adds no access; only admins read the log, as today. Rule 1: spend stays an estimate, labelled as today.

### S22-3 The ask's usage on staging. S (F-69)

**The job.** Each staging run proves that the real-AI question it asks is recorded against the person who asked, as spend the admin can see.

**What changes.** The Sprint 21 real-AI browser test (`e2e/sprint-21.spec.ts`) reads **Asking the knowledge base** under **Spend by use** (S22-2) before and after its question.

**Test cases.**
1. On staging: after the question, **Asking the knowledge base** shows more calls than before (staging run).
2. Locally, with the providers off: the fallback answer is checked as in Sprint 21 and the count is not compared (no real model is called), and the test says which it checked (CI).
3. The daily cap is not reached in the browser (Q4): it stays with the database tests since Sprint 18, named on the demo page.

**Dependencies.** After S22-2.

## The sprint as a whole

Order: S22-2 (it stands alone, and S22-3 needs its spend by use), S22-3, then S22-1, the largest. About four days. No spike: the one unknown (how the response filter performs over a long log) is case 8 of S22-2, measured first.

**Hand checks for Rory.** None planned: every case runs in CI, on staging or as a named check. U-5 changes the page every response is worked on, so the demo page will include recordings of the whole journey at desktop and phone width.

## Questions for Rory

- **Q1 How much of U-5 this sprint.** (a) The header, the three stages and the groups with one reason each, over the file that is open, with the files listed in the header; one list across files and sending a whole response in a later slice (recommended: no database change, and every demo response, with one file, gets the whole journey now); (b) all of U-5 now, including one list across files and **Mark as sent** for the whole response (new database functions for bulk approval and sending; U-9 and F-69 move to Sprint 23).
- **Q2 What "Ready to approve" means.** (a) Every to-do question that bulk approval could take at some confidence, in confidence order, with the bulk bar choosing the line, as today (recommended: the group never promises more than the database allows); (b) only those at or above the bulk line, with the rest under **Needs a person** ("below the bulk line").
- **Q3 What goes under Advanced.** (a) The three reserves, pounds per dollar, the price table and the spend by model; budget, warning point, daily limits and review interval stay on the main view (recommended: what an admin changes monthly stays in view, what tunes the estimates is one click away); (b) only the price table.
- **Q4 F-69 and the daily cap.** (a) The staging test checks that the ask is recorded (spend by use); the cap stays with the database tests (recommended: reaching it in the browser means lowering a setting on staging during the run and putting it back, which can leak into the tests after it); (b) also lower the cap for the run and check the refusal.

## Rory's answers (3 November 2026)

- **Q1:** (a). The first slice: the header, the three stages and the groups, over the open file; one list across files and sending a whole response in a later slice.
- **Q2:** (a). **Ready to approve** holds every to-do question bulk approval could take, at any confidence.
- **Q3:** (a). The reserves, pounds per dollar, the prices and the spend by model under **Advanced**.
- **Q4:** (a). The staging test checks the ask is recorded; the cap stays with the database tests.

All three stories are Ready, Sprint 22.

## Close (4 November 2026)

All three stories are done. Rory signed off from the demo page and approved the production deploy, which applied both migrations and passed every deploy check after the live demo's sign-in settings matched. The evidence is in the Sprint 22 review in `docs/BACKLOG.md` and on the demo page (`docs/testing/sprint-22-demo.md`).

**What changed from the refinement while building.**
- **S22-1's groups.** Approved and Not answered are folded while anything is still to do, and a group opens for the question open in it, so a card just decided stays in view. The three stages are sections of one page, with the header's stage buttons jumping to each, rather than separate views: the Sprint 21 tests kept checking what they checked, and a phone scrolls one page.
- **S22-1's reason order** is as the code and the guide have it: not processed, the gate, no draft, not calibrated, the checker's verdict.
- **S22-1 case 3** is also checked against the database: bulk approval takes exactly the questions the page calls **Ready to approve**, over 480 combinations, when no cited entry needs re-checking. The page and the guide say that bulk approval checks the cited entries again.
- **S22-1 case 4** needed demo data with something to approve in bulk: Bluefin is now approved in bulk at 95%, leaving two drafts at 91% (QA review). The checker's partly-answered hold (Sprint 8) is shown where a visitor meets it, pressing **High ≥80%**. Staging reloads its demo when the plan's version changes; the live demo keeps the earlier data until Rory reloads it.
- **S22-2** gave the direct embedding function its own name under **Spend by use** (only CI calls it), and each settings part saves only its own fields (security review).
- **S22-2 case 8** is far inside its second after the security review: a member's call returns at once, and a response or person with few rows reads in milliseconds.
- **S22-3** also checks that the ask is recorded against the admin who asked, under **Spend by person**.
- The second slice of U-5 is U-11 in the backlog.
