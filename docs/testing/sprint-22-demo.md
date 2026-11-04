# Sprint 22 review

Staging run: build `726d754` on sprint-22, 2026-11-04T07:13:42Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41790182034).
Local run: build `726d754` on sprint-22, 2026-11-04T07:07:32Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41789484320).

## Sprint 22: The response as a journey, plain settings, and the ask's usage on staging

### S22-1 The response as a journey, first slice

An owner opens a response and sees where it stands and what needs them: a header like its card on Responses, the questions grouped as Needs a person (each with one reason) and Ready to approve, what colleagues are doing under With experts, and Send.

| Case | What was checked | Result |
|---|---|---|
| S22-1 1 | The header shows the name, owner, due date, progress and stage, as the response's card on Responses does (The header says where the response stands, as its card on Responses does; every question in one group; The header says where the response stands, as its card on Responses does; every question in one group) | Passed |
| S22-1 2 | Every question is in exactly one group, and the groups add up to the header's count (The header says where the response stands, as its card on Responses does; every question in one group; The header says where the response stands, as its card on Responses does; every question in one group) | Passed |
| S22-1 3 | Ready to approve exactly when bulk approval could take it; each question that needs a person shows one reason, first (A question that needs a person says why, first; Ready to approve holds the rest; A question that needs a person says why, first; Ready to approve holds the rest) | Passed |
| S22-1 4 | Bulk approval takes only Ready to approve, and the groups update (Bulk approval takes only Ready to approve, and the groups update; Bulk approval takes only Ready to approve, and the groups update) | Passed |
| S22-1 5 | With experts lists every assigned question with the colleague and the stage word; choosing one opens it; the banner is gone (With experts: every question asked of a colleague, an answer first; choosing one opens it; With experts: every question asked of a colleague, an answer first; choosing one opens it) | Passed |
| S22-1 6 | Send works as in Sprint 21 on the new layout (the Sprint 21 browser tests (S21-1 1 to 7), run on the new layout in every build) | Checked in CI |
| S22-1 7 | A response with two files lists both in the header; choosing the other opens it (A response with two files lists both in the header; choosing the other opens it) | Passed |
| S22-1 8 | A member who does not own the response sees the header, groups and reasons, and no approval, assignment or send control (A member who does not own the response sees where it stands, and no approval, assignment or send control; A member who does not own the response sees where it stands, and no approval, assignment or send control) | Passed |
| S22-1 9 | At phone width the header, the stages and the groups fit (At phone width the header, the stages and the groups fit; At phone width the header, the stages and the groups fit) | Passed |
| S22-1 10 | An archived response shows the same page, read-only (An archived response shows the same page, read-only; An archived response shows the same page, read-only) | Passed |
| S22-1 11 | A question or file name containing markup shows as text (A question or file name containing markup shows as text; A question or file name containing markup shows as text) | Passed |
| S22-1 12 | The glossary has the new words; the guide describes the page as it is; the screenshots are retaken (docs/glossary.test.ts (the new words) and docs/guide.test.ts; the screenshots retaken by the CI screenshot run of c2ae75c and committed) | Checked in CI |

### S22-2 Plain settings, spend by use, and the audit log by person and response

An admin finds the settings they change most often first, sees what the money was spent on in plain words, and finds what one person did, or what happened to one response, in the audit log.

| Case | What was checked | Result |
|---|---|---|
| S22-2 1 | The everyday settings first; Advanced, closed until opened, holds the reserves, exchange rate, prices and spend by model; saving from either works and is audited (Plain settings first, the tuning under Advanced, and spend by use; Plain settings first, the tuning under Advanced, and spend by use) | Passed |
| S22-2 2 | Spend by use: each function has its plain name, an unknown one its own, and the uses add up to the month's total (src/lib/usage.test.ts and supabase/tests/db/sprint22.test.ts) | Checked in CI |
| S22-2 3 | The person filter shows only what that person did, including someone whose profile was deleted since (The audit log by person and by response, with the kind, together; Someone whose account was deleted is a former user in the person filter and the rows; The audit log by person and by response, with the kind, together; Someone whose account was deleted is a former user in the person filter and the rows) | Passed |
| S22-2 4 | The response filter shows the response's own rows, its files' and its questions', and nothing else (The audit log by person and by response, with the kind, together; The audit log by person and by response, with the kind, together) | Passed |
| S22-2 5 | The filters combine with the kind; at most 200, newest first, with a line when more match (The audit log by person and by response, with the kind, together; The audit log says when more entries match than it shows; The audit log by person and by response, with the kind, together; The audit log says when more entries match than it shows) | Passed |
| S22-2 6 | A member and a signed-out caller get nothing; an admin gets the rows (supabase/tests/db/sprint22.test.ts) | Checked in CI |
| S22-2 7 | Names containing markup show as text in the filters and the rows (Names with markup show as text in the audit log's filters and rows; Names with markup show as text in the audit log's filters and rows) | Passed |
| S22-2 8 | With 50,000 audit rows the filtered read answers in under a second (supabase/tests/db/sprint22.test.ts) | Checked in CI |

### S22-3 The ask's usage on staging

Each staging run proves that its real-AI question is recorded as spend the admin can see.

| Case | What was checked | Result |
|---|---|---|
| S22-3 1 | On staging: after the question, Asking the knowledge base shows more calls than before (Ask it a question: the real pipeline on staging, the fallback locally) | Passed |
| S22-3 2 | Locally, with the providers off: the fallback is checked and the count not compared (Ask it a question: the real pipeline on staging, the fallback locally) | Passed |
| S22-3 3 | The daily cap is not reached in the browser (Q4) (the ask reserves one question, all or nothing, with reserveQuota before any provider is called (supabase/functions/ask-knowledge/index.ts); the cap and the refusal are tested in supabase/tests/db/sprint4.test.ts and supabase/functions/_shared/usage.test.ts) | Checked in CI |

