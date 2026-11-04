# Sprint 24 review

Staging run: build `26d28a4` on sprint-24, 2026-11-04T22:34:45Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41925231070).
Local run: build `26d28a4` on sprint-24, 2026-11-04T22:33:46Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41925231096).

## Sprint 24: One response, one list, sent as a whole

### S24-1 One list across a response's files, sent as a whole

A customer who sent more than one questionnaire gets one response: every question in one list, approved in bulk once, and marked as sent once, with each file downloaded on its own.

| Case | What was checked | Result |
|---|---|---|
| S24-1 1 | A response with two files lists every question of both, each naming its file; the header and the groups agree (One list across a response's files, with a filter by file) | Passed |
| S24-1 2 | The filter shows one file's questions, and the page says they are filtered (One list across a response's files, with a filter by file) | Passed |
| S24-1 3 | Bulk approval takes the questions ready to approve across every file (on staging, where drafts are checked; every hold by supabase/tests/db/sprint24.test.ts) (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent) | Passed |
| S24-1 4 | Mark as sent is offered only when every question in every file is decided, and records the whole response once (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; Marked as sent once, for the whole response, when every file is decided; downloads one per file; no file added after) | Passed |
| S24-1 5 | A response is never Sent while a file of it is undecided (supabase/tests/db/sprint24.test.ts) | Checked in CI |
| S24-1 6 | A change after sending shows Changed since sent for the response, and it is marked as sent again (A change after sending reopens the whole response, and it is marked as sent again) | Passed |
| S24-1 7 | Each file downloads its own questions only, named for its file (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; Marked as sent once, for the whole response, when every file is decided; downloads one per file; no file added after) | Passed |
| S24-1 8 | Adding a file to a sent response is refused, and the page says why (the refusal itself, for owner and admin, by supabase/tests/db/sprint24.test.ts) (Marked as sent once, for the whole response, when every file is decided; downloads one per file; no file added after) | Passed |
| S24-1 9 | A one-file response, and a try, look and behave as before (the Sprint 22 and 23 browser tests. Changed: the header's files (S22-1 1 counts one file where it looked for "(open)"; S22-1 7 checks the filter); the main path now sends two files. One-file responses are still driven end to end by the Sprint 23 try test and the Sprint 21 and 22 tests on the demo's responses) | Checked in CI |
| S24-1 10 | Every row of the role matrix for the two new functions (supabase/tests/db/sprint24.test.ts) | Checked in CI |
| S24-1 11 | At phone width the files filter and the file on each card fit (At phone width the files filter and the file on each card fit) | Passed |
| S24-1 12 | The guide and the glossary describe it as it is (docs/guide.test.ts and docs/glossary.test.ts) | Checked in CI |

### S24-2 What was learned, kept with a sent response

Anyone opening a sent response sees what the knowledge base did with its answers, not only the person who marked it as sent.

| Case | What was checked | Result |
|---|---|---|
| S24-2 1 | A sent response opened later says what was learned, as it did when it was sent (The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent; The main path, end to end: add, upload, draft, assign, answer, approve, download, mark as sent) | Passed |
| S24-2 2 | A try opened later says nothing was learned from it (Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing; Try it: your own response from the sample, drafted, worked through and marked as sent, learning nothing) | Passed |
| S24-2 3 | Every stored outcome is said in the words of the report (src/lib/wholeResponse.test.ts) | Checked in CI |
| S24-2 4 | A response changed since it was sent says the report is the last sending's (A change after sending reopens the whole response, and it is marked as sent again) | Passed |

### S24-3 The main path test seen failing

We know the end-to-end test catches a broken step, and says which.

| Case | What was checked | Result |
|---|---|---|
| S24-3 1 | The CI run fails in the main path test at the broken step, naming it (CI run 41919882875 on the throwaway branch f72-broken-step (docs/testing/f72-broken-step.md)) | By hand |
| S24-3 2 | No other test fails because of the break, other than ones using the same step (the same run: the other failures use the colleague's Approve or the data it leaves (docs/testing/f72-broken-step.md)) | By hand |
| S24-3 3 | The break never reaches main (pending until Rory deletes f72-broken-step: it is not merged, and main does not contain e5ad969) | By hand |

