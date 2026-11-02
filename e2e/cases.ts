/**
 * Sprint 20 (S20-4): the agreed cases of each sprint, as refined with Rory, and how each is checked.
 * The demo page (scripts/demo-page.ts) lists every one: a browser test's result comes from the run;
 * anything else is shown with how it was checked, never as passed by this run. A case with no test
 * and no other check is shown as not checked, in red.
 */
export type How =
  | { kind: 'browser' }
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
      { id: 'S19 7', story: 'S19-4', title: 'The screenshots retaken, every view fitting 768 px', how: { kind: 'ci', by: 'the e2e job runs npm run screenshots on the fresh seed and keeps layout-check.json' } },
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
      { id: 'S20-1 1', story: 'S20-1', title: 'The suite passes on a fresh local stack, in CI', how: browser },
      { id: 'S20-1 2', story: 'S20-1', title: 'A failure shows with its screenshot and recording; no retries', how: { kind: 'ci', by: 'playwright.config.ts (retries 0, screenshot on, a recording per session attached by e2e/support.ts)' } },
      { id: 'S20-1 3', story: 'S20-1', title: 'The suite refuses a non-local address', how: { kind: 'ci', by: 'e2e/support.test.ts (targetProblem) and the browser\'s request guard' } },
      { id: 'S20-1 4', story: 'S20-1', title: 'A deliberately broken build fails a test', how: { kind: 'ci', by: 'a throwaway commit with Home\'s heading removed, recorded in the refinement\'s close' } },
      { id: 'S20-1 5', story: 'S20-1', title: 'Recordings show only synthetic people and data', how: { kind: 'hand', why: 'Claude looks at the recordings before publishing this page' } },
      { id: 'S20-2 1', story: 'S20-2', title: 'A sprint branch\'s preview talks to staging, never the live demo', how: { kind: 'hand', why: 'needs the staging project, which Rory sets up' } },
      { id: 'S20-2 2', story: 'S20-2', title: 'The live demo is untouched by staging runs', how: { kind: 'ci', by: 'scripts/deploy-check.test.ts (stagingProblem refuses the live project) and the staging run\'s request guard' } },
      { id: 'S20-2 3', story: 'S20-2', title: 'A staging test user cannot sign in on the live demo', how: { kind: 'hand', why: 'needs the staging project' } },
      { id: 'S20-2 4', story: 'S20-2', title: 'No secret in the repository, a log, a recording or the bundle', how: { kind: 'ci', by: 'the bundle check, masked passwords in scripts/e2e-staging-users.ts, and the security review' } },
      { id: 'S20-2 5', story: 'S20-2', title: 'Staging stays awake between sprints', how: { kind: 'hand', why: 'needs a week to pass with staging set up' } },
      { id: 'S20-3 1', story: 'S20-3', title: 'A sprint branch\'s migration reaches staging with no command typed', how: { kind: 'hand', why: 'needs the staging project' } },
      { id: 'S20-3 2', story: 'S20-3', title: 'A migration that fails on Supabase stops the deploy, the live demo untouched', how: { kind: 'hand', why: 'needs the staging project' } },
      { id: 'S20-3 3', story: 'S20-3', title: 'An undeployed function fails the check', how: { kind: 'ci', by: 'scripts/deploy-check.test.ts (a 404 means not deployed)' } },
      { id: 'S20-3 4', story: 'S20-3', title: 'Merging to main waits for Rory\'s approval', how: { kind: 'hand', why: 'needs the production environment\'s required reviewer, which Rory sets' } },
      { id: 'S20-3 5', story: 'S20-3', title: 'Forks and pull requests cannot deploy', how: { kind: 'ci', by: '.github/workflows/deploy.yml runs on pushes to this repository only' } },
      { id: 'S20-4 1', story: 'S20-4', title: 'Every agreed case is listed; one with no check shows in red', how: { kind: 'ci', by: 'scripts/demo-page.test.ts' } },
      { id: 'S20-4 2', story: 'S20-4', title: 'A failing test shows as failed, with its recording', how: { kind: 'ci', by: 'scripts/demo-page.test.ts' } },
      { id: 'S20-4 3', story: 'S20-4', title: 'The recordings play and match the build named', how: { kind: 'hand', why: 'Rory, watching this page' } },
      { id: 'S20-4 4', story: 'S20-4', title: 'The page claims nothing the tests did not check', how: { kind: 'ci', by: 'scripts/demo-page.test.ts (only browser cases take a result from the run)' } },
    ],
  },
];
