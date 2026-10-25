# Development

How to work on RFI Respond: setting up, the tests, changing the database, the evaluations, the demo data, the screenshots, CI, and how a sprint runs. The [README](../../README.md#running-it-locally) has the short version of setting up; [Configuration](CONFIGURATION.md) has every setting.

## The code

| Folder | What is in it |
|---|---|
| [`src/`](../../src) | The React app. Screens at the top level, the logic they use in [`src/lib/`](../../src/lib) (each with its tests), the workspace's steps in [`src/workspace/`](../../src/workspace), Help and the introduction in [`src/help/`](../../src/help) |
| [`supabase/migrations/`](../../supabase/migrations) | The database: tables, access rules, functions and triggers, in order. The only place access rules live |
| [`supabase/functions/`](../../supabase/functions) | The Edge Functions, and the server pipeline they share in `_shared/` ([Edge Functions](EDGE-FUNCTIONS.md)) |
| [`supabase/tests/`](../../supabase/tests) | The database tests, and the shim that stands in for Supabase on plain Postgres |
| [`supabase/seed.sql`](../../supabase/seed.sql) | Synthetic users, knowledge base and demo responses, for local use only |
| [`eval/`](../../eval) | The evaluations and their test sets; reports go to [`docs/evals/`](../evals/README.md) |
| [`sample-data/`](../../sample-data) | Synthetic questionnaires and the knowledge base the seed is built from |
| [`scripts/`](../../scripts) | The screenshot script |
| [`docs/`](..) | This reference, the user guide, decisions, governance, the backlog and each sprint's refinement |

The architecture, and why it is shaped this way, is in [Architecture](../ARCHITECTURE.md) and the [decisions](../decisions).

## Setting up

Needs Node 22, npm 11 (`npm install -g npm@11`; npm 10 fails on this dependency tree) and Docker for the local Supabase stack.

```bash
npm ci
npm run db:start
cp .env.example .env                                         # the API URL and anon key db:start printed
cp supabase/functions/.env.example supabase/functions/.env   # API keys, server side only
npm run db:reset
npx supabase functions serve                                 # a second window
npm run dev
```

`npm run db:reset` applies every migration from scratch and loads the seed. Run it after pulling a new migration. The seed users share a local development password, in `supabase/seed.sql`; it works only on a local install.

The local mail viewer (usually `http://127.0.0.1:54324`) catches the emails Supabase sends, such as password resets. Supabase Studio, for inviting people and reading tables, is at the address `db:start` prints.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | The development server, at `http://127.0.0.1:5173` |
| `npm run build` | The production build, in `dist/` |
| `npm run preview` | Serves the production build |
| `npm run typecheck` | TypeScript, for the app |
| `npm run lint` | ESLint; CI allows no warnings (`-- --max-warnings 0`) |
| `npm test` | The unit tests: the app's logic, the server pipeline, the evaluation maths and the documentation |
| `npm run coverage` | The unit tests with a coverage report |
| `npm run test:db` | The database tests; needs `DB_TEST_URL` |
| `npm run db:start` | Starts the local Supabase stack |
| `npm run db:stop` | Stops it |
| `npm run db:reset` | Rebuilds the local database from the migrations and the seed |
| `npm run types` | Generates TypeScript types from the local database |
| `npm run eval:retrieval` | Retrieval: how often the right entry is found |
| `npm run eval:calibrate` | Fits the confidence calibration and writes the tables the server uses |
| `npm run eval:intervals` | The 95% intervals for the published figures |
| `npm run eval:answerability` | The checker's verdicts against labelled questions |
| `npm run eval:gates` | The pricing and legal gates |
| `npm run eval:drafting` | Drafts: citations, figures and faithfulness |
| `npm run eval:plants` | Whether the faithfulness judge catches claims planted in drafts |
| `npm run eval:redteam` | Prompt injection: questions and entries written to subvert the gates, the checker or the drafts |
| `npm run eval:duplicates` | The similarity at which a learned answer replaces an entry |
| `npm run eval:extraction` | Finding questions in Word documents |
| `npm run eval:consistency` | How much the checker's verdict and the confidence move between runs |
| `npm run demo:record` | Records the demo drafts from a real run |
| `npm run demo:seed` | Regenerates the seed's knowledge base and demo sections |
| `npm run screenshots` | The screenshots for the README and the guide, and the 768 px layout check |

[Evaluations](../evals/README.md) has what each evaluation found and how its report is laid out. Evaluations call the AI providers and cost a little; the keys come from `.env` in `supabase/functions/`.

## Tests

- **Unit tests** (`npm test`) run in Node with no network. They cover file reading and hostile uploads ([`src/lib/spreadsheet.ts`](../../src/lib/spreadsheet.ts), [`src/lib/wordDocument.ts`](../../src/lib/wordDocument.ts)), the server pipeline with its AI clients replaced by test doubles, the export, the evaluation maths, and the documentation: the figures in the evaluations summary against their reports, every link and path, every label the guide names against the app, and every setting against the code ([`docs/docs.test.ts`](../docs.test.ts), [`docs/guide.test.ts`](../guide.test.ts), [`docs/technical.test.ts`](../technical.test.ts)).
- **Database tests** (`npm run test:db`) build a database from the shim and every migration, then run statements as real users the way the API does, so row-level security and column grants are what is tested. Each test's statements run in a transaction that is rolled back. Without Docker, point `DB_TEST_URL` at any Postgres 16 superuser connection.
- **The Edge Functions** are type-checked with Deno in CI, and called on the real Supabase stack there.

Write the test first. Each sprint's refinement lists the agreed test cases before anything is built.

## Changing the database

Every change is a new migration in `supabase/migrations/`, named with a timestamp after the last one; an applied migration is never edited. Migrations hold structure and rules, never sample data (sample data goes in `supabase/seed.sql`).

A new table needs, in the same migration ([decision 0003](../decisions/0003-access-control.md)):

1. row-level security turned on, and a policy for each thing each role may do;
2. column grants, so a role can change only the columns it should;
3. a database test for every row of the role matrix: member, response owner, assignee, admin and anonymous, for read, insert, update and delete.

A function a signed-in person calls is `SECURITY DEFINER` only when it must be, with `SET search_path = ''`, and checks the caller itself. [Data model and access](DATA-MODEL.md#adding-a-table) has the checklist, and lists every table, view and function with the rule and test that hold it.

## Changing the AI pipeline

The pipeline is in `supabase/functions/_shared/` and is shared, unchanged, by the Edge Functions and the evaluations, so an evaluation measures the code that runs. After changing a model, a prompt or a threshold:

1. Run the evaluation that covers it, and the calibration if the matching or the checker changed (`npm run eval:calibrate` writes [`calibration-tables.ts`](../../supabase/functions/_shared/calibration-tables.ts)).
2. Update [Evaluations](../evals/README.md) from the new report; the documentation tests check its figures against the report.
3. Update the [model card](../governance/MODEL-CARD.md) and, if the risk changes, the [risk register](../governance/RISK-REGISTER.md).
4. Record the demo again if its drafts would change.

## The demo data

The demo responses in the seed carry drafts recorded from a real run of the pipeline, so the app shows real outputs without API keys. To record them again, with the keys in `.env` in `supabase/functions/`:

```bash
npm run demo:record      # processes the demo questions as the app does; writes supabase/demo-recording.json and the seed
npm run db:reset
```

`npm run demo:seed` rebuilds the seed's sections from [`sample-data/`](../../sample-data) and the last recording, with no API calls.

## Screenshots

`npm run screenshots` signs in to the local app as the seed users and photographs the views the README and the guide use, writing [`docs/screenshots/`](../screenshots) and a layout check at 768 px (`layout-check.json`: whether any view scrolls sideways). It refuses to run against anything but a local install, and its browser refuses requests to anywhere else. Run `npx playwright install chromium` once first, then `npm run db:reset` so it photographs the seed.

## Continuous integration

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on every push to any branch and on pull requests, in three jobs:

1. Type check, lint, unit tests with coverage, an audit of production dependencies, the build, and a search of the built bundle for provider details and secret keys.
2. The database tests, on Postgres with the shim.
3. On the real Supabase stack: every migration and the seed applied from scratch, sign-up refused, the seeded admin able to sign in, and the Edge Functions refusing unsigned calls, enforcing their limits, and failing safely when a provider cannot be reached, without echoing a key. The Edge Functions are type-checked with Deno first.

## Deploying

[Deploying](../DEPLOYING.md) covers a hosted Supabase project, the function secrets and the app.

## How a sprint runs

The work is planned in [the backlog](../BACKLOG.md), with the project's rules at its top.

1. **Refine.** The sprint's stories are written up in [`docs/refinement/`](../refinement), one page per sprint, with agreed test cases, risks and open questions, and signed off before building.
2. **Build** on a `sprint-N` branch, test first, one commit per story with a message that says what changed and why.
3. **Review.** A separate agent that has not seen the work reviews it for security and for claims the code does not support; every finding is fixed or logged.
4. **Check end to end** on a local install, on a real browser.
5. **Close.** Delivered items are marked done, unfinished ones go back to the backlog, and findings are logged in the backlog.

British spelling and no em dashes in the documentation and the app's text; the tests check both.
