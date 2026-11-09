# Sprint 26 review

Local run: build `bb70f63` on sprint-26, 2026-11-09T09:04:40Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42589789337).
Staging run: build `bb70f63` on sprint-26, 2026-11-09T09:06:13Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42589789354).

## Sprint 26: A large response sent within the time limit, and the live demo's branch protected

### S26-1 A large response sent within the time limit, and a limit at upload

Any response the app lets you build can be marked as sent and approved in bulk on the hosted database; one too large is refused when its file is added, with the reason.

| Case | What was checked | Result |
|---|---|---|
| S26-1 1 | The approved count is right after approving, un-approving, several at once, and an update that changes no status (supabase/tests/db/sprint26.test.ts) | Checked in CI |
| S26-1 2 | An update that changes no question's status recounts nothing (supabase/tests/db/sprint26.test.ts (seen failing before the fix)) | Checked in CI |
| S26-1 3 | Marking as sent and bulk approval do what they did before, for every role (the full database suite, unchanged (Sprint 24 and 25 tests and the older suites)) | Checked in CI |
| S26-1 4 | The tags learned from a sent answer are the same as before (supabase/tests/db/sprint26.test.ts (passing before and after the fix)) | Checked in CI |
| S26-1 5 | On staging, sending and bulk approval timed at each size, rolled back, nothing left behind (Deploy runs 42531540549 and 42532333906 on the throwaway branch sprint-26-f73 (9 November); figures in docs/spikes/f73-sending-large-responses.md) | By hand |
| S26-1 6 | A file that would take a response past the limit is refused, saying its size and the limit; exactly to the limit is accepted (supabase/tests/db/sprint26.test.ts (owner and admin; a count raised, a file moved)) | Checked in CI |
| S26-1 7 | A file of more than 2,000 questions is refused, whatever the app sends (supabase/tests/db/sprint26.test.ts: a stated count over 2,000, and (security review, M1) a question beyond a file's stated count, through the API) | Checked in CI |
| S26-1 8 | Two files added at once cannot together pass the limit (supabase/tests/db/sprint26.test.ts (two connections; and, from the QA review, no deadlock when another statement reads the response)) | Checked in CI |
| S26-1 9 | The page refuses a file that would pass the limit before uploading it, and says why; a file that fits is added as before (A file that would take a response past 2,000 questions is refused before anything is uploaded; A file that would take a response past 2,000 questions is refused before anything is uploaded) | Passed |
| S26-1 10 | A try is not affected (the Sprint 23 browser tests, unchanged) | Checked in CI |
| S26-1 11 | The guide and the glossary say what the limit is (read in review; CI checks the docs' links and spelling) | By hand |

### S26-2 Only the approved deploy can move live

The live demo changes only through a deploy Rory has approved: no other workflow, branch or person can publish to it.

| Case | What was checked | Result |
|---|---|---|
| S26-2 1 | A workflow on a throwaway sprint-* branch cannot move live with its own token (pending: after Rory runs scripts/setup-live-key.ts, from the throwaway branch's run log and live read through the API) | By hand |
| S26-2 2 | A push to live with ordinary repository credentials is refused (pending: after Rory's set-up, the push's output) | By hand |
| S26-2 3 | The approved production run moves live with the key, and the deploy completes (pending: the first production run after the merge) | By hand |
| S26-2 4 | The job's token cannot write, the key reaches only the push, and GitHub's host key is checked (scripts/deploy-order.test.ts (seen failing with a writable token and an unpinned host key) and scripts/deploy-steps.test.ts (the push run against a local stand-in: forward only, no key left, nothing planted runs)) | Checked in CI |
| S26-2 5 | Nothing deploys unless the production environment deploys from main only (scripts/deploy-steps.test.ts runs the ready check in each case and sees it refuse; the first production run passes it) | Checked in CI |
| S26-2 6 | main refuses force pushes and deletion; the merge still fast-forwards (pending: after Rory's set-up, at the merge) | By hand |
| S26-2 7 | The rulesets are as written, and the deploy refuses without them (scripts/setup-live-key.test.ts (the whole definitions) and scripts/deploy-steps.test.ts (no deploy without the rules in force); read through GitHub's API after Rory's set-up) | Checked in CI |
| S26-2 8 | DEPLOYING.md and the risk register say what protects live, and what to do if the key is lost (read in review) | By hand |

