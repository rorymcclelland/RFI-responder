# Sprint 26 refinement: a large response sent within the time limit, and the live demo's branch protected

Refined 7 November 2026, as confirmed at the Sprint 25 review: S26-1, the F-73 fix the Sprint 25 spike found, then a limit at upload (Rory: fix, measure again on staging, then cap; one limit covers bulk approval too); and F-77, protecting `live` and `main` (the Sprint 25 security review's High finding).

## What refinement found

- **The spike named the two causes** ([`docs/spikes/f73-sending-large-responses.md`](../spikes/f73-sending-large-responses.md)): the Sprint 3 trigger `rfi_questions_accepted_count` recounts a file after every update of its questions, whatever changed, and `record_export` looks up the cited entries' tags with `ref IN (subquery)`, which scans the knowledge base. Both fixes were tried on the local test database only, never against the database tests.
- **`record_export` is long** (Sprint 23's version, about 190 lines). Changing its tag lookup means replacing the whole function in a migration. `CREATE OR REPLACE` keeps Sprint 25's revoke, and the Sprint 25 test fails if any version of it becomes callable again.
- **No limit on a file's size is enforced by the database.** The app's spreadsheet reader stops at 2,000 rows a file (`src/lib/spreadsheet.ts`), but the count itself is whatever the app sends (and, as the security review found, nothing stopped a file holding more questions than its count either): a hand-made request could create a file of 100,000. Files are created by the app (`RFIWorkspace.tsx`, `tryIt.ts`), one row in `rfi_sessions` with its `question_count`, then its questions.
- **The live demo has three files**, none large, so a limit at upload changes nothing there today.
- **The repository is public, and has no rulesets yet** (read through the GitHub API, 7 November). Rulesets can be read from here, but not written: GitHub settings are Rory's.
- **What can move `live` today:** the production job (after approval), any workflow on a `sprint-*` branch (its token can write, and a branch can replace the workflow, as `sprint-25-f73` did), and anyone with push rights. A push made with a workflow's own token starts no other workflow, so a `sprint-*` workflow pushing `main` would not start a production run.
- **Claude fast-forwards `main` from the cloud workspace** at each sprint's merge, and so must still be able to after F-77.

## Stories

### S26-1 A large response sent within the time limit, and a limit at upload. M to L (F-73)

**The job.** An owner can mark as sent, and approve in bulk, any response the app lets them build, on the hosted database. A response too large for that is refused when its file is added, with the reason, not when **Mark as sent** fails after the work is done.

**Before and after.**
- Today: a response of two files of 2,000 questions can be built, decided and then not marked as sent on the live demo (10.4 to 10.8 seconds on staging against the 8-second limit), with "canceling statement due to statement timeout".
- After (Rory, 7 November): sending grows in a straight line with the number of questions; the figure on staging is measured again; and adding a file that would take the response past the limit set from that figure is refused, by the database and explained by the app, for sending and bulk approval alike.

**What changes.**
- A migration: the trigger recounts only the files whose number of approved questions the statement changed (counted from its old and new rows, without joining them, and still recounted exactly from the table), and `record_export` finds the cited entries' tags through the unique index (`ref = ANY (ARRAY(...))`). No change to what either does.
- Staging measured again with the spike's script, on a throwaway branch (`sprint-26-f73`, as in Sprint 25), rolled back; the figures added to the spike's write-up.
- A second migration, once the figure is known: a check before a file is added (or its count changed) that refuses a file of more than 2,000 questions, or one that would take its response past the limit, locking the response so two uploads at once cannot both get in under it. The limit is a constant in the database (no configuration row: Sprint 11's rule on what migrations insert).
- The app: before uploading, the response page checks the file against the limit and says why it is refused; the database's refusal is shown in the same words if the app's check is got round.
- The guide and the glossary: the limit, in the help for adding a file.

**Test cases.**
1. The approved count of a file is right after: a question approved, un-approved, approved in bulk with others in the same statement, and an update that changes no status (database).
2. An update that changes no question's status recounts nothing (database: a count set wrong on purpose stays wrong after such an update, and is put right by the next change of status).
3. Marking as sent and bulk approval do what they did before, for every role (database: the Sprint 24 and 25 tests and the older suites, unchanged).
4. The tags learned from a sent answer are the same as before, including an answer citing several entries and one citing none (database).
5. On staging, sending and bulk approval at 1 × 500, 4 × 500, 2 × 2,000 and 3 × 2,000 questions, timed twice each and rolled back, with nothing left behind; the figures recorded in the spike's write-up (by hand: the throwaway branch's run log, as in Sprint 25).
6. Adding a file that would take a response past the limit is refused, by the database, saying the response's size and the limit; a file that brings it exactly to the limit is accepted (database).
7. A file of more than 2,000 questions is refused by the database, whatever the app sends (database: hostile input).
8. Two files added at once to the same response cannot together pass the limit (database: two connections, as in Sprint 24).
9. The page refuses a spreadsheet that would pass the limit before uploading it, says why, and uploads nothing; a file that fits is added as before (browser).
10. A try is not affected (browser: the Sprint 23 tests unchanged; the sample is 12 questions).
11. The guide and the glossary say what the limit is (CI: the docs tests; the figure itself read in review).

**Out of scope.** Sending in steps (it would break "sent as a whole, all or nothing", Sprint 24, Q3); a faster upload or drafting; a different time limit (it is Supabase's, for signed-in users); responses already larger than the limit (none on the live demo).

**Boundaries.** Rule 1: the help states the limit the database enforces, nothing more. Synthetic data only on staging, rolled back. Decision 0003: the new check is tested for every role that can add a file. Migrations insert no rows.

**Risks and unknowns.** The staging figure decides the limit; if the fixed sending is slower on staging than the spike's estimate, the limit may come out below 4,000 questions (Q2). The spike's estimate was 1.1 to 1.7 ms a question there.

### S26-2 Only the approved deploy can move `live`. M (F-77)

**The job.** The live demo changes only through a production run Rory has approved: no other workflow, branch or person can publish to it by moving `live`.

**Before and after.**
- Today: anyone with push rights, or any workflow on a `sprint-*` branch, can move `live`, and Vercel publishes it.
- After: a GitHub ruleset on `live` refuses every update, force push and deletion, except by one deploy key whose private half is a secret of the `production` environment, available only to an approved production run. The production job pushes with that key; its own token goes back to read-only. `main` gets the protection Rory chooses (Q4).

**What changes.**
- Rory, in GitHub (steps written for him, in a test pack): a ruleset on `live`; the deploy key created and stored by a script he runs on his PC (Q5), so the private key is never shown or copied; `main`'s protection (Q4).
- `deploy.yml`, the production job: `contents: read`; the push to `live` over SSH with the key, checking GitHub's host key against GitHub's published one; the ready check also refuses unless the `production` environment deploys from `main` only (the rest of the Sprint 25 review's L1).
- `scripts/deploy-order.test.ts`: the job's permissions read-only, the push by key, the host key pinned, the key's secret used only in that step.
- `DEPLOYING.md`, the risk register (R-18's residual) and the set-up steps.

**Test cases.**
1. A workflow on a throwaway `sprint-*` branch that tries to move `live` with its own token is refused, and `live` does not move (by hand: the throwaway branch's run log, then `live` read through the API).
2. A push to `live` with ordinary repository credentials (Claude's, from the cloud workspace) is refused (by hand: the push's output).
3. The approved production run moves `live` with the key, and the deploy completes (by hand: the first production run after the merge, as in Sprint 25).
4. The production job's token cannot write, the key reaches only the step that pushes, and GitHub's host key is checked (CI: `deploy-order.test.ts`, seen failing on each).
5. The ready check refuses when the `production` environment deploys from other branches (CI: the order test reads the check; by hand: the first production run passes it).
6. `main` behaves as Rory chose (Q4): for (a), a force push and a deletion are refused, and Claude's fast-forward at the merge still works (by hand, at the merge).
7. The ruleset is as written: read through the GitHub API after Rory sets it up (by hand: the API's answer recorded).
8. `DEPLOYING.md` and the risk register say what protects `live`, and what to do if the key is lost or must be changed (review).

**Out of scope.** Protecting `staging` or the results branches; signed commits; changing who approves.

**Boundaries.** Rory makes the ruleset and holds the key (account and credential changes are his); Claude never sees the private key. The approval rule is unchanged, and now covers `live` itself.

**Risks and unknowns.** A rollback by moving `live` back (`DEPLOYING.md`) now needs the ruleset's bypass: Rory, as the repository's admin, can be a bypass actor, or roll back with Vercel's instant rollback (Q4 covers it).

## The sprint as a whole

Order: S26-1's first migration and the staging measurement first (the limit waits on the figure, measured within this story, not a spike: the fix itself is known); then S26-2, whose GitHub steps Rory can do while S26-1 is reviewed; then S26-1's limit. About three days.

**Hand checks for Rory.** S26-2's set-up (the ruleset and the key script) in a short test pack, and its cases 1 to 3 and 6 are read from run logs after his set-up.

## Questions for Rory

- **Q1 Where the limit lives.** (a) In the database, a constant checked when a file is added, with the same figure in the app to explain it before uploading (recommended: the database is the rule, the app explains it, and a hand-made request cannot get round it); (b) in the app only.
- **Q2 The figure.** (a) From the staging measurement: the largest multiple of 500 questions whose sending takes under 4 seconds there (half the limit), recorded in the spike's write-up, and never above 6,000 (recommended); (b) 2,000 now, without waiting for the measurement (it takes 4.3 seconds on staging today, just over half).
- **Q3 A response over the limit.** When a new file would take a response past the limit: (a) refused, saying the response's size and the limit, and that the rest belongs in a new response (recommended: the same as a file added to a sent response, Sprint 24); (b) the file is cut to fit.
- **Q4 `main`.** (a) A ruleset that refuses force pushes and deletion of `main`; updates by fast-forward stay possible, so the merge works as now (recommended: `main` no longer publishes, and every deploy from it waits for your approval); (b) changes to `main` only through a pull request you merge; (c) nothing on `main`. For rolling back `live`: you as the bypass for the `live` ruleset (recommended), or Vercel's instant rollback only.
- **Q5 The key.** (a) A script you run on your PC creates the key pair, adds the public half as a deploy key that can write, and stores the private half as the `production` environment's secret with `gh`, then deletes the local copy, so it is never shown or copied (recommended, like Sprint 21's key script); (b) by hand in GitHub's settings.

## Rory's answers (7 November 2026)

- **Q1:** (a). The limit is a constant in the database, checked when a file is added, and the app explains it before uploading.
- **Q2:** (a). The figure comes from the staging measurement after the fix: the largest multiple of 500 questions whose sending takes under 4 seconds there, at most 6,000, recorded in the spike's write-up.
- **Q3:** (a). A file that would take a response past the limit is refused, saying the response's size and the limit, and that the rest belongs in a new response.
- **Q4:** (a). A ruleset refuses force pushes and deletion of `main`; fast-forward merges work as now. Rory is the bypass on the `live` ruleset, so he can move `live` back.
- **Q5:** (a). A script Rory runs on his PC creates the key pair, adds the public half as a deploy key that can write, stores the private half as the `production` environment's secret with `gh`, and deletes the local copy.

S26-1 and S26-2 are Ready, Sprint 26.

## While building

- **S26-1's fix reproduces the spike locally:** 0.4, 1.8, 3.7 and 5.2 seconds to send at 1 × 500, 4 × 500, 2 × 2,000 and 3 × 2,000 (against 0.8, 3.6, 5.7 and 8.7 before). `record_export` was copied from the database and only its tag lookup changed. The test that the tags learned are as before passed before the change too, so it pins the behaviour rather than the fix.
- **The script makes the rulesets too**, not only the key (Q4 and Q5): Rory still runs it, and the rulesets are then written as code (`scripts/setup-live-key.ts`) rather than as steps to follow in GitHub's settings. It refuses if another deploy key can write, because a ruleset lets every deploy key through.
- **The deploy checks the protection is there before it deploys anything:** the key set, the rules in force on `live` (read from GitHub's API), and the `production` environment deploying from `main` only. Until Rory runs the script, a production run refuses at its first step, with the reason.
- **GitHub's SSH host key** is pinned in the workflow from GitHub's published list, and its fingerprint was checked against the published one.
- **The limit is 2,000 questions a response** (Rory, 9 November). After the fix, staging (runs 42531540549 and 42532333906, rolled back, nothing left) sent 1,500 questions in 2.6 to 2.9 seconds and 2,000 in 3.0 to 4.1 (eight runs at 2,000: five of four files of 500, two of them at 4.02 and 4.06, and three of one file). By Q2's rule that is on the edge of 2,000; Rory chose 2,000, which keeps every spreadsheet the app accepts today (2,000 rows a file) and stays at about half the 8-second limit.
- **Reviews.** QA: two files added at the same moment could deadlock, since Sprint 24's trigger read the response FOR SHARE before the limit's FOR UPDATE (reproduced, then fixed by a migration that renames the limit's trigger to fire first, and tested with two connections); the ready check is now run in the tests in every case where it must refuse, not only read; the push runs in the tests against a local stand-in for GitHub; the rulesets are compared whole; R-18 no longer says the protection is in force before Rory has run the script. Security: a file could declare one question and then hold 3,000 (M1), because nothing stopped questions beyond a file's stated count (the refinement had said otherwise): through the API a question beyond the count is now refused, by a trigger that fires before Sprint 24's; the deploy key's step (M2) installs packages without their install scripts and pushes from a fresh repository with an emptied environment and full paths, tested with a planted hook and injected git configuration, and the rest is recorded in R-18's residual; the reviewer check failed open on an API error (L1, from Sprint 25), now it must be a number; the script removes its key folder on Ctrl+C and says if a key could not be removed (L4); DEPLOYING.md says every write deploy key gets past the ruleset (L2) and what a leaked key could have reached (L6). The production environment's branch policy stays a step in the test pack (L3), done before the script.
- **The browser test for S26-1 9 found an older bug:** the column-mapping step never showed an error from adding the file, so a refused spreadsheet (by the limit, or by the database itself) looked as if nothing had happened. The step now shows it, as the Word-document preview step does.
