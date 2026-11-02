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
      { id: 'S21-3 1', story: 'S21-3', title: 'The sign-in settings check passes on staging and the live demo as they are', how: { kind: 'ci', by: 'the Deploy workflow, step "Sign-in settings match the repository": fails until Rory makes the two access tokens again with Auth Config: Read' } },
      { id: 'S21-3 2', story: 'S21-3', title: 'With sign-ups turned on on staging the deploy fails and names it; turned back, it passes', how: { kind: 'hand', why: 'changing a live sign-in setting is Rory\'s to do (once); the check\'s wording is also a unit test in scripts/setup-secrets.test.ts' } },
      { id: 'S21-3 3', story: 'S21-3', title: 'The script\'s dry run lists the secrets it would set, by name only', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-3 4', story: 'S21-3', title: 'The script refuses a key of the wrong kind, and the live demo\'s project for staging', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-3 5', story: 'S21-3', title: 'Nothing the script or the check prints contains a key', how: { kind: 'ci', by: 'scripts/setup-secrets.test.ts' } },
      { id: 'S21-4 1', story: 'S21-4', title: 'On staging: a calibrated confidence, the checker\'s verdict and a cited entry', how: browser },
      { id: 'S21-4 2', story: 'S21-4', title: 'Locally: the fallback answer, not calibrated', how: browser },
      { id: 'S21-4 3', story: 'S21-4', title: 'The ask is recorded under the admin\'s usage, and the daily cap applies', how: { kind: 'hand', why: 'not built in Sprint 21: the staging run does not read the usage line on Governance (QA review); built and checked in Sprint 18, and to be added to the staging test' } },
    ],
  },
];
