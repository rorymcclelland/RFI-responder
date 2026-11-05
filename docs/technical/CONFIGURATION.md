# Configuration

Everything that can be set, where it is set, and who reads it. There are three places: the app's environment (built into the browser bundle, so never a secret), the Edge Functions' environment (server-side secrets), and settings in the database (changed by admins on the governance page).

A test (`docs/technical.test.ts`) checks that every environment variable the code reads is listed here, and that every one listed here is read somewhere.

## The app (`.env`)

Copied from [`.env.example`](../../.env.example). Vite builds these into the JavaScript the browser downloads, so anyone using the app can read them. Only public values belong here: never an AI provider's key, and never the service-role key.

| Variable | Default | Read by | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | None (required) | [`src/lib/config.ts`](../../src/lib/config.ts) | The Supabase API. Locally `http://127.0.0.1:54321`, or `http://127.0.0.1:5173/supabase` through the development server's proxy for browsers that block another local port ([`vite.config.ts`](../../vite.config.ts)). Also read by the screenshot script, which allows requests only to it and to the app |
| `VITE_SUPABASE_ANON_KEY` | None (required) | [`src/lib/config.ts`](../../src/lib/config.ts) | The public "anon" key. It is public by design; row-level security decides what each signed-in person can do with it ([Data model and access](DATA-MODEL.md)) |

The app shows which is missing, instead of starting, if either is empty. It also refuses to start if `VITE_SUPABASE_ANON_KEY` holds the service-role key, which would bypass every access rule.

## The Edge Functions (a `.env` in `supabase/functions/`, or function secrets)

Copied from [`supabase/functions/.env.example`](../../supabase/functions/.env.example) for local use; set as function secrets on a hosted project ([Deploying](../DEPLOYING.md)). These are secrets and stay on the server (decision 0005). [Edge Functions](EDGE-FUNCTIONS.md#environment-variables) has which function reads each one.

| Variable | Default | Secret | Notes |
|---|---|---|---|
| `SUPABASE_URL` | Supplied by Supabase | No | Set by the Supabase CLI locally and by the platform when hosted |
| `SUPABASE_ANON_KEY` | Supplied by Supabase | No | Used to check the caller's sign-in |
| `SUPABASE_SERVICE_ROLE_KEY` | Supplied by Supabase | Yes | Bypasses row-level security; used only on the server, after the caller has been identified |
| `APP_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | No | The browser origins allowed to call the functions (CORS), comma-separated. Set it to the app's address when hosted |
| `EMBEDDING_PROVIDER` | `voyage` | No | `voyage` (hosted) or `ollama` (local) |
| `EMBEDDING_MODEL` | `voyage-4` for Voyage, `qwen3-embedding:0.6b` for Ollama (decision 0006) | No | Changing it needs a calibration table for the new model (`npm run eval:calibrate`) and re-indexes the knowledge base |
| `VOYAGE_API_KEY` | None | Yes | Needed for Voyage embeddings and for a `rerank-...` checker |
| `OLLAMA_URL` | `http://host.docker.internal:11434` | No | Ollama as seen from inside Docker |
| `ANTHROPIC_API_KEY` | None | Yes | Needed for the checker, the pricing and legal classifier, drafting and reading Word documents. Without it, questions are not calibrated, are marked "not fully checked", get assembled rather than generated drafts, and Word documents are read by rules |
| `ANSWERABILITY_CHECKER` | `claude-haiku-5-5` | No | The checker: a Claude model, `rerank-2.5` or `rerank-3` (Voyage), or `none` (similarity only: nothing is then approved in bulk) |
| `GATE_MODEL` | `claude-haiku-5-5` | No | The pricing and legal classifier |
| `DRAFT_MODEL` | `claude-haiku-5-5` | No | The drafting model. Also read by the evaluation scripts |
| `EXTRACT_MODEL` | `claude-haiku-5-5` | No | The model that finds questions in Word documents |

Confidence is calibrated for one combination of embedding model and checker. A combination with no calibration table in [`calibration-tables.ts`](../../supabase/functions/_shared/calibration-tables.ts) leaves every question "Not calibrated", so nothing is approved in bulk. Both defaults have one (`voyage-4` and `qwen3-embedding:0.6b`, each with `claude-haiku-5-5`), and a test keeps it so. A model set explicitly without one, such as `bge-m3`, leaves every question "Not calibrated".

## Evaluations, scripts and tests

Read from the shell, and by the evaluation scripts also from `.env` in `supabase/functions/` ([`eval/lib.ts`](../../eval/lib.ts)), so the same keys serve both.

| Variable | Default | Read by | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | None | The evaluations that call Claude | As above |
| `VOYAGE_API_KEY` | None | The retrieval, calibration and demo evaluations | As above |
| `DRAFT_MODEL` | `claude-haiku-5-5` | [`eval/pipeline.ts`](../../eval/pipeline.ts) | As above |
| `OLLAMA_URL_HOST` | `http://localhost:11434` | [`eval/run-retrieval.ts`](../../eval/run-retrieval.ts) | Ollama as seen from your PC rather than from Docker |
| `APP_URL` | `http://127.0.0.1:5173` | [`scripts/screenshots.ts`](../../scripts/screenshots.ts) | The running app to photograph. Must be a local address |
| `SEED_PASSWORD` | The seed users' local password | [`scripts/screenshots.ts`](../../scripts/screenshots.ts) | The password of the seed users in [`supabase/seed.sql`](../../supabase/seed.sql); for local use only |
| `DB_TEST_URL` | `postgres://postgres@localhost:5432/postgres` | [`supabase/tests/db/harness.ts`](../../supabase/tests/db/harness.ts) | A Postgres 16 superuser connection for `npm run test:db`. The tests drop and recreate a database called `rfi_test` on that server |

## Browser tests, staging and deploys (Sprint 20)

Read by the browser acceptance tests ([`e2e/`](../../e2e)) and the deploy scripts. Locally none is needed: `npm run test:e2e` runs against the local app as the seed users. On staging, CI sets them from the repository's variables and secrets ([Deploying](../DEPLOYING.md#staging-and-automated-deploys)); none is ever typed into the app or this repository.

| Variable | Default | Read by | What it does |
|---|---|---|---|
| `E2E_TARGET` | `local` | [`e2e/target.ts`](../../e2e/target.ts) | `local` or `staging` |
| `E2E_BASE_URL` | `http://127.0.0.1:5173` | [`e2e/target.ts`](../../e2e/target.ts) | The app to test. Locally it must be on this machine; on staging, the sprint's Vercel preview |
| `E2E_FORBIDDEN_HOSTS` | None | [`e2e/target.ts`](../../e2e/target.ts) | On staging, the live demo's app and Supabase hosts, comma-separated: the run refuses to start against them and the browser refuses every request to them |
| `E2E_ADMIN_EMAIL` | The seed admin | [`e2e/target.ts`](../../e2e/target.ts) | On staging, the test admin, set by [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) |
| `E2E_ADMIN_NAME` | `Test Admin` | [`e2e/target.ts`](../../e2e/target.ts) | The test admin's display name |
| `E2E_MEMBER_EMAIL` | A seed member | [`e2e/target.ts`](../../e2e/target.ts) | On staging, the test member |
| `E2E_MEMBER_NAME` | `Test Member` | [`e2e/target.ts`](../../e2e/target.ts) | The test member's display name |
| `E2E_PASSWORD` | The seed users' local password | [`e2e/target.ts`](../../e2e/target.ts) | On staging, the password made for the run, masked in the log |
| `E2E_VERCEL_BYPASS` | None | [`e2e/support.ts`](../../e2e/support.ts) | Vercel's protection-bypass secret for previews, sent only to the app's own host |
| `E2E_SLOW_MO` | `150` | [`playwright.config.ts`](../../playwright.config.ts) | Milliseconds between browser actions, so the recordings can be followed |
| `E2E_NO_SERVER` | None | [`playwright.config.ts`](../../playwright.config.ts) | Set when the app is already running, so the tests do not start it |
| `STAGING_SUPABASE_URL` | None | [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) | The staging project's address |
| `STAGING_SUPABASE_ANON_KEY` | None | [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) | The staging project's public key, to sign in as the test admin and reset the demo |
| `STAGING_SERVICE_ROLE_KEY` | None | [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) | The staging project's service key, to make the test people. Only ever in CI; never the live demo's |
| `PRODUCTION_SUPABASE_REF` | None | [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) | The live demo's project ref, which the script refuses |
| `GITHUB_ENV` | Set by GitHub Actions | [`scripts/e2e-staging-users.ts`](../../scripts/e2e-staging-users.ts) | Where the script passes the test people to the next step |
| `SUPABASE_URL` | None | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | After a deploy, the project to check (also an Edge Function variable, above) |
| `APP_URL` | None | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | After a deploy, the app to check (also the screenshot script's, above) |
| `SUPABASE_ACCESS_TOKEN` | None | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | A Supabase personal access token: the CLI uses it to deploy, and the check to read the security advisor |
| `VERCEL_BYPASS` | None | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | Vercel's protection-bypass secret, to load a protected preview |
| `EXPECTED_SHA` | None | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | The commit just deployed: the check waits until the app's page names it, or a later commit that includes it (the `app-version` tag, from Vercel's `VERCEL_GIT_COMMIT_SHA` at build time) |
| `GITHUB_REPOSITORY` | Set by GitHub Actions | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | The repository whose commits the deploy check compares (Sprint 24 close) |
| `GITHUB_TOKEN` | Set by GitHub Actions | [`scripts/deploy-check.ts`](../../scripts/deploy-check.ts) | Read-only, to ask GitHub whether the build the app serves includes the deployed commit (Sprint 24 close) |

## Settings in the database

Changed by admins under **Governance**, **Usage and limits**, and read by the database functions that enforce them. Every change is recorded in the audit log. [Data model and access](DATA-MODEL.md) has the access rules.

`public.ai_settings` (one row):

| Setting | Default | What it does |
|---|---|---|
| `daily_question_cap` | 300 | Questions each person can have processed per day (UTC) |
| `daily_embed_cap` | 5000 | Knowledge-base texts each person can have indexed per day |
| `daily_extract_cap` | 20 | Word documents each person can have read by AI per day |
| `monthly_budget_gbp` | 10 | The month's AI budget in pounds. When the estimated spend reaches it, processing stops for everyone |
| `alert_share` | 0.8 | The share of the budget at which admins are warned |
| `gbp_per_usd` | 1.00 | The exchange rate used to price usage, which providers bill in dollars |
| `est_usd_per_question` | 0.002 | Reserved against the budget for each question while it is processed, then settled at the measured cost |
| `est_usd_per_embed_text` | 0.0001 | Reserved for each knowledge-base text indexed |
| `est_usd_per_extract_kchar` | 0.0005 | Reserved for each 1,000 characters of a Word document read by AI |
| `review_interval_months` | 12 | How often knowledge-base entries fall due for review (1 to 60) |

`public.ai_prices` holds the price per million input and output tokens for each model, with the date it was checked; models not listed are recorded with no cost. `public.learning_thresholds` holds, for each embedding model, the similarity at which a learned answer replaces an existing entry, chosen by `npm run eval:duplicates`. Both are set by migrations.

Set spending limits in the AI providers' own consoles as well: the budget here is enforced on the app's estimates, and a key used elsewhere is not counted.
