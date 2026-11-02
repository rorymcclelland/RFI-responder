# Sprint 20 refinement: Claude as the QA team, and a sprint demo to sign off

Refined 2 November 2026, at Rory's request: "reduce the time I spend testing the sprints without affecting quality", working as in his previous jobs, where a QA team tested and then demonstrated the working functionality at the end of the sprint for him to sign off the business value. Option B's remaining stories (U-6, U-8, K-4) move to Sprint 21.

## What refinement found

- **Rory's hand testing takes 40 to 60 minutes a sprint**, and each test pack is run once. Nothing re-checks Sprint 17's or 18's flows when Sprint 19 changes the screens around them.
- **Both of Sprint 18's live failures were deployment slips**, not code faults: a migration that used a bare `vector` type and failed only on the hosted push, and `ask-knowledge` not deployed. Today deploying is three hand-typed commands on Rory's PC, and a pasted command once ran two together (`process-questionsnpx`).
- **Most of the pieces exist.**
  - CI already starts the real Supabase stack (`supabase start`, `supabase db reset`), with sign-in, the access rules and the Edge Functions, and drives the functions with every AI provider failing, which is deterministic.
  - `scripts/screenshots.ts` already signs in as the seed users with Playwright and walks the screens, with a local-only guard (`scripts/local-only.ts`).
  - Vercel builds every branch as a preview; `npm run build:hosted` refuses a build that points anywhere but a hosted Supabase project.
  - `keepalive.yml` already keeps a Free project awake.
- **A staging project now fits the Free plan.** The organisation has two active projects today, `campaign-studio` and `rfi-respond-demo`. Campaign Studio has moved to Neon and its Supabase project is kept only as a rollback; once Rory pauses it, a slot is free.
- **Claude must not type passwords into a hosted site.** So the hosted checks are code that CI runs, with credentials held as GitHub secrets that Claude never sees; Claude reads the results.
- **The repository is public**, so CI recordings are visible to anyone signed in to GitHub. The data is synthetic, so that is acceptable, but no recording may show a secret, a key or a real address.

## The new way a sprint runs (after this sprint)

1. **Refinement**, unchanged: Rory agrees the test cases.
2. **Build**: Claude writes the agreed cases as browser tests first, then the code.
3. **QA**: a separate QA agent, which did not build the code, checks the tests against the agreed cases and adds edge cases. The security review stays.
4. **Staging**: the sprint branch deploys to staging by itself; the browser tests run there and record each story.
5. **Sprint review**: Claude publishes a demo page (each story: what changed for the user, the recording, every agreed case with pass or fail, known limits). Rory watches it, signs off or raises points.
6. **Release**: merging to `main` deploys to the live demo after Rory approves it in GitHub (Q1), then Claude checks it is live. Rory's hands-on time is a short look at the live demo, and deeper hand tests only for stories flagged high risk at refinement.

## Stories

### S20-1 Browser acceptance tests on the real local stack, in CI. M

**The job.** Every agreed test case that can be checked in a browser is a test that runs on every push, so nothing that passed once breaks unseen later.

**What changes.**
- `@playwright/test` with a config and an `e2e/` folder. Fixtures sign in as the seed users (Sarah admin, Priya owner, James member, and so on), reusing the local-only guard, so the suite refuses any non-local address.
- A CI job `e2e`: start the Supabase stack (with the functions served, providers failing as today), build and serve the app, run the suite, keep the report, screenshots and recordings as a CI artefact for 14 days.
- Each test names the case it checks (`S19-1 case 4`), so the demo page (S20-4) can map results to the agreed cases.
- **First content:** Sprint 19's test pack (cases 1 to 6), the guide's screenshots (`npm run screenshots`, Q4), and the main path from F-1 (sign in, add a response, upload questions, review, assign, approve, export).

**Test cases.**
1. A fresh clone with Docker runs `npm run test:e2e` and every test passes; the same in CI.
2. A test that fails shows in CI as a failure with its screenshot and recording; there are no automatic retries hiding flakiness (Q4).
3. The suite refuses to start when the app or Supabase address is not local (as `screenshots.ts` does).
4. A deliberately broken build (Home's heading removed) fails the S19-3 test.
5. Recordings show only seed users and synthetic data.

**Out of scope.** Visual comparison of screenshots (pixel diffs); load testing.

### S20-2 A staging site. M

**The job.** A hosted copy of the app, the same set-up as the live demo, where each sprint is tried before it reaches the live demo.

**What changes.**
- **Rory, once** (account changes are his): pause `campaign-studio`; create a Supabase project `rfi-respond-staging` (London, Free); in Vercel, give Preview deployments the staging project's address and anon key; add the GitHub secrets listed in `docs/DEPLOYING.md` (access token, staging and live project refs and database passwords, staging service-role key, Vercel's protection-bypass secret for previews). Claude writes the step-by-step list; Rory never pastes a value in chat.
- **Test users on staging:** CI creates them with the admin API and `@example.com` addresses (no email is sent), each with a random password made for that run and never written down, then signs in as them. They are reset each run. Demo data comes from `reset_demo`, as on the live demo.
- `keepalive.yml` pings staging as well.
- `docs/DEPLOYING.md`: staging, what lives where, and how to rebuild it.

**Test cases.**
1. A Vercel preview of a sprint branch talks to staging, never to the live project (checked by the preview build and by a test that reads the address the page uses).
2. Live demo data and users are untouched by any staging run.
3. A staging test user cannot sign in on the live demo.
4. No secret appears in the repository, a log line, a recording or the browser bundle (the bundle check exists; a log scan is added).
5. Staging is still awake after a week without a sprint.

**Out of scope.** A staging copy of the live demo's real accounts; Japanese-language staging data beyond the seed.

### S20-3 Automated deploys, with checks. M

**The job.** No hand-typed deploy commands, and a deploy that misses a migration or a function is caught before Rory sees it.

**What changes.**
- A `deploy.yml` workflow:
  - **push to a `sprint-*` branch:** `supabase db push` and `supabase functions deploy` (every function) to staging;
  - **push to `main`:** the same to the live demo, in a GitHub environment `production` that waits for Rory's approval (Q1).
- **After each deploy, checks:** every migration in the repository is applied (compared with `supabase_migrations.schema_migrations`); every function in `supabase/functions` answers (an unsigned call gets 401, not 404); the app loads; the Supabase advisors show nothing new beyond the accepted list.
- A failed deploy or check fails the workflow and says which step.

**Test cases.**
1. A new migration on a sprint branch reaches staging without anyone typing a command.
2. A migration that fails on Supabase (the Sprint 18 bare-type case, tried on staging) stops the workflow with Supabase's message, and the live demo is untouched.
3. A function left undeployed (simulated by renaming one on staging) makes the check fail: "ask-knowledge is not deployed".
4. Merging to `main` waits for approval; nothing reaches the live demo until Rory approves.
5. A workflow run from a fork or a pull request cannot deploy (no secrets, no environment).

**Out of scope.** Rolling back a migration automatically; Vercel stays as it is (it deploys `main` itself).

### S20-4 The acceptance run on staging, and the sprint demo page. M

**The job.** At the end of each sprint Rory gets a demonstration of the working functionality, with evidence, to sign off the business value.

**What changes.**
- After a staging deploy, CI runs the sprint's tagged tests against the staging preview, recording each one with on-screen captions ("Priya hands the question back with a note"), so a recording explains itself without sound.
- `scripts/demo-page.ts` builds one page from the results: for each story, what changed for the user (from the refinement), its recordings, every agreed case with pass, fail or "checked by hand" (and why), known limits, and the build it ran on. Claude downloads the CI results and publishes the page as a private Claude artifact for Rory, and keeps the Markdown summary in `docs/testing/sprint-N-demo.md`.
- A case that cannot be automated is listed, with why, and either stays in a short hand-check list or is checked by Claude another way (the database tests, for example).

**Test cases.**
1. The page lists every agreed case of the sprint; none silently missing (a case with no test is shown as "not automated", in red).
2. A failing test shows as failed on the page, with its recording, even if a re-run passed.
3. The recordings play in the page and match the build named on it.
4. The page claims nothing the tests did not check (rule 1): the AI's answers are canned unless Q2 says otherwise, and the page says so.

**Out of scope.** Narration with a voice; a live walk-through.

### S20-5 The new process, written down. S

**What changes.** Decision `0008-claude-as-qa.md`; `CLAUDE.md` and `docs/BACKLOG.md` (how a sprint runs); the sprint-close and sprint-refine skills updated to the new flow (proposed to Rory as skill updates, since the skills are his); the test-pack preference kept for any hand checks that remain.

**Test cases.** The docs tests pass; the skills, when Rory accepts them, describe the demo page instead of the full test pack.

## The sprint as a whole

Order: S20-1, then S20-2 (needs Rory's set-up, which can happen while S20-1 is built), S20-3, S20-4, S20-5. About four to five days of build. Nothing here waits on a spike: the unknowns (Vercel preview protection with CI, recording on a CI runner) are small and are tried first in S20-1 and S20-2.

**Risks.**
- **A deploy workflow can break the live demo.** Staging first, the approval gate, and the post-deploy checks.
- **Browser tests become flaky and are ignored.** No hidden retries; the QA agent's job includes keeping them stable; a flaky test is fixed or removed in the same sprint, never left.
- **Secrets in a public repository's CI.** Secrets only in GitHub, never echoed; forks get none; the log scan in S20-2.
- **The tests check what we thought of.** That is why the demo stays a human review: Rory judges whether it is the right thing, not only whether it works.

**Boundaries.** Synthetic data only. No key in the browser (unchanged). Claude never sees or types a password; hosted sign-in happens only in CI code with secrets. Migrations still insert configuration only; staging users and data come from scripts and `reset_demo`. Rule 1 on the demo page.

## Questions for Rory

- **Q1 Release to the live demo.** (a) Automatic to staging, then to the live demo only after you approve it in GitHub (recommended); (b) fully automatic on merge; (c) keep typing the commands yourself.
- **Q2 AI in the tests.** (a) Providers off in CI (deterministic), and on staging one capped real-AI moment per sprint for the demo (recommended; pence); (b) providers off everywhere; (c) real AI throughout.
- **Q3 Sign-off format.** (a) A demo page per sprint: per story, captioned recordings and every agreed case with its result (recommended); (b) one continuous captioned video of the sprint; (c) both.
- **Q4 Finishing Sprint 19.** The Sprint 19 migration is already on the live demo. (a) Finish the Sprint 19 pack yourself as planned, so Sprint 19 closes now (recommended); (b) hold Sprint 19 open and sign it off from Sprint 20's first demo instead.

## Rory's answers (2 November 2026)

- **Q1:** (a) agreed. Staging by itself; the live demo after his approval in GitHub.
- **Q2:** (a) agreed. Providers off in CI; one capped real-AI step on staging per sprint, and the demo page says which step used the real model.
- **Q3:** (a) agreed. A demo page per sprint.
- **Q4:** (b). Sprint 19 stays open and is signed off from Sprint 20's first demo. So:
  - S20-1's first content is Sprint 19's six cases, and the first demo page has a Sprint 19 section;
  - the Sprint 19 screenshots (S19-4: `21-home.png`, the new `5-assignments.png`) are taken by the `e2e` CI job with `npm run screenshots` on the local stack, instead of on Rory's PC; Claude commits them. The "Ask it a question" picture shows the fallback answer, since providers are off in CI, and the guide says so;
  - Sprint 19 and Sprint 20 close together.

## Build (2 November 2026)

**What was built.**
- **S20-1:** `e2e/` with Playwright: six tests for Sprint 19's agreed cases, captions in every recording, one recording per person, run in CI (job `e2e`) on the real Supabase stack with the seed and the AI providers off, after the guide's screenshots. The workspace Claude builds in cannot pull Supabase's containers, so the suite was developed against CI.
- **S20-2:** `scripts/e2e-staging-users.ts` (test people with a password made for each run, a demo reset, and afterwards a sign-out everywhere and a new unknown password), the keep-awake ping for staging, and `docs/DEPLOYING.md`, "Staging and automated deploys", with Rory's one-off steps.
- **S20-3:** `.github/workflows/deploy.yml` (staging on `sprint-*`, the live demo on `main` in the `production` environment) and `scripts/deploy-check.ts` (migrations, functions, the app serving this commit, the security advisor). Each job skips, saying so, until the settings exist; both skipped as designed on every push this sprint.
- **S20-4:** `scripts/demo-page.ts` and `e2e/cases.ts`. CI's artefact storage cannot be reached from Claude's workspace, so each run's results are pushed to their own branch, `e2e-results/<target>/<branch>`, and fetched with git.
- **S20-5:** decision 0008, `CLAUDE.md`, the development guide.

**Found by the new tests.**
- **BUG-43:** at phone width the menu's dark overlay sat above the menu itself, so no menu item could be tapped. Present since the prototype; fixed (the overlay now sits below the header) and covered by the phone test.
- The phone menu button and the notice's close button had no accessible name; both have one now.
- The screenshot run reported a view that did not fit 768 px but still passed; it now fails.

**Test case 4 of S20-1.** A throwaway branch with Home's heading changed: all five tests failed (CI run 41464775277). The branch was deleted.

**Reviews.**

| Finding | Severity | Fixed |
|---|---|---|
| H1 A failed staging test's trace (and the HTML report) would publish the run's password and Vercel's bypass secret to a public branch | High | No traces or report on staging; only recordings, screenshots and results are published, after a search for both secrets; the test people are signed out everywhere after each run |
| H2 A Supabase access token can manage every project, so the staging job could reach the live demo without approval | High | Environment secrets only, given only to the CLI steps; the remaining gap is stated in DEPLOYING.md and R-06 (closing it needs a separate Supabase account for staging) |
| M3 "After Rory's approval" said more than the code did: Vercel publishes `main` at once, and an environment with no reviewer does not wait | Medium | The job refuses to run unless `production` requires a reviewer; DEPLOYING.md states what is and is not behind the approval |
| M4 Staging runs from two branches could overlap | Medium | One staging run at a time across branches |
| L5 The deploy check could pass against the previous build | Low | The page names its commit (`app-version`), and the check waits for it |
| L6 The demo page could copy any file a crafted report pointed at | Low | Only `.webm` files inside the results folder |
| L7 Results branches would start Vercel builds; `build.json` was written unescaped | Low | `vercel.json` skips `e2e-results/*`; written by node |
| QA: weak checks (assigning, Decided, the stale answer, the Sent list, stacking), order dependence, two cases naming checks that did not exist | | Each fixed; each test assigns its own question; a test that a member not assigned cannot see or decide the question added |

**Returned to the backlog.** The main path from F-1 as a browser test (S20-1's "first content"): not built. Listed as case S20-1 6 so the demo page shows it.

**Staging set up and running (2 November 2026, evening).** Rory did the one-off set-up with Claude talking him through it. Along the way:
- Supabase now offers access tokens limited to one project and named permissions, so each GitHub environment has its own token for its own project; this closes H2 rather than leaving it as a stated gap.
- Those tokens cannot read API keys, which `supabase link` needs, so the deploy no longer links: it pushes migrations over the session pooler with the database password and deploys functions by project ref (`scripts/supabase-deploy.sh`).
- The hosted build's guard caught the service-role key pasted as the anon key in Vercel; Rory replaced the key and corrected the value.
- Staging loads its own demo data when it has none (staging only).
- The first full staging run found **BUG-44**: opening an asked question saved "Working on it" and then rebuilt the question panel, so on staging, where the save takes longer, a note the person had started typing vanished. Fixed: the stage updates in place, and the panel is rebuilt only after the person's own action.
- Then both runs passed on build `ee613fb`: five tests on staging (the sixth needs a third person and is skipped there by design) and six on CI's local stack. The demo page combines them.

**Also returned to the backlog.** The one real-AI step per staging run (Q2): no test asks a question on staging yet. Listed as case S20-4 5.

**Agreed alongside the sprint (Rory, 2 November 2026).** Configuration is Claude's work as code, credentials and the production approval stay with Rory (backlog O-1); and one working agreement for all of Rory's build projects, kept as the `build-working-agreement` skill, which `CLAUDE.md` points to.

## Review and close (2 November 2026)

All five stories done; Rory signed off from the demo page (14 cases passed in the browser on CI and staging, 15 checked by other named checks, 6 by hand with the reason). The first deploy through the approval gate followed: approved by Rory, checked by the workflow (67 migrations, the app serving `ba97edf`, no advisor error). Returned to the backlog: F-66 (the main path as a browser test) and F-67 (the real-AI step on staging); new: F-68 (a failing migration not yet tried on staging). Proposed next: Sprint 21, O-1, U-6 and K-4 with F-67.
