# Deploying

Until Sprint 14 RFI Respond ran only locally. Sprint 14 sets up an invite-only hosted demo on synthetic data: Supabase (Free plan, London) and the app on Vercel. This page lists what any hosted deployment needs; the step-by-step go-live, with each expected result, is [`docs/testing/sprint-14-go-live-pack.md`](testing/sprint-14-go-live-pack.md). For the demo, on 27 October 2026, every step below was done except two: leaked-password protection (not available on the Free plan, F-8) and limiting direct database connections (the database password is only in the owner's password manager; network restrictions were not set).

## Before anything is hosted

| Step | Why | Risk |
|---|---|---|
| Turn on leaked-password protection in the hosted Supabase project (Authentication settings) | Weak or leaked passwords are the main risk to a public sign-in page; the setting is not available on the local stack, and on Supabase's Free plan it is greyed out: the Sprint 14 demo runs on Free, so F-8 stays a residual there (Rory, Q1) | R-15 |
| Keep sign-up off, and turn it off as soon as the project exists, before the app is public; invite users from the dashboard | Accounts are invite-only by design; a new project allows sign-up until told otherwise | R-08 |
| Two-factor sign-in on every account behind the deployment (Supabase, the static host, GitHub, the email provider, Anthropic, Voyage) | Anyone in one of those accounts controls the deployment, whatever the app does | R-06, R-08 |
| Keys made for the deployment, each with its own spend limit, set from a file git ignores (`.env.hosted.local` beside `supabase/functions/.env.hosted.example`, copied from it) | The deployment's spend is capped on its own, its key can be revoked alone, and no key is typed on a command line | R-06, R-07 |
| Set spending limits in the Anthropic and Voyage consoles | The app's own caps are estimates from dated prices; a provider limit stops a bug from spending past them | R-07 |
| Switch on Voyage's zero-retention opt-out (dashboard, `Organization`, `Terms of Service`), or use local embeddings | Until then Voyage may keep and use embedded text | R-11 |
| Put the API keys in the hosted project's Edge Function secrets, never in the app's environment | Anything in the app's `.env` is built into the browser bundle; the app refuses to start with a service-role key | R-06 |
| Limit direct database connections to administrators | The access rules assume members reach the database only through the API ([decision 0003](decisions/0003-access-control.md)) | R-09 |
| Do not load `supabase/seed.sql`; for a demo, load `supabase/demo-hosted.sql` (`npm run demo:hosted`) | The seed creates the fictional users with a shared development password; the hosted demo data has the same responses and knowledge base with fictional authors who cannot sign in | R-15 |
| On a Free project, keep it awake: the `Keep the demo awake` workflow calls `public.keepalive()` four times a day | Supabase pauses a Free project after a week without enough database activity, without saying what it counts, so check it is still active a week after go-live | Availability |
| Use custom SMTP for invitations | Supabase's built-in email only reaches the project's own team, at 2 messages an hour ([Supabase docs](https://supabase.com/docs/guides/auth/auth-smtp)) | R-08 |
| Set `APP_ORIGIN` and the authentication site and redirect addresses to the app's address | The Edge Functions accept browser calls only from `APP_ORIGIN`; invitation and reset links return to the site address | R-08 |
| Review the provider terms and prices on the day ([`docs/governance/PROVIDERS.md`](governance/PROVIDERS.md)) and update `ai_prices` | Terms and prices change | R-11, R-07 |

## Then

1. Create the hosted Supabase project and link it: `npx supabase link`.
2. Apply the migrations: `npx supabase db push`.
3. Deploy the Edge Functions and set their secrets: `npx supabase functions deploy` (all five, including `invite-user` since Sprint 15) and `npx supabase secrets set`.
4. Build the app with the hosted project's URL and anon key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) using `npm run build:hosted`, which refuses a local or missing address and the secret key, and serve `dist/` with every path falling back to `index.html` and the security headers in [`vercel.json`](../vercel.json) (Vercel reads that file as it is).
5. Invite the first admin, and set the limits on the Governance page.
6. Load the organisation's own knowledge base through **Import KB**, and recalibrate on an evaluation set drawn from it: the calibration tables shipped here are fitted to the synthetic set and will not carry over ([`docs/evals/README.md`](evals/README.md)).

## Staging and automated deploys

Since Sprint 20, a second Supabase project, **staging**, holds a hosted copy of the app on synthetic data, and [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) deploys by itself:

- **A push to a `sprint-*` branch** applies the migrations and deploys every Edge Function to staging, moves the branch `staging` to the same commit (Vercel builds it at the staging address), checks the deploy ([`scripts/deploy-check.ts`](../scripts/deploy-check.ts): every migration applied, every function deployed, the app answering, no error from Supabase's security advisor), makes two test people with a password made for the run and resets the demo data ([`scripts/e2e-staging-users.ts`](../scripts/e2e-staging-users.ts)), then runs the browser acceptance tests there. The results go to the branch `e2e-results/staging/<branch>` for the sprint's demo page.
- **A push to `main`** publishes nothing by itself. The Deploy run waits in the GitHub environment `production` for the owner's approval (the job refuses to run if that environment does not require a reviewer). Once approved, in this order: it checks the live demo's sign-in settings, applies the migrations and deploys the Edge Functions, **then** moves the branch `live` to the commit, which Vercel publishes as the live demo, and finally checks the deploy, waiting for that build. If any step before it fails, `live` does not move and the live demo keeps the previous app with its database (Sprint 25, S25-1). `live` only moves forward: the push is not forced, and the run deploys nothing unless its commit is `live` or a later commit built on it, so re-running or approving an older run cannot put older functions or an older app on the live demo (Sprint 25 security review). Until Sprint 25, Vercel published `main` as soon as it moved, so at Sprint 24 the new screens ran against the previous database for three hours (F-75).

**Only the approved deploy moves `live` (Sprint 26, S26-2, F-77).** A GitHub ruleset on `live` refuses every update, force push and deletion except by a deploy key, with no bypass for the repository's admins either (Rory, 9 November: the Claude session's credentials count as an admin); the production job pushes with that deploy key, whose private half is the `production` environment's secret `LIVE_DEPLOY_KEY`, available only to a run Rory has approved, over SSH to GitHub's published host key. The job's own token can only read, so no other workflow, branch or person can publish by moving `live`. A second ruleset refuses force pushes and deletion of `main` for everyone; fast-forward merges work as before. The deploy refuses to start unless `LIVE_DEPLOY_KEY` is set and the `production` environment deploys from the branch `main` only. Both rulesets and the key are made by [`scripts/setup-live-key.ts`](../scripts/setup-live-key.ts), which Rory runs on his PC ([Rotating the keys](#rotating-the-keys)). The ruleset lets **every** deploy key that can write through, so never add another one (the script refuses while one exists). The push runs from a fresh repository with an emptied environment, and the job installs its packages without their install scripts, so code from earlier in the job has less chance to reach the key.

The order is checked in CI ([`scripts/deploy-order.test.ts`](../scripts/deploy-order.test.ts)): `vercel.json` does not build `main`; the step that moves `live` comes after the migrations and functions, before the check, and runs only if every step before it succeeded; it pushes with the deploy key to the pinned host key; and the job's token can only read.

**Rolling back the app.** Use Vercel's instant rollback to the previous production deployment (Vercel, the project, Deployments). While it is in place Vercel does not give the live address to new production builds, so undo it (or promote the new build) before the next deploy, whose check would otherwise wait for a build that is never served. `live` itself cannot be moved back by anyone but the deploy: to do that, Rory pauses the ruleset `live: only the approved deploy` (Settings, Rules, Rulesets, Enforcement: Disabled), runs `git push -f origin <previous commit>:live`, and sets it back to Active straight away. Neither way changes the database or the Edge Functions: a migration is never undone, and the functions stay as last deployed, so roll back only to an app that works with the database and functions as they now are.

Until the settings below exist, each job says so and passes, and the live demo is deployed by hand as in [Then](#then).

What lives where. No value is ever written in this repository, typed into the app, or pasted into a chat.

**The access tokens (security review, H2).** Each environment has its own token, limited to its own Supabase project, so the staging job cannot reach the live demo, and neither token can read keys, change sign-in or touch data outside migrations. Since Sprint 21 each can read its project's sign-in settings, and only read them (**Auth Config: Read**), so the deploy can check them. Each expires after a year; the deploy then fails with Supabase's message, and a new token goes in the same place ([Rotating the keys](#rotating-the-keys)).

| Setting | Where | What |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | GitHub, a secret in **each** environment, `staging` and `production` (not a repository secret) | A Supabase access token **limited to that environment's project** (Supabase's project-scoped tokens): read project settings, advisors, API keys, Data API, database and pooling configuration, and (since Sprint 21) sign-in configuration (**Auth Config: Read**); read and write migrations and Edge Functions; nothing else. Given only to the deploy and check steps, never to `npm ci` or the tests |
| `STAGING_SUPABASE_ANON_KEY` | GitHub, environment `staging` secret, and a repository secret for the keep-awake ping | Staging's public anon key |
| `STAGING_DB_PASSWORD`, `STAGING_SERVICE_ROLE_KEY`, `VERCEL_BYPASS_SECRET` | GitHub, environment `staging` secrets | Staging's database password and service key (to make the test people), and Vercel's protection-bypass secret |
| `PRODUCTION_DB_PASSWORD` | GitHub, environment `production` secret | The live demo's database password, readable only by the approved job |
| `LIVE_DEPLOY_KEY` | GitHub, environment `production` secret | The private half of the deploy key that moves `live` (Sprint 26), made and stored by `scripts/setup-live-key.ts`; never shown, and never in the repository |
| `STAGING_PROJECT_REF`, `STAGING_APP_HOST`, `PRODUCTION_PROJECT_REF`, `PRODUCTION_APP_HOST` | GitHub, repository variables | The two projects' refs and the two apps' host names, so each run can refuse the other |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel, Preview, for the branch `staging` only (type Config: they are public by design) | Staging's address and anon key. Production, and previews of other branches, keep the live demo's |
| `APP_ORIGIN`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | Staging's Edge Function secrets | As for the live demo, with the staging address. AI calls on staging are few: indexing after each reset and one question asked per run |

Setting it up, once (the owner's steps; about 30 minutes):

1. **Supabase.** Pause `campaign-studio` (kept only as a rollback since its move to Neon), so the Free plan has a slot. Create `rfi-respond-staging` in London on the Free plan and keep its database password in your password manager. Under Authentication, turn off new sign-ups and set the site address to the staging address (step 3). Under Edge Functions, Secrets, set `APP_ORIGIN` to `https://<staging address>` and the two AI keys (keys made for staging, each with a low spend limit, are best).
2. **GitHub**, repository settings. Under Environments, create `staging`, and `production` with yourself as required reviewer and deployments from `main` only. **Do this before adding `PRODUCTION_DB_PASSWORD`**, so the secret is never readable without your approval. Then add the secrets and variables in the table.
3. **Vercel**, the project's settings. `vercel.json` already tells Vercel not to build the `e2e-results/*` branches (whose commits carry their own `vercel.json` saying so, since Vercel reads each commit's own) or the `sprint-*` branches, whose builds nothing used: on the free plan every build counts against a daily limit, which stopped staging's builds in Sprint 22. Since Sprint 25 it does not build `main` either, and the project's production branch (Settings, Environments, Production, Branch Tracking) must be `live`, which the approved production job moves; the live demo's environment variables are the Production environment's, not tied to a branch. **Change the production branch to `live` before merging** the Sprint 25 change to `main`: until then a merge publishes nothing, moving `live` makes only a preview, and the deploy's check fails waiting for a production build. (Sprint 25: the Vercel connector cannot change this setting, so the owner changes it in the dashboard.) Under Domains, add a `.vercel.app` name for staging (such as `rfi-responder-staging.vercel.app`) tied to the Git branch `staging`. Under Environment Variables, add the staging address and anon key as Config variables for Preview, branch `staging` only. Under Deployment Protection, create a Protection Bypass for Automation secret and put it in GitHub as `VERCEL_BYPASS_SECRET`.
4. **The first run.** Push to a sprint branch (or re-run the Deploy workflow): it applies every migration to staging and, finding no demo data there, loads [`supabase/demo-hosted.sql`](../supabase/demo-hosted.sql) itself (staging only; the live demo's data is never loaded or reset by the workflow). From then on every run resets the demo.

### Sign-in settings, checked on every deploy

Since Sprint 21 (S21-3), the hosted projects' sign-in settings are written in [`supabase/hosted-auth.json`](../supabase/hosted-auth.json), one block per environment: new sign-ups off, the site address, and the redirect addresses. At the end of every staging run, and on the live demo after approval but before anything is deployed, the workflow reads the project's settings with its own token (read-only) and fails, naming each difference and where to change it, if they do not match: on staging the run fails after its tests; on the live demo the migrations, the functions and the app are all held back (since Sprint 25 the app moves only after them). New sign-ups must stay off whatever the file says (decision 0003). The check runs on each deploy, so a setting changed between pushes is found at the next one. Nothing is applied automatically (Rory, Q4): the tokens cannot change sign-in. To change a setting, change it in the Supabase dashboard (Authentication) and in `hosted-auth.json` in the same sprint.

### When a migration fails

Tried on staging on 4 November 2026 (Sprint 23, F-68), with a throwaway branch whose only migration created a table and then failed (`SELECT 1 / 0`); the branch was never merged. What happened:

- The Deploy run stopped at that migration. Its log names the file (`Applying migration 20261110100000_f68_failing_probe.sql...`) and the database's error (`ERROR: division by zero (SQLSTATE 22012)`).
- No later step ran: no Edge Functions were deployed, no browser tests ran, and staging's app was not moved to the branch.
- Nothing of the migration was kept. A read-only query afterwards found no `f68_probe` table and no record of the migration as applied; staging's latest migration was still the one before. A migration is all or nothing.

Each migration is applied in its own transaction, so when several are waiting, those before the failing one stay applied and the failing one and those after it are not (only a single migration was tried). So if a migration fails on the live demo, the demo keeps its database as it was up to that migration, its functions as they were, and (since Sprint 25) the previous app, because `live` is not moved. Fix the migration on a sprint branch, let staging pass, merge, and approve the deploy again. If earlier migrations of the same deploy were applied, the previous app runs against them until the fix is deployed.

### Rotating the keys

Who does what. Rory makes what only a dashboard issues and keeps the credentials; [`scripts/setup-secrets.ts`](../scripts/setup-secrets.ts), which Rory runs on his PC, puts them where the deploy reads them; Claude sets public, non-secret settings through the connectors, with Rory's approval each time, and never sees a value.

| Step | Who | How |
|---|---|---|
| Make the access token (yearly, or when its permissions change) | Rory | Supabase, Account, Access Tokens: a token limited to the one project, with the permissions in the table above |
| Store the access tokens, database passwords, the staging keys and Vercel's bypass secret | Rory, with the script | Signed in as himself (`npx supabase login`, `gh auth login`), in the repository's folder: `npx tsx scripts/setup-secrets.ts staging` lists what it would set, by name only; `npx tsx scripts/setup-secrets.ts staging --apply` sets them. The same for `production`. It reads the project's API keys with the Supabase command line, asks for the rest without showing what is typed (Enter leaves a secret as it is), refuses a key of the wrong kind and staging secrets for the live demo's project, and prints no value |
| Make or change the deploy key that moves `live`, and the rulesets on `live` and `main` | Rory, with the script | Signed in as himself (`gh auth login`), in the repository's folder: `npx tsx scripts/setup-live-key.ts` says what it would do; `--apply` does it: both rulesets, then a new key pair in a temporary folder, the public half added as a deploy key that can write, the private half stored as `LIVE_DEPLOY_KEY` in the `production` environment, the folder deleted and any earlier key of the script removed. It refuses if another deploy key can write (a ruleset lets every deploy key through). Run it again if the key may have leaked: a leaked key could push to any branch, by fast-forward on `main`, and to `live`, so check the branches and tags it could have reached (the repository's activity log) |
| Rotate an AI key | Rory | Make it in the provider's console with its spend limit, then set it in the project's Edge Function secrets (`APP_ORIGIN`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`); these never go to GitHub |
| Public settings (Vercel's preview variables, the repository variables) | Claude, with Rory's approval each time | The Vercel connector, or by hand from the table above |
| Check | The workflow | The next push to a sprint branch runs the deploy checks, the browser tests and the sign-in check on staging |


### Moving an action to a newer release

Every action the workflows run is pinned to a full commit, with its release in a comment (`actions/setup-node@949feb2… # v7.1.0`; Sprint 27, S27-2), so moving a tag cannot change what runs, least of all in the production job that holds the deploy key and the database password. `scripts/workflows.test.ts` fails on any action named by a tag or branch, on one still running on Node.js 20, and on the same action pinned to two commits. To move one:

1. Read the release's notes, above all its breaking changes, and check that its `action.yml` runs on a supported Node.js.
2. Take the release's commit: `git ls-remote https://github.com/<owner>/<action> refs/tags/<tag> refs/tags/<tag>^{}` (the last line is the commit).
3. Change every `uses:` line for that action, commit and release comment together.
4. Let CI and staging run on the sprint branch, and the production job run after the merge, before calling it done.

The Supabase CLI's own version is set separately. CI installs it with Supabase's setup-cli action (`version:` under each step). The two deploy jobs take it from the lockfile instead (the `supabase` package, 2.121.0, and its prebuilt platform package, checked by npm against their hashes), and check its version: setup-cli restores Bun from the Actions cache unchecked and runs it, which the job that holds the deploy key must not do (Sprint 27 security review). The production job installs with no npm cache and no install scripts. To move the CLI, change `package.json` and the lockfile, the `version:` lines and the deploy jobs' version check together; `scripts/workflows.test.ts` keeps them in step.
