# Sprint 23 review

Staging run: build `2699718` on sprint-23, 2026-11-04T21:29:41Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41914682694).
Local run: build `2699718` on sprint-23, 2026-11-04T21:29:24Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41914682692).

## Sprint 23: Try it, the main path end to end, and a failing migration on staging

### S23-1 Try it with a sample questionnaire

A demo visitor gets their own response from a sample questionnaire, drafted with the AI, to work through, download and mark as sent, without anything they do being learned by the shared knowledge base.

| Case | What was checked | Result |
|---|---|---|
| S23-1 1 | Try it makes a response you own, named for the sample and for you, with the sample's questions drafted (the real AI on staging) (Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing; Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing) | Passed |
| S23-1 2 | The try is grouped as any response: pricing and legal need a person with their reasons; bulk approval and download work (Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing) | Passed |
| S23-1 3 | Marking a try as sent records it and learns nothing, and says so (Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing; Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing) | Passed |
| S23-1 4 | A try's questions are never gaps (supabase/tests/db/sprint23.test.ts) | Checked in CI |
| S23-1 5 | Other members do not see a try in their lists; an admin sees all, marked Try (A try is in its owner's lists and every admin's, marked Try; not in other members'; A try is in its owner's lists and every admin's, marked Try; not in other members'; Another member does not see someone else's try in their lists) | Passed |
| S23-1 6 | Try it again opens your try; Start a new try archives it and makes another (Open your try goes back to it; Start a new try puts it away and makes a fresh one) | Passed |
| S23-1 7 | Nobody can turn a response into a try or back, or make a try for someone else (supabase/tests/db/sprint23.test.ts) | Checked in CI |
| S23-1 8 | When a limit stops a try's drafting, the page says which (the limit itself is supabase/tests/db/sprint4.test.ts; five tries a day is supabase/tests/db/sprint23.test.ts) (When a limit stops a try's drafting, the page says which; When a limit stops a try's drafting, the page says which) | Passed |
| S23-1 9 | At phone width Try it and the try fit (At phone width Try it and the try fit; At phone width Try it and the try fit) | Passed |
| S23-1 10 | The guide and the glossary name Try it and its labels as the app shows them (docs/guide.test.ts (the labels, in the guide and the app) and docs/glossary.test.ts (the entry)) | Checked in CI |

### S23-2 The main path as one browser test

Every build proves the whole job still works end to end: add, upload, draft, ask a colleague, approve, download, mark as sent, learned.

| Case | What was checked | Result |
|---|---|---|
| S23-2 1 | Every step of the main path passes in one run, in order, on a response the test made, bulk approval included (on staging) (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent) | Passed |
| S23-2 2 | The downloaded Excel file holds every approved answer and the not-answered wording for the rest (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent) | Passed |
| S23-2 3 | The colleague's answer is in the knowledge base after Mark as sent, with the response named as its source (on staging, where drafts are checked) (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent) | Passed |
| S23-2 4 | The test fails, naming the step, if any step does not complete (by construction (each step waits for its own result); to be checked once by breaking a step on a branch) | By hand |

### S23-3 A migration that fails, tried on staging

We know that a failing migration stops a deploy and leaves the hosted database as it was.

| Case | What was checked | Result |
|---|---|---|
| S23-3 1 | The Deploy run stops at a failing migration, names it, and runs no later step (seen on staging in Deploy run 41896502103 on the throwaway branch sprint-23-f68 (DEPLOYING.md, When a migration fails)) | By hand |
| S23-3 2 | The table the failing migration created first is not on staging afterwards (a read-only query on staging after that run found no table and no record of the migration) | By hand |
| S23-3 3 | The next ordinary staging run passes (the Deploy run of this sprint branch on staging) | Checked in CI |
| S23-3 4 | The failing migration never reaches main (supabase/tests/migrations.test.ts (no probe migration in supabase/migrations); the throwaway branches are Rory's to delete) | Checked in CI |

