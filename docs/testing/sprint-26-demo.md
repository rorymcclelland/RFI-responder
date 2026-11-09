# Sprint 26 review

Local run: build `a0e65cf` on sprint-26, 2026-11-09T15:36:22Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42645097987).
Staging run: build `a0e65cf` on sprint-26, 2026-11-09T15:36:49Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/42645097875).

## Sprint 26: A large response sent within the time limit, and the live demo's branch protected

**Running the checks yourself: once.** In PowerShell, in C:\Code\rfi-responder, on the sprint's branch: npm install -g npm@11, then npm ci. For browser tests, once: npx playwright install chromium.

**Running the checks yourself: database and browser tests.** Start Docker Desktop, then npx supabase start (the local Supabase stack). For database tests, point them at its database: $env:DB_TEST_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres'. They make, and drop, their own database called rfi_test there. For browser tests, reset the demo data first: npm run db:reset (the tests change it). Playwright starts the app itself.

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

**S26-1 1, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 1"
```
1. sprint26.test.ts: S26-1 1: the approved count is right after every kind of change

**S26-1 2, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 2"
```
1. sprint26.test.ts: S26-1 2: an update that changes no question's status recounts nothing

**S26-1 3, how to check it again.**

the full database suite, unchanged (Sprint 24 and 25 tests and the older suites)

**S26-1 4, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 4"
```
1. sprint26.test.ts: S26-1 4: the tags learned from a sent answer are the cited entries' tags, as before

**S26-1 5, how to check it again.**

1. Make a branch named sprint-<n>-f73 from the sprint's branch, and give it the deploy.yml of origin/sprint-26-f73: one job that runs only scripts/spikes/f73-hosted.sql on staging.
2. Push it. The Deploy run loads each size of synthetic response, times marking as sent and bulk approval as a signed-in owner, and rolls everything back.
3. In the run's log, each line starting F73 gives send_ms and bulk_ms; each run ends with left_behind=0.
4. Compare with the tables in docs/spikes/f73-sending-large-responses.md, then delete the branch.

**S26-1 6, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 6"
```
1. sprint26.test.ts: S26-1 6: a file that would take a response past 2,000 questions is refused, with the reason

**S26-1 7, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 7"
```
1. sprint26.test.ts: S26-1 7: a file of more than 2,000 questions is refused, whatever the app sends
2. sprint26.test.ts: S26-1 7 (security review, M1): a file cannot hold more questions than it said it would

**S26-1 8, how to check it again.**

```
npm run test:db -- supabase/tests/db/sprint26.test.ts -t "S26-1 8"
```
1. sprint26.test.ts: S26-1 8: two files added at once cannot together pass the limit

**S26-1 9, how to check it again.**

```
npm run test:e2e -- e2e/sprint-26.spec.ts -g "^A file that would take a response past 2,000 questions is refused before anything is uploaded$"
```
1. A response that already holds 1,999 questions: adding a file of 40
2. Refused before uploading: nothing was added

**S26-1 10, how to check it again.**

the Sprint 23 browser tests, unchanged

**S26-1 11, how to check it again.**

1. docs/guide/running-a-response.md, the paragraph on Add a file: a response holds at most 2,000 questions across its files.
2. docs/guide/common-problems.md, the row starting This response would have: what it means and what to do.
3. docs/GLOSSARY.md, the entry for response.
4. Check each says 2,000, the figure in supabase/migrations/20261113110000_response_size_limit.sql (max_questions).

### S26-2 Only the approved deploy can move live

The live demo changes only through a deploy Rory has approved: no other workflow, branch or person can publish to it.

| Case | What was checked | Result |
|---|---|---|
| S26-2 1 | A workflow on a throwaway sprint-* branch cannot move live with its own token (Deploy run 42628747644 on the throwaway branch sprint-26-f77 (9 November): GH013, repository rule violations; live stayed at 31dde04) | By hand |
| S26-2 2 | A push to live with the Claude session's own credentials is refused (9 November, after the admin bypass was removed: the push was declined for repository rule violations and live stayed at 31dde04 (GitHub: current_user_can_bypass never). The first try, with the bypass, went through: the session's credentials count as Rory, an admin; Rory put live back) | By hand |
| S26-2 3 | The approved production run moves live with the key, and the deploy completes (pending: the first production run after the merge) | By hand |
| S26-2 4 | The job's token cannot write, the key reaches only the push, and GitHub's host key is checked (scripts/deploy-order.test.ts (seen failing with a writable token and an unpinned host key) and scripts/deploy-steps.test.ts (the push run against a local stand-in: forward only, no key left, nothing planted runs)) | Checked in CI |
| S26-2 5 | Nothing deploys unless the production environment deploys from main only (scripts/deploy-steps.test.ts runs the ready check in each case and sees it refuse; the first production run passes it) | Checked in CI |
| S26-2 6 | main refuses force pushes and deletion; the merge still fast-forwards (pending: after Rory's set-up, at the merge) | By hand |
| S26-2 7 | The rulesets are as written, and the deploy refuses without them (scripts/setup-live-key.test.ts (the whole definitions) and scripts/deploy-steps.test.ts (no deploy without the rules in force); read through GitHub's API on 9 November: both rulesets active, live bypassed by deploy keys only, main by nobody) | Checked in CI |
| S26-2 8 | DEPLOYING.md and the risk register say what protects live, and what to do if the key is lost (read in review) | By hand |

**S26-2 1, how to check it again.**

1. After Rory's set-up, make a throwaway branch sprint-<n>-f77 whose deploy.yml has one job with contents: write that runs: git push https://x-access-token:${{ github.token }}@github.com/rorymcclelland/RFI-responder.git HEAD:refs/heads/live
2. Push it. The run must fail, GitHub refusing the push for the ruleset on live (GH013, repository rule violations).
3. gh api repos/rorymcclelland/RFI-responder/branches/live --jq .commit.sha shows live unchanged.
4. Delete the branch.

**S26-2 2, how to check it again.**

1. From the Claude session (or as any admin): git push origin <a commit on top of live>:refs/heads/live
2. GitHub refuses it (GH013, repository rule violations), and live is unchanged: git ls-remote origin refs/heads/live.
3. Only the approved deploy's key can move live; a rollback is Vercel's instant rollback, or Rory pausing the ruleset (docs/DEPLOYING.md).

**S26-2 3, how to check it again.**

1. After the merge, approve the production run in GitHub (Actions, Deploy, Review deployments).
2. Its step Move the live branch to this commit shows <previous>..<new> -> live, pushed with the deploy key.
3. Its step Check the deploy shows the live demo serving the new commit; Vercel's production deployment comes from live at that commit.

**S26-2 4, how to check it again.**

```
npm test -- scripts/deploy-order.test.ts -t "S26-2 4"
```
```
npm test -- scripts/deploy-steps.test.ts -t "S26-2 4"
```
1. deploy-order.test.ts: moves live to the deployed commit with the deploy key, over SSH to GitHub's pinned host key (S26-2 4)
2. deploy-order.test.ts: the job's own token cannot write, and the key reaches only the step that pushes (S26-2 4)
3. deploy-steps.test.ts: the push to live, run against a local stand-in for GitHub (S26-2 4; QA review L6)

**S26-2 5, how to check it again.**

```
npm test -- scripts/deploy-steps.test.ts -t "S26-2 5"
```
1. deploy-steps.test.ts: the ready check refuses before anything is deployed (S26-2 5 and 7)

**S26-2 6, how to check it again.**

1. git push --force origin <an older commit>:main is refused (non-fast-forward).
2. git push origin --delete main is refused.
3. At the sprint's merge, the fast-forward push of the sprint branch to main succeeds.

**S26-2 7, how to check it again.**

```
npm test -- scripts/setup-live-key.test.ts
```
```
npm test -- scripts/deploy-steps.test.ts
```
1. setup-live-key.test.ts: the whole file (no test in it names S26-2 7).
2. deploy-steps.test.ts: the whole file (no test in it names S26-2 7).

**S26-2 8, how to check it again.**

1. docs/DEPLOYING.md: Only the approved deploy moves live, and the row for scripts/setup-live-key.ts under Rotating the keys (what to do if the key is lost or leaked).
2. docs/governance/RISK-REGISTER.md, R-18: the controls and the residual.

