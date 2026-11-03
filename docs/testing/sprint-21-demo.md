# Sprint 21 review

Staging run: build `dfe9736` on sprint-21, 2026-11-03T17:06:08Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41660351743).
Local run: build `dfe9736` on sprint-21, 2026-11-03T15:11:04Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41660351997).

## Sprint 21: Sending made plain, gaps, and configuration as code

### S21-1 Download separate from Mark as sent

An owner downloads the answers once every question is decided, and marks the response as sent separately; Mark as sent says beforehand what it will do. The stages read Sent and Changed since sent.

| Case | What was checked | Result |
|---|---|---|
| S21-1 1 | With questions still to do: no Download, no Mark as sent, and the reason (Nothing to download or mark as sent while questions are still to do; Nothing to download or mark as sent while questions are still to do) | Passed |
| S21-1 2 | Download works without marking anything as sent (Q1) (Changed since sent, download, the confirmation, and marking as sent again; Changed since sent, download, the confirmation, and marking as sent again) | Passed |
| S21-1 3 | Mark as sent says what will happen, with counts; Cancel changes nothing (Changed since sent, download, the confirmation, and marking as sent again; Changed since sent, download, the confirmation, and marking as sent again) | Passed |
| S21-1 4 | Confirming marks it Sent, records who and when, closes the assignment, says what was learned (Changed since sent, download, the confirmation, and marking as sent again; Changed since sent, download, the confirmation, and marking as sent again) | Passed |
| S21-1 5 | A change after sending shows Changed since sent; Mark as sent again records it (Changed since sent, download, the confirmation, and marking as sent again; Changed since sent, download, the confirmation, and marking as sent again) | Passed |
| S21-1 6 | No visible text says Exported, Record export or export recorded (Q2) (docs/glossary.test.ts) | Checked in CI |
| S21-1 7 | A member who does not own the response sees neither button (A member who does not own the response sees neither Download nor Mark as sent; A member who does not own the response sees neither Download nor Mark as sent) | Passed |

### S21-2 Gaps

Knowledge shows what the knowledge base could not answer in recent responses, grouped by wording, with where each stands.

| Case | What was checked | Result |
|---|---|---|
| S21-2 1 | A question from the last 90 days is listed; one from 91 days ago, archived or not, is not (supabase/tests/db/sprint21.test.ts) | Checked in CI |
| S21-2 2 | Pricing questions are never listed (supabase/tests/db/sprint21.test.ts) | Checked in CI |
| S21-2 3 | The same wording but for case, spaces and punctuation forms one group, asked in 2 responses (supabase/tests/db/sprint21.test.ts) | Checked in CI |
| S21-2 4 | Each state, in the database and as the page shows it (Gaps: what the knowledge base could not answer, where each stands, and one step to act; Gaps: what the knowledge base could not answer, where each stands, and one step to act) | Passed |
| S21-2 5 | Open it in the response opens the response at that question (Gaps: what the knowledge base could not answer, where each stands, and one step to act; Gaps: what the knowledge base could not answer, where each stands, and one step to act) | Passed |
| S21-2 6 | Every member sees the same gaps; a signed-out caller is refused (supabase/tests/db/sprint21.test.ts) | Checked in CI |
| S21-2 7 | A question containing markup shows as text (Gaps show a question's markup as text; Gaps show a question's markup as text) | Passed |
| S21-2 8 | With 5,000 questions the function answers in under a second (supabase/tests/db/sprint21.test.ts) | Checked in CI |

### S21-3 Configuration as code, checked; a set-up script

Every deploy checks the hosted sign-in settings against the repository; a script stores the keys in GitHub without anyone copying them.

| Case | What was checked | Result |
|---|---|---|
| S21-3 1 | The sign-in settings check passes on staging and the live demo as they are (the Deploy workflow, step "Sign-in settings match the repository": passed on staging on 3 November 2026 (run 41660351743); on the live demo it runs before the first approved deploy) | Checked in CI |
| S21-3 2 | A setting that differs fails the deploy and names it; put right, it passes (seen on 3 November 2026 with a real difference rather than a test one: staging had no redirect address; the check failed naming it, Rory added it, and the next run passed. Sign-ups were not turned on for a test (the same rule, also a unit test)) | By hand |
| S21-3 3 | The script's dry run lists the secrets it would set, by name only (scripts/setup-secrets.test.ts) | Checked in CI |
| S21-3 4 | The script refuses a key of the wrong kind, and the live demo's project for staging (scripts/setup-secrets.test.ts) | Checked in CI |
| S21-3 5 | Nothing the script or the check prints contains a key (scripts/setup-secrets.test.ts) | Checked in CI |

### S21-4 One real-AI step on staging

Each staging run asks one question with the real models, proving the whole pipeline end to end.

| Case | What was checked | Result |
|---|---|---|
| S21-4 1 | On staging: a calibrated confidence, the checker's verdict and a cited entry (Ask it a question: the real pipeline on staging, the fallback locally) | Passed |
| S21-4 2 | Locally: the fallback answer, not calibrated (Ask it a question: the real pipeline on staging, the fallback locally) | Passed |
| S21-4 3 | The ask is recorded under the admin's usage, and the daily cap applies (not built in Sprint 21: the staging run does not read the usage line on Governance (QA review); built and checked in Sprint 18, and to be added to the staging test) | By hand |

