# Sprint 24 refinement: one response, one list, sent as a whole

Refined 4 November 2026, as proposed at the Sprint 23 review: U-11 (U-5's second slice: one question list across a response's files, bulk approval and **Mark as sent** for a whole response), F-71 (what was learned, kept with a sent response) and F-72 (the main path test seen failing on a broken step).

## What refinement found

- **The response page shows one file at a time.** It loads the questions of the open file (`loadQuestions(session)`), and the header lists the files to switch between. The header's figures are already the whole response's (Sprint 22), so the header and the list can disagree: "12 of 20 decided" above a list of eight.
- **Bulk approval and marking as sent work on one file.** `bulk_accept(p_session, …)` and `record_export(p_session)` each take a file. `record_export` marks the response as sent when its first file is sent, so a response with two files can read **Sent** on Responses while its second file is undecided.
- **Downloads are per file.** The Excel, CSV and Word files are built from the open file's questions. A customer who sent two questionnaires expects two files back.
- **What was learned is already stored per question.** `record_export` writes `learn_outcome` on each question, and the page already reads it (`learnOutcome`). The report shown after sending is counted from the function's result and then dropped, so a sent response opened later does not say what was learned (F-71), although the data is there. F-71 needs no migration.
- **A change after sending reopens a file** (Sprint 11, S11-1: "Changed since sent"); that must still hold for a whole response.
- **Most responses have one file.** The demo's responses and every try have one; the change must leave a one-file response looking as it does now.
- **F-72 needs a branch.** CI runs on every branch; Deploy runs only on `sprint-*` and `main`, so a branch named otherwise is tested in CI without touching staging.

## Stories

### S24-1 One list across a response's files, sent as a whole. L (U-11)

**The job.** An owner whose customer sent more than one questionnaire works through the response once: every question in one list, approved in bulk once, and the response marked as sent once, when everything is decided.

**Before and after.**
- Today: the owner opens each file in turn, approves each in bulk, downloads and marks each as sent; Responses can call the response **Sent** while a file is undecided.
- After (Q1 a, Q3 a): the response page lists every question of every file, each card naming its file when there is more than one, with a filter by file; the groups, counts and bulk bar cover the whole response; **Mark as sent** is one step for the whole response, offered when every question in every file is decided, and records every file and the learning in one transaction; downloads stay one per file (Q2 a), from the **Send** stage, which lists each file with its buttons.

**What changes.**
- `bulk_accept_response(p_response, p_min_confidence)` and `record_response_export(p_response)` (definer functions, the same rules as the per-file ones, all or nothing), with role-matrix tests (decision 0003). The per-file functions stay for exports recorded before, and are no longer called by the app.
- The response is **Sent** only when every file is (Q3); a change after sending reopens the response as "Changed since sent", as today for a file.
- The page loads every file's questions; the open-file switcher becomes a filter. Adding a file to a sent response is refused (Q4 a) with the reason.
- The guide, the glossary and the screenshots.

**Test cases.**
1. A response with two files lists every question of both, each naming its file; the header's figures and the groups' counts agree (browser).
2. The filter shows one file's questions, and the counts say they are filtered (browser).
3. Bulk approval takes exactly the questions the page calls **Ready to approve** across every file, and nothing in a file the person may not decide (database, browser).
4. **Mark as sent** is offered only when every question in every file is decided; it records every file and teaches the knowledge base once, all or nothing, and says what was learned (database, browser).
5. A response is never **Sent** on Responses while a file of it is undecided (database).
6. A change to any answer after sending shows "Changed since sent" for the response, and marking it as sent again records it (database, browser).
7. Each file downloads its own questions only, named for its file (browser, reading the files).
8. Adding a file to a sent response is refused, and the page says why (database, browser).
9. A one-file response, and a try, look and behave as before (browser: the Sprint 22 and 23 tests unchanged).
10. Every row of the role matrix for the two new functions (database).
11. At phone width, the file names on the cards and the filter fit (browser, phone).
12. The guide and the glossary describe it as it is (CI).

**Out of scope.** One download for the whole response; moving a question between files; removing a file.

**Boundaries.** Rule 1: the page never calls a response sent unless every file is. R-10 and R-03: learning happens once, by the same rules as today. Decision 0003: the new functions get RLS-equivalent checks and tests for every role.

### S24-2 What was learned, kept with a sent response. S (F-71)

**The job.** Anyone opening a sent response can see what the knowledge base did with its answers, not only the person who pressed **Mark as sent**, at that moment.

**What changes.** The **Send** stage of a sent response counts the stored outcomes of its questions and shows the same sentence as at the moment of sending ("Knowledge base: 1 added as new entries; …"). No migration.

**Test cases.**
1. A sent response opened later shows what was learned, matching what was shown when it was sent (browser; the main path test reopens it).
2. A try opened later says nothing was learned from it (browser).
3. A response sent before Sprint 24 (stored outcomes from earlier sprints) shows its outcomes in the same words (unit, from each stored outcome).
4. A response changed since it was sent says the report is for the last time it was sent (unit, browser).

### S24-3 The main path test seen failing. S (F-72)

**The job.** We know the main path test fails, and names the step, when a step breaks; S23-2's last case.

**What changes.** A throwaway branch, `f72-broken-step` (not `sprint-*`, so CI only, no staging), with one app change that breaks a step (the colleague's **Approve** saves nothing). Its CI run is recorded in `docs/testing/` and the S23-2 4 case's evidence; the branch is never merged, and is Rory's to delete.

**Test cases.**
1. The CI run fails in the main path test at the colleague's step, naming it (the run's log).
2. No other test in that run fails because of the break, other than ones that use the same step (the run's log).
3. The break never reaches `main` (the branch is deleted; `main` unchanged).

## The sprint as a whole

Order: S24-3 first (stands alone, one CI run), then S24-1, then S24-2 on the **Send** stage S24-1 rebuilds. About three days. No spike.

**Hand checks for Rory.** None planned.

## Questions for Rory

- **Q1 One list or one file at a time.** (a) One list of every question in the response, each card naming its file, with a filter by file (recommended: the header already speaks for the whole response, and an owner decides a response, not a file); (b) keep one file at a time, with a response-level summary above it.
- **Q2 Downloads.** (a) One download per file, as now, from the **Send** stage (recommended: the customer gets back each questionnaire they sent); (b) one Excel file for the whole response, with a File column; (c) both.
- **Q3 Marking as sent.** (a) One **Mark as sent** for the whole response, when every question in every file is decided, recording every file and the learning in one transaction (recommended: the response is what is sent, and Responses can never say **Sent** too early); (b) per file, as now, with the response **Sent** only when every file is.
- **Q4 A file added after sending.** (a) Refused: a sent response is a record of what was sent, and a later questionnaire is a new response (recommended); (b) allowed: the response goes back to in progress until the new file is decided and the response is marked as sent again.
- **Q5 The break for F-72.** (a) A throwaway branch tested in CI only, not on staging (recommended: it proves the test, and costs no real-AI run); (b) also on staging.

## Rory's answers (4 November 2026)

- **Q1:** (a). One list of every question in the response, each card naming its file, with a filter by file.
- **Q2:** (a). One download per file, from the **Send** stage.
- **Q3:** (a). One **Mark as sent** for the whole response, when every question in every file is decided, in one transaction.
- **Q4:** (a). Adding a file to a sent response is refused; a later questionnaire is a new response.
- **Q5:** (a). The F-72 branch runs in CI only.

All three stories are Ready, Sprint 24.

## While building

- **S22-1 7 changes by Q1.** Its agreed case said choosing the other file opens it; with one list, choosing a file filters the list to it. The case's wording in `e2e/cases.ts` says so, and its test checks the filter.
- **The main path's questionnaire is two files.** The sample's two halves, uploaded one after the other, so the main path also proves S24-1 on staging with the real AI (bulk approval across both files, one Mark as sent, one download each) for the same twelve questions as before: no extra real-AI cost.
- **S22-1 1's header check** looked for the open file's "(open)" marker; with a filter there is no open file, so it counts the one file listed.
- **S24-2 after a second sending.** The report at the moment of sending covers what that sending learned; opened later, the page counts what every sending learned. When there was more than one, it says so: "Knowledge base, across every time it was marked as sent: …" (QA review, M3).
- **Reviews.** Security: a file added during the export, or a question added to a sent file, could leave a response Sent with work outstanding (both now refused, with a lock, and tested with two connections); a file still being uploaded is not sent. Two items for the backlog: marking a very large response as sent can pass the database's statement time limit (measured 9 seconds at four files of 500 questions; F-73), and the per-file functions are still callable through the API, though a response is never called sent until every file is (F-74). QA: S24-1 8's page now says why no file can be added; bulk approval on staging checks exactly the ready questions were taken; each download is checked by its questions' text; the list reads more than 1,000 questions in pages.
- **Two older database tests** marked a response as sent without sending its file, which the database now refuses to call sent; they send the file first.
- **A response marked as sent before Sprint 24 with a file unsent** is no longer called sent: the migration clears that mark on responses not archived (none of the demo's responses has more than one file).

## Close (5 November 2026)

All three stories are done; Rory signed off from the demo page and approved the production deploy, which applied both migrations and the functions. Its last check failed because a later README commit was already live; the check now accepts a later build that includes the deployed commit (F-76). The deploy also showed the app reaching the live demo three hours before its migrations (F-75, proposed first for Sprint 25). BUG-47, three messages that still spoke of one file, was fixed at the close. The evidence is in the Sprint 24 review in `docs/BACKLOG.md` and on the demo page (`docs/testing/sprint-24-demo.md`).
