# Sprint 19 and 20 review

Build `d95dba3` on sprint-20, local run of 2026-11-02T15:14:02Z. [The CI run](https://github.com/rorymcclelland/RFI-responder/actions/runs/41468889772).

## Sprint 19: Questions for you, and Home

### S19-1 Questions for you

Someone assigned a question answers it on one screen: approve it, send it to the owner, or hand it back with a note. The owner sees their answer on the question and can use it.

| Case | What was checked | Result |
|---|---|---|
| S19 2 | A question for the member: Home lists it, Assignments opens on it, with notes (A question for the member, sent to the owner, and the owner uses their answer) | Passed |
| S19 4 | Hand back with a note, seen on Home and on the question (Hand back, with a note) | Passed |
| S19 5 | Approve; and when the owner decided first, nothing is overwritten (Approve, and when the owner was quicker) | Passed |
| S19 8 | A member who was not assigned does not see the question, and cannot decide it (A member who was not assigned cannot see or decide the question) | Passed |

### S19-2 Open a response at a question

From Home or a question for you, the response opens at that question, in whichever file it is in.

| Case | What was checked | Result |
|---|---|---|
| S19 3 | Send to the owner; the owner opens it from Home and uses their answer (A question for the member, sent to the owner, and the owner uses their answer) | Passed |
| S19 9 | A question in an earlier file opens in that file (src/workspace/openResponse.test.ts (firstView). The demo's Bluefin has one file, so the browser tests open only that one) | Checked in CI |

### S19-3 Home

Everyone lands on Home: what needs them today, their responses, and what the organisation knows, with Ask it a question.

| Case | What was checked | Result |
|---|---|---|
| S19 1 | Home, as an admin: landing page, the For admins line opening Knowledge filtered (Home, as an admin) | Passed |
| S19 6 | At phone width nothing scrolls sideways; the Sent list has no manual stage buttons (On a phone, and the Sent list) | Passed |

### S19-4 Guide, introduction and screenshots

The guide and the introduction describe these screens, with new pictures.

| Case | What was checked | Result |
|---|---|---|
| S19 7 | The screenshots retaken, every view fitting 768 px (the e2e job runs npm run screenshots on the fresh seed, which fails if any view does not fit 768 px) | Checked in CI |

## Sprint 20: Claude as the QA team, and a sprint demo to sign off

### S20-1 Browser acceptance tests in CI

Every agreed case that can be checked in a browser runs on every push, so nothing that passed once breaks unseen.

| Case | What was checked | Result |
|---|---|---|
| S20-1 1 | The suite passes on a fresh local stack, in CI () | Passed |
| S20-1 2 | A failure shows with its screenshot and recording; no retries (playwright.config.ts (retries 0, screenshot on, a recording per session attached by e2e/support.ts)) | Checked in CI |
| S20-1 3 | The suite refuses a non-local address (e2e/target.test.ts (targetProblem and the request guard)) | Checked in CI |
| S20-1 4 | A deliberately broken build fails a test (a throwaway branch with Home's heading changed: all five tests failed (CI run 41464775277, 2 November 2026)) | Checked in CI |
| S20-1 5 | Recordings show only synthetic people and data (Claude looks at the recordings before publishing this page) | By hand |
| S20-1 6 | The main path (sign in, add a response, upload, review, assign, approve, export) as a browser test (not built in Sprint 20: returned to the backlog) | By hand |

### S20-2 A staging site

Each sprint is tried on a hosted copy of the app before it reaches the live demo.

| Case | What was checked | Result |
|---|---|---|
| S20-2 1 | A sprint branch's preview talks to staging, never the live demo (needs the staging project, which Rory sets up) | By hand |
| S20-2 2 | The live demo is untouched by staging runs (scripts/deploy-check.test.ts (stagingProblem refuses the live project) and the staging run's request guard) | Checked in CI |
| S20-2 3 | A staging test user cannot sign in on the live demo (needs the staging project) | By hand |
| S20-2 4 | No secret in the repository, a log, a recording or the bundle (the bundle check, masked passwords in scripts/e2e-staging-users.ts, and the security review) | Checked in CI |
| S20-2 5 | Staging stays awake between sprints (needs a week to pass with staging set up) | By hand |

### S20-3 Automated deploys, with checks

No hand-typed deploy commands; a missing migration or function fails the deploy, and the live demo waits for Rory's approval.

| Case | What was checked | Result |
|---|---|---|
| S20-3 1 | A sprint branch's migration reaches staging with no command typed (needs the staging project) | By hand |
| S20-3 2 | A migration that fails on Supabase stops the deploy, the live demo untouched (needs the staging project) | By hand |
| S20-3 3 | An undeployed function fails the check (scripts/deploy-check.test.ts (a 404 means not deployed)) | Checked in CI |
| S20-3 4 | Merging to main waits for Rory's approval (needs the production environment's required reviewer, which Rory sets) | By hand |
| S20-3 5 | Forks and pull requests cannot deploy (.github/workflows/deploy.yml runs on pushes to this repository only) | Checked in CI |

### S20-4 The sprint demo page

This page: each story with its recordings, and every agreed case with its result.

| Case | What was checked | Result |
|---|---|---|
| S20-4 1 | Every agreed case is listed; one with no check shows in red (scripts/demo-page.test.ts) | Checked in CI |
| S20-4 2 | A failing test shows as failed, with its recording (scripts/demo-page.test.ts) | Checked in CI |
| S20-4 3 | The recordings play and match the build named (Rory, watching this page) | By hand |
| S20-4 4 | The page claims nothing the tests did not check (scripts/demo-page.test.ts (only browser cases take a result from the run)) | Checked in CI |

### S20-5 The process, written down

Decision 0008, the development guide and the sprint skills describe the new way a sprint runs.

