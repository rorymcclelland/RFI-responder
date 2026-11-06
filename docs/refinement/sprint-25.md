# Sprint 25 refinement: the live app only after its database, and the Sprint 24 review's follow-ups

Refined 6 November 2026, as proposed at the Sprint 24 review: F-75 (the app reaches the live demo before its approved database deploy), F-74 (the per-file functions still callable through the API) and F-73 (sending a large response within the hosted database's time limit).

## What refinement found

- **Staging already does it the right way.** Vercel builds staging from a branch called `staging`, which the Deploy workflow moves to the sprint's commit only after the migrations and functions are in (Sprint 20). The live demo is different: Vercel's production branch is `main`, so every push to `main` is built and published at once, whatever the workflow is doing. That is how the Sprint 24 screens met the Sprint 23 database for three hours.
- **Every push to `main` goes live, docs included.** The README commit at the Sprint 24 close was published to the live demo too, and made the deploy check wait for a build that never came (F-76, fixed).
- **The production job can move a branch.** The staging job already pushes `staging` with the workflow's own token; a push made with that token starts no other workflow, so nothing loops.
- **The per-file functions are used widely in the older database tests.** `record_export` and `bulk_accept` appear about 120 times across 14 test files, called as signed-in users. The app stopped calling them in Sprint 24; the demo loaders (`seed.sql`, `demo-hosted.sql`) call them as the database owner, which a revoke does not touch.
- **The time limit has not been measured on the hosted database.** The Sprint 24 security review measured sending locally: 1 second for one file of 500 questions, 9 seconds for four, 73 seconds for three files of 2,000. Supabase's default statement limit for signed-in users is 8 seconds, but what the hosted database takes, and why the time grows faster than the number of questions, are not known. An upload holds at most 2,000 questions a file; a response can have many files.

## Stories

### S25-1 The live app only after its database. M (F-75)

**The job.** What visitors see on the live demo always matches its database: new screens go live only after Rory approves the deploy and the migrations they need are in.

**Before and after.**
- Today: merging to `main` publishes the new app at once; the database follows when Rory approves, minutes or hours later.
- After (Q1 a, Q2 a): pushing to `main` publishes nothing. The production job, after Rory's approval, applies the migrations and functions, then moves a `live` branch to the commit, and Vercel builds the live demo from `live`. The deploy check waits for that build, as it does now.

**What changes.**
- `vercel.json`: `main` no longer deploys (`"main": false` beside `sprint-*`).
- Vercel's production branch becomes `live` (a project setting, Q3).
- `deploy.yml`: the production job gets permission to push, and a step "Move the live branch to this commit" after the migrations and functions, before the check, only when they succeeded.
- `DEPLOYING.md`: the order, and how to roll back (move `live` back to the previous commit, or use Vercel's instant rollback). R-18's residual is closed.
- A CI check that reads the workflow and `vercel.json`: `main` does not deploy, and the step that publishes the live app comes after the migrations and functions and runs only if they succeeded.

**Test cases.**
1. A push to `main` builds no deployment on Vercel (CI check of `vercel.json`; after the first push, Vercel's list of deployments, read with the connector).
2. With the deploy waiting for approval, the live demo still serves the previous commit (by hand: the connector's list of production deployments while the run waits).
3. After approval, the migrations and functions go in first, then `live` moves, then Vercel builds the live demo from `live`, and the check finds the deployed commit served (the run's log).
4. If a migration or function step fails, `live` does not move and the live demo keeps the previous app (CI check of the workflow's order and conditions; the failing migration of Sprint 23 shows the stop).
5. The live demo keeps its production settings and address (its environment variables are the Production environment's, not tied to a branch; checked with the connector before the switch).
6. `DEPLOYING.md` and the risk register say what happens, and how to roll back (CI: the docs tests).

**Out of scope.** Previews of `main`; changing how staging deploys; a rollback button.

**Boundaries.** Decision 0003 and the approval rule: the live demo still changes only after Rory's approval, now for the app as well as the database. Q3 decides who changes the Vercel setting. No new secret.

### S25-2 The per-file functions out of the API. M (F-74)

**The job.** The only way to send or bulk-approve from outside the database is the whole-response function, so the rule "a response is sent as a whole" (Sprint 24, Q3) cannot be got round by calling an older function.

**What changes.** A migration revokes `record_export` and `bulk_accept` from signed-in users and the API (they stay for `record_response_export`, `bulk_accept_response`, and the demo loaders, which run as the database owner). The older database tests move to the whole-response functions, through a small test helper; the client's unused per-file calls are removed.

**Test cases.**
1. A signed-in owner, an admin, a member and an anonymous caller are each refused `record_export` and `bulk_accept` (database, every row of the role matrix).
2. The whole-response functions still work for owner and admin, and still learn, close assignments and write the audit log (database: the Sprint 24 tests unchanged).
3. Every older test that called the per-file functions still proves what it proved, through the whole-response functions (database: the full suite passes; no test deleted).
4. The demo loaders still build the demo (database: the seed and demo-hosted tests; CI's local stack).
5. The app calls neither function (unit: no reference in `src/`).

**Out of scope.** Changing what sending or bulk approval does.

### S25-3 Spike: sending a large response on the hosted database. S, time-boxed to half a day (F-73)

**The question.** Can a response of realistic size be marked as sent on the hosted database within its time limit, and if not, why does the time grow faster than the number of questions?

**What it does.**
- Reads the statement time limit that applies to signed-in users on staging.
- On staging, with synthetic questions loaded by the database owner (no AI, no cost), times marking as sent and bulk approval for one file of 500, four of 500, and two of 2,000.
- Locally, profiles `record_export` on the largest case to find what grows (the suspect is the duplicate lookup against entries added in the same transaction).
- Writes up the answer in `docs/spikes/` with the figures and a recommended fix (none, a cap on questions per response, a faster lookup, or sending in steps), and removes its test data from staging.

**Done when.** The figures and the cause are written down, and a story for the fix, if one is needed, is refined at the spike's close for Sprint 26. It changes no product code.

**Boundaries.** Staging only; synthetic data; read-only on the live demo.

## The sprint as a whole

Order: S25-1 first (it closes the gap Sprint 24 found, and every later deploy depends on it), then S25-2, then the S25-3 spike. About two and a half days. The fix for F-73 depends on the spike, so it is not in this sprint (Sprint 26 at the earliest, refined at the spike's close).

**Hand checks for Rory.** None, beyond approving the first production deploy after S25-1 as usual: the switch is watched with the connector.

## Questions for Rory

- **Q1 How the live app waits for its database.** (a) A `live` branch the production job moves after the migrations, and Vercel's production branch set to `live` (recommended: the same pattern as staging, no new secret, and rolling back is moving the branch back); (b) a Vercel deploy hook the job calls (one new secret, kept by you); (c) the job deploys with the Vercel command line and a Vercel token (a new secret with wide powers).
- **Q2 What a push to `main` builds.** (a) Nothing (recommended: staging already shows each sprint before it merges); (b) a preview, at its own address, which uses the hosting account's daily build allowance.
- **Q3 Who changes Vercel's production branch.** (a) Me, with the Vercel connector, after you approve the exact change at the time (recommended: a public, non-secret setting, as agreed for configuration in Sprint 21); (b) you, from a short list of steps.
- **Q4 The per-file functions.** (a) Revoke them from signed-in users and move the older tests to the whole-response functions (recommended: the rule is enforced, not just followed by the app); (b) leave them callable and record the residual.
- **Q5 Sending a large response.** (a) A half-day spike on staging first, and the fix refined at its close for Sprint 26 (recommended: the hosted figures may make a fix unnecessary, or show which one); (b) cap a response at a fixed number of questions now, without measuring.

## Rory's answers (6 November 2026)

- **Q1:** (a). A `live` branch the production job moves after the migrations; Vercel's production branch set to `live`.
- **Q2:** (a). A push to `main` builds nothing on Vercel.
- **Q3:** (a). Claude changes Vercel's production branch with the connector, after Rory approves the exact change at the time.
- **Q4:** (a). The per-file functions are revoked from signed-in users; the older tests move to the whole-response functions.
- **Q5:** (a). A half-day spike on staging first; the fix, if needed, is refined at its close for Sprint 26.

S25-1 and S25-2 are Ready, Sprint 25. S25-3 is a spike, Ready, Sprint 25; the F-73 fix it informs is Planned, Sprint 26 (refined at the spike's close).

## While building

- **Vercel's production branch cannot be changed with the connector** (Q3): no Vercel tool here sets it, so it falls back to (b), a dashboard step for Rory. The branch `live` was made first at the commit the live demo already served (`b5a41bd`), so the switch changes nothing for visitors. Case 5: the live demo's two variables are on Production with no branch attached (checked with the connector).
- **The older tests called the per-file functions 76 times in 12 files** (refinement's "about 120 in 14" counted lines). Each now calls the whole-response function for the file's response, found by a lookup the test harness adds to the test database only (`test_only.response_of`, never in a migration); the results are read under the same names, so no assertion changed except as below. No test was deleted.
- **A file with no response can no longer be bulk-approved or sent by anyone through the API**, an admin included (before, an admin could). The app always makes a file in a response, and the live demo has none without one (read-only check, 6 November). Its questions are still decided one by one. The test that proved the admin could now proves both are refused.
- **Sending again with nothing changed is refused** (Sprint 24), so the older test "recording the same export twice does not learn twice" now checks that refusal, then marks the file changed without changing an answer and sends it again: nothing is learned twice.
- **The client's per-file calls are removed** (`bulkAcceptInDb`, `recordExport`); their unit tests now cover the whole-response calls the app uses, with the same wording checks.
- **CI and staging on the first push found two problems, neither from this sprint's changes.** After **Mark as sent**, the page collapsed the question list only after indexing the new entries, so a list opened again in the meantime closed (fixed: it collapses as the page first shows the response as sent). On staging, the Try-it test checked the response header within 30 seconds, though the header appears only when drafting ends, which took longer with the real AI (the check now follows the 240-second drafting wait).
- **S25-3 found** sending passes the 8-second limit on staging between 2,000 and 4,000 questions, and the cause is not the suspected duplicate lookup but a recount of the file after every question's update and a tag lookup that scans the knowledge base ([`docs/spikes/f73-sending-large-responses.md`](../spikes/f73-sending-large-responses.md)). The fix is to be refined for Sprint 26.
