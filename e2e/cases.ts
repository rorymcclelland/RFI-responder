/**
 * Sprint 20 (S20-4): the agreed cases of each sprint, as refined with Rory, and how each is checked.
 * The demo page (scripts/demo-page.ts) lists every one: a browser test's result comes from the run;
 * anything else is shown with how it was checked, never as passed by this run. A case with no test
 * and no other check is shown as not checked, in red.
 */
export type How =
  | { kind: 'browser' }
  /** Passes when every browser test in the run passed. */
  | { kind: 'suite' }
  /** Checked in CI by other tests (unit, database or the Supabase job), named in `by`. */
  | { kind: 'ci'; by: string }
  /** Needs a person, or a set-up that does not exist yet; `why` says which. */
  | { kind: 'hand'; why: string };

export interface Case { id: string; story: string; title: string; how: How }
export interface Story { id: string; title: string; forTheUser: string }
export interface SprintCases { sprint: number; title: string; stories: Story[]; cases: Case[] }

const browser: How = { kind: 'browser' };

export const SPRINTS: SprintCases[] = [
  {
    sprint: 19,
    title: 'Questions for you, and Home',
    stories: [
      { id: 'S19-1', title: 'Questions for you', forTheUser: 'Someone assigned a question answers it on one screen: approve it, send it to the owner, or hand it back with a note. The owner sees their answer on the question and can use it.' },
      { id: 'S19-2', title: 'Open a response at a question', forTheUser: 'From Home or a question for you, the response opens at that question, in whichever file it is in.' },
      { id: 'S19-3', title: 'Home', forTheUser: 'Everyone lands on Home: what needs them today, their responses, and what the organisation knows, with Ask it a question.' },
      { id: 'S19-4', title: 'Guide, introduction and screenshots', forTheUser: 'The guide and the introduction describe these screens, with new pictures.' },
    ],
    cases: [
      { id: 'S19 1', story: 'S19-3', title: 'Home, as an admin: landing page, the For admins line opening Knowledge filtered', how: browser },
      { id: 'S19 2', story: 'S19-1', title: 'A question for the member: Home lists it, Assignments opens on it, with notes', how: browser },
      { id: 'S19 3', story: 'S19-2', title: 'Send to the owner; the owner opens it from Home and uses their answer', how: browser },
      { id: 'S19 4', story: 'S19-1', title: 'Hand back with a note, seen on Home and on the question', how: browser },
      { id: 'S19 5', story: 'S19-1', title: 'Approve; and when the owner decided first, nothing is overwritten', how: browser },
      { id: 'S19 6', story: 'S19-3', title: 'At phone width nothing scrolls sideways; the Sent list has no manual stage buttons', how: browser },
      { id: 'S19 7', story: 'S19-4', title: 'The screenshots retaken, every view fitting 768 px', how: { kind: 'ci', by: 'the e2e job runs npm run screenshots on the fresh seed, which fails if any view does not fit 768 px' } },
      { id: 'S19 8', story: 'S19-1', title: 'A member who was not assigned does not see the question, and cannot decide it', how: browser },
      { id: 'S19 9', story: 'S19-2', title: 'A question in an earlier file opens in that file', how: { kind: 'ci', by: 'src/workspace/openResponse.test.ts (firstView). The demo\'s Bluefin has one file, so the browser tests open only that one' } },
    ],
  },
  {
    sprint: 20,
    title: 'Claude as the QA team, and a sprint demo to sign off',
    stories: [
      { id: 'S20-1', title: 'Browser acceptance tests in CI', forTheUser: 'Every agreed case that can be checked in a browser runs on every push, so nothing that passed once breaks unseen.' },
      { id: 'S20-2', title: 'A staging site', forTheUser: 'Each sprint is tried on a hosted copy of the app before it reaches the live demo.' },
      { id: 'S20-3', title: 'Automated deploys, with checks', forTheUser: 'No hand-typed deploy commands; a missing migration or function fails the deploy, and the live demo waits for Rory\'s approval.' },
      { id: 'S20-4', title: 'The sprint demo page', forTheUser: 'This page: each story with its recordings, and every agreed case with its result.' },
      { id: 'S20-5', title: 'The process, written down', forTheUser: 'Decision 0008, the development guide and the sprint skills describe the new way a sprint runs.' },
    ],
    cases: [
      { id: 'S20-1 1', story: 'S20-1', title: 'The suite passes on a fresh local stack, in CI', how: { kind: 'suite' } },
      { id: 'S20-1 2', story: 'S20-1', title: 'A failure shows with its screenshot and recording; no retries', how: { kind: 'ci', by: 'playwright.config.ts (retries 0, screenshot on, a recording per session attached by e2e/support.ts)' } },
      { id: 'S20-1 3', story: 'S20-1', title: 'The suite refuses a non-local address', how: { kind: 'ci', by: 'e2e/target.test.ts (targetProblem and the request guard)' } },
      { id: 'S20-1 4', story: 'S20-1', title: 'A deliberately broken build fails a test', how: { kind: 'ci', by: 'a throwaway branch with Home\'s heading changed: all five tests failed (CI run 41464775277, 2 November 2026)' } },
      { id: 'S20-1 5', story: 'S20-1', title: 'Recordings show only synthetic people and data', how: { kind: 'hand', why: 'Claude looks at the recordings before publishing this page' } },
      { id: 'S20-1 6', story: 'S20-1', title: 'The main path (sign in, add a response, upload, review, assign, approve, export) as a browser test', how: { kind: 'hand', why: 'not built in Sprint 20: returned to the backlog' } },
      { id: 'S20-2 1', story: 'S20-2', title: 'The staging site talks to staging, never the live demo', how: { kind: 'ci', by: 'the staging run: the browser tests signed in as people who exist only on staging, with every request to the live demo\'s hosts refused by the browser' } },
      { id: 'S20-2 2', story: 'S20-2', title: 'The live demo is untouched by staging runs', how: { kind: 'ci', by: 'scripts/deploy-check.test.ts (stagingProblem refuses the live project) and the staging run\'s request guard' } },
      { id: 'S20-2 3', story: 'S20-2', title: 'A staging test user cannot sign in on the live demo', how: { kind: 'hand', why: 'not tested: the test people exist only in staging\'s database, and their password changes after every run' } },
      { id: 'S20-2 4', story: 'S20-2', title: 'No secret in the repository, a log, a recording or the bundle', how: { kind: 'ci', by: 'the bundle check, masked passwords in scripts/e2e-staging-users.ts, and the security review' } },
      { id: 'S20-2 5', story: 'S20-2', title: 'Staging stays awake between sprints', how: { kind: 'hand', why: 'needs a week to pass with staging set up' } },
      { id: 'S20-3 1', story: 'S20-3', title: 'A sprint branch\'s migrations reach staging with no command typed', how: { kind: 'ci', by: 'the staging runs of 2 November 2026: all 67 migrations applied by the workflow, and the deploy check confirmed them' } },
      { id: 'S20-3 2', story: 'S20-3', title: 'A failed deploy step stops the run before anything later, the live demo untouched', how: { kind: 'ci', by: 'the staging runs of 2 November 2026: a refused access token and a failed build each stopped the run at that step; a failing migration itself was not tried' } },
      { id: 'S20-3 3', story: 'S20-3', title: 'An undeployed function fails the check', how: { kind: 'ci', by: 'scripts/deploy-check.test.ts (a 404 means not deployed)' } },
      { id: 'S20-3 4', story: 'S20-3', title: 'Merging to main waits for Rory\'s approval', how: { kind: 'hand', why: 'needs the production environment\'s required reviewer, which Rory sets' } },
      { id: 'S20-3 5', story: 'S20-3', title: 'Forks and pull requests cannot deploy', how: { kind: 'ci', by: '.github/workflows/deploy.yml runs on pushes to this repository only' } },
      { id: 'S20-4 1', story: 'S20-4', title: 'Every agreed case is listed; one with no check shows in red', how: { kind: 'ci', by: 'scripts/demo-page.test.ts' } },
      { id: 'S20-4 2', story: 'S20-4', title: 'A failing test shows as failed, with its recording', how: { kind: 'ci', by: 'scripts/demo-page.test.ts' } },
      { id: 'S20-4 3', story: 'S20-4', title: 'The recordings play and match the build named', how: { kind: 'hand', why: 'Rory, watching this page' } },
      { id: 'S20-4 4', story: 'S20-4', title: 'The page claims nothing the tests did not check', how: { kind: 'ci', by: 'scripts/demo-page.test.ts (only browser cases take a result from the run)' } },
      { id: 'S20-4 5', story: 'S20-4', title: 'One step per staging run uses the real AI model (Q2)', how: { kind: 'hand', why: 'not built in Sprint 20: returned to the backlog as F-67, built in Sprint 21 (S21-4)' } },
    ],
  },
  {
    sprint: 21,
    title: 'Sending made plain, gaps, and configuration as code',
    stories: [
      { id: 'S21-1', title: 'Download separate from Mark as sent', forTheUser: 'An owner downloads the answers once every question is decided, and marks the response as sent separately; Mark as sent says beforehand what it will do. The stages read Sent and Changed since sent.' },
      { id: 'S21-2', title: 'Gaps', forTheUser: 'Knowledge shows what the knowledge base could not answer in recent responses, grouped by wording, with where each stands.' },
      { id: 'S21-3', title: 'Configuration as code, checked; a set-up script', forTheUser: 'Every deploy checks the hosted sign-in settings against the repository; a script stores the keys in GitHub without anyone copying them.' },
      { id: 'S21-4', title: 'One real-AI step on staging', forTheUser: 'Each staging run asks one question with the real models, proving the whole pipeline end to end.' },
    ],
    cases: [
      { id: 'S21-1 1', story: 'S21-1', title: 'With questions still to do: no Download, no Mark as sent, and the reason', how: browser },
      { id: 'S21-1 2', story: 'S21-1', title: 'Download works without marking anything as sent (Q1)', how: browser },
      { id: 'S21-1 3', story: 'S21-1', title: 'Mark as sent says what will happen, with counts; Cancel changes nothing', how: browser },
      { id: 'S21-1 4', story: 'S21-1', title: 'Confirming marks it Sent, records who and when, closes the assignment, says what was learned', how: browser },
      { id: 'S21-1 5', story: 'S21-1', title: 'A change after sending shows Changed since sent; Mark as sent again records it', how: browser },
      { id: 'S21-1 6', story: 'S21-1', title: 'No visible text says Exported, Record export or export recorded (Q2)', how: { kind: 'ci', by: 'docs/glossary.test.ts' } },
      { id: 'S21-1 7', story: 'S21-1', title: 'A member who does not own the response sees neither button', how: browser },
      { id: 'S21-2 1', story: 'S21-2', title: 'A question from the last 90 days is listed; one from 91 days ago, archived or not, is not', how: { kind: 'ci', by: 'supabase/tests/db/sprint21.test.ts' } },
      { id: 'S21-2 2', story: 'S21-2', title: 'Pricing questions are never listed', how: { kind: 'ci', by: 'supabase/tests/db/sprint21.test.ts' } },
      { id: 'S21-2 3', story: 'S21-2', title: 'The same wording but for case, spaces and punctuation forms one group, asked in 2 responses', how: { kind: 'ci', by: 'supabase/tests/db/sprint21.test.ts' } },
      { id: 'S21-2 4', story: 'S21-2', title: 'Each state, in the database and as the page shows it', how: browser },
      { id: 'S21-2 5', story: 'S21-2', title: 'Open it in the response opens the response at that question', how: browser },
      { id: 'S21-2 6', story: 'S21-2', title: 'Every member sees the same gaps; a signed-out caller is refused', how: { kind: 'ci', by: 'supabase/tests/db/sprint21.test.ts' } },
      { id: 'S21-2 7', story: 'S21-2', title: 'A question containing markup shows as text', how: browser },
      { id: 'S21-2 8', story: 'S21-2', title: 'With 5,000 questions the function answers in under a second', how: { kind: 'ci', by: 'supabase/tests/db/sprint21.test.ts' } },
      { id: 'S21-3 1', story: 'S21-3', title: 'The sign-in settings check passes on staging and the live demo as they are', how: { kind: 'ci', by: 'the Deploy workflow, step "Sign-in settings match the repository": passed on staging on 3 November 2026 (run 41660351743); on the live demo it runs before the first approved deploy' } },
      { id: 'S21-3 2', story: 'S21-3', title: 'A setting that differs fails the deploy and names it; put right, it passes', how: { kind: 'hand', why: 'seen on 3 November 2026 with a real difference rather than a test one: staging had no redirect address; the check failed naming it, Rory added it, and the next run passed. Sign-ups were not turned on for a test (the same rule, also a unit test)' } },
      { id: 'S21-3 3', story: 'S21-3', title: 'The script\'s dry run lists the secrets it would set, by name only', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-3 4', story: 'S21-3', title: 'The script refuses a key of the wrong kind, and the live demo\'s project for staging', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-3 5', story: 'S21-3', title: 'Nothing the script or the check prints contains a key', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-4 1', story: 'S21-4', title: 'On staging: a calibrated confidence, the checker\'s verdict and a cited entry', how: browser },
      { id: 'S21-4 2', story: 'S21-4', title: 'Locally: the fallback answer, not calibrated', how: browser },
      { id: 'S21-4 3', story: 'S21-4', title: 'The ask is recorded under the admin\'s usage, and the daily cap applies', how: { kind: 'hand', why: 'not built in Sprint 21: the staging run did not read the usage line on Governance (QA review); returned as F-69 and built in Sprint 22 (S22-3)' } },
    ],
  },
  {
    sprint: 22,
    title: 'The response as a journey, plain settings, and the ask\'s usage on staging',
    stories: [
      { id: 'S22-1', title: 'The response as a journey, first slice', forTheUser: 'An owner opens a response and sees where it stands and what needs them: a header like its card on Responses, the questions grouped as Needs a person (each with one reason) and Ready to approve, what colleagues are doing under With experts, and Send.' },
      { id: 'S22-2', title: 'Plain settings, spend by use, and the audit log by person and response', forTheUser: 'An admin finds the settings they change most often first, sees what the money was spent on in plain words, and finds what one person did, or what happened to one response, in the audit log.' },
      { id: 'S22-3', title: 'The ask\'s usage on staging', forTheUser: 'Each staging run proves that its real-AI question is recorded as spend the admin can see.' },
    ],
    cases: [
      { id: 'S22-1 1', story: 'S22-1', title: 'The header shows the name, owner, due date, progress and stage, as the response\'s card on Responses does', how: browser },
      { id: 'S22-1 2', story: 'S22-1', title: 'Every question is in exactly one group, and the groups add up to the header\'s count', how: browser },
      { id: 'S22-1 3', story: 'S22-1', title: 'Ready to approve exactly when bulk approval could take it; each question that needs a person shows one reason, first', how: browser },
      { id: 'S22-1 4', story: 'S22-1', title: 'Bulk approval takes only Ready to approve, and the groups update', how: browser },
      { id: 'S22-1 5', story: 'S22-1', title: 'With experts lists every assigned question with the colleague and the stage word; choosing one opens it; the banner is gone', how: browser },
      { id: 'S22-1 6', story: 'S22-1', title: 'Send works as in Sprint 21 on the new layout', how: { kind: 'ci', by: 'the Sprint 21 browser tests (S21-1 1 to 7), run on the new layout in every build' } },
      { id: 'S22-1 7', story: 'S22-1', title: 'A response with two files lists both in the header; choosing the other opens it', how: browser },
      { id: 'S22-1 8', story: 'S22-1', title: 'A member who does not own the response sees the header, groups and reasons, and no approval, assignment or send control', how: browser },
      { id: 'S22-1 9', story: 'S22-1', title: 'At phone width the header, the stages and the groups fit', how: browser },
      { id: 'S22-1 10', story: 'S22-1', title: 'An archived response shows the same page, read-only', how: browser },
      { id: 'S22-1 11', story: 'S22-1', title: 'A question or file name containing markup shows as text', how: browser },
      { id: 'S22-1 12', story: 'S22-1', title: 'The glossary has the new words; the guide describes the page as it is; the screenshots are retaken', how: { kind: 'ci', by: 'docs/glossary.test.ts (the new words) and docs/guide.test.ts; the screenshots retaken by the CI screenshot run of c2ae75c and committed' } },
      { id: 'S22-2 1', story: 'S22-2', title: 'The everyday settings first; Advanced, closed until opened, holds the reserves, exchange rate, prices and spend by model; saving from either works and is audited', how: browser },
      { id: 'S22-2 2', story: 'S22-2', title: 'Spend by use: each function has its plain name, an unknown one its own, and the uses add up to the month\'s total', how: { kind: 'ci', by: 'src/lib/usage.test.ts and supabase/tests/db/sprint22.test.ts' } },
      { id: 'S22-2 3', story: 'S22-2', title: 'The person filter shows only what that person did, including someone whose profile was deleted since', how: browser },
      { id: 'S22-2 4', story: 'S22-2', title: 'The response filter shows the response\'s own rows, its files\' and its questions\', and nothing else', how: browser },
      { id: 'S22-2 5', story: 'S22-2', title: 'The filters combine with the kind; at most 200, newest first, with a line when more match', how: browser },
      { id: 'S22-2 6', story: 'S22-2', title: 'A member and a signed-out caller get nothing; an admin gets the rows', how: { kind: 'ci', by: 'supabase/tests/db/sprint22.test.ts' } },
      { id: 'S22-2 7', story: 'S22-2', title: 'Names containing markup show as text in the filters and the rows', how: browser },
      { id: 'S22-2 8', story: 'S22-2', title: 'With 50,000 audit rows the filtered read answers in under a second', how: { kind: 'ci', by: 'supabase/tests/db/sprint22.test.ts' } },
      { id: 'S22-3 1', story: 'S22-3', title: 'On staging: after the question, Asking the knowledge base shows more calls than before', how: browser },
      { id: 'S22-3 2', story: 'S22-3', title: 'Locally, with the providers off: the fallback is checked and the count not compared', how: browser },
      { id: 'S22-3 3', story: 'S22-3', title: 'The daily cap is not reached in the browser (Q4)', how: { kind: 'ci', by: 'the ask reserves one question, all or nothing, with reserveQuota before any provider is called (supabase/functions/ask-knowledge/index.ts); the cap and the refusal are tested in supabase/tests/db/sprint4.test.ts and supabase/functions/_shared/usage.test.ts' } },
    ],
  },
  {
    sprint: 23,
    title: 'Try it, the main path end to end, and a failing migration on staging',
    stories: [
      { id: 'S23-1', title: 'Try it with a sample questionnaire', forTheUser: 'A demo visitor gets their own response from a sample questionnaire, drafted with the AI, to work through, download and mark as sent, without anything they do being learned by the shared knowledge base.' },
      { id: 'S23-2', title: 'The main path as one browser test', forTheUser: 'Every build proves the whole job still works end to end: add, upload, draft, ask a colleague, approve, download, mark as sent, learned.' },
      { id: 'S23-3', title: 'A migration that fails, tried on staging', forTheUser: 'We know that a failing migration stops a deploy and leaves the hosted database as it was.' },
    ],
    cases: [
      { id: 'S23-1 1', story: 'S23-1', title: 'Try it makes a response you own, named for the sample and for you, with the sample\'s questions drafted (the real AI on staging)', how: browser },
      { id: 'S23-1 2', story: 'S23-1', title: 'The try is grouped as any response: pricing and legal need a person with their reasons; bulk approval and download work', how: browser },
      { id: 'S23-1 3', story: 'S23-1', title: 'Marking a try as sent records it and learns nothing, and says so', how: browser },
      { id: 'S23-1 4', story: 'S23-1', title: 'A try\'s questions are never gaps', how: { kind: 'ci', by: 'supabase/tests/db/sprint23.test.ts' } },
      { id: 'S23-1 5', story: 'S23-1', title: 'Other members do not see a try in their lists; an admin sees all, marked Try', how: browser },
      { id: 'S23-1 6', story: 'S23-1', title: 'Try it again opens your try; Start a new try archives it and makes another', how: browser },
      { id: 'S23-1 7', story: 'S23-1', title: 'Nobody can turn a response into a try or back, or make a try for someone else', how: { kind: 'ci', by: 'supabase/tests/db/sprint23.test.ts' } },
      { id: 'S23-1 8', story: 'S23-1', title: 'When a limit stops a try\'s drafting, the page says which', how: browser },
      { id: 'S23-1 9', story: 'S23-1', title: 'At phone width Try it and the try fit', how: browser },
      { id: 'S23-1 10', story: 'S23-1', title: 'The guide, the introduction and the glossary describe Try it as it is', how: { kind: 'ci', by: 'docs/guide.test.ts and docs/glossary.test.ts' } },
      { id: 'S23-2 1', story: 'S23-2', title: 'Every step of the main path passes in one run, in order, on a response the test made', how: browser },
      { id: 'S23-2 2', story: 'S23-2', title: 'The downloaded Excel file holds every approved answer and the not-answered wording for the rest', how: browser },
      { id: 'S23-2 3', story: 'S23-2', title: 'After Mark as sent the page says what the knowledge base did with the answers; locally, with no checker, the colleague\'s answer is not learned and nothing reaches the knowledge base (that a checked answer becomes an entry is proven in the database tests)', how: browser },
      { id: 'S23-2 4', story: 'S23-2', title: 'The test fails, naming the step, if any step does not complete', how: { kind: 'hand', why: 'by construction (each step waits for its own result); to be checked once by breaking a step on a branch' } },
      { id: 'S23-3 1', story: 'S23-3', title: 'The Deploy run stops at a failing migration, names it, and runs no later step', how: { kind: 'hand', why: 'seen on staging in Deploy run 41896502103 on the throwaway branch sprint-23-f68 (DEPLOYING.md, When a migration fails)' } },
      { id: 'S23-3 2', story: 'S23-3', title: 'The table the failing migration created first is not on staging afterwards', how: { kind: 'hand', why: 'a read-only query on staging after that run found no table and no record of the migration' } },
      { id: 'S23-3 3', story: 'S23-3', title: 'The next ordinary staging run passes', how: { kind: 'ci', by: 'the Deploy run of this sprint branch on staging' } },
      { id: 'S23-3 4', story: 'S23-3', title: 'The failing migration never reaches main', how: { kind: 'ci', by: 'supabase/migrations on main has no 20261110100000_f68_failing_probe.sql (the branch is deleted)' } },
    ],
  },
];
