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
- **A push to `main`** does the same deploy and checks on the live demo, in the GitHub environment `production`, which waits for the owner's approval before anything runs.

Until the settings below exist, each job says so and passes, and the live demo is deployed by hand as in [Then](#then).

What lives where. No value is ever written in this repository, typed into the app, or pasted into a chat.

| Setting | Where | What |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | GitHub, repository secret | A Supabase personal access token, used by the CLI to deploy and to read the security advisor |
| `STAGING_SUPABASE_ANON_KEY` | GitHub, repository secret | Staging's public anon key (also used by the keep-awake ping) |
| `STAGING_DB_PASSWORD`, `STAGING_SERVICE_ROLE_KEY`, `VERCEL_BYPASS_SECRET` | GitHub, environment `staging` secrets | Staging's database password and service key (to make the test people), and Vercel's protection-bypass secret |
| `PRODUCTION_DB_PASSWORD` | GitHub, environment `production` secret | The live demo's database password, readable only by the approved job |
| `STAGING_PROJECT_REF`, `STAGING_APP_HOST`, `PRODUCTION_PROJECT_REF`, `PRODUCTION_APP_HOST` | GitHub, repository variables | The two projects' refs and the two apps' host names, so each run can refuse the other |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Vercel, Preview environment | Staging's address and anon key (Production keeps the live demo's) |
| `APP_ORIGIN`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | Staging's Edge Function secrets | As for the live demo, with the staging address. AI calls on staging are few: indexing after each reset and one question asked per run |

Setting it up, once (the owner's steps; about 30 minutes):

1. **Supabase.** Pause `campaign-studio` (kept only as a rollback since its move to Neon), so the Free plan has a slot. Create `rfi-respond-staging` in London on the Free plan and keep its database password in your password manager. Under Authentication, turn off new sign-ups and set the site address to the staging address (step 3). Under Edge Functions, Secrets, set `APP_ORIGIN` to `https://<staging address>` and the two AI keys (keys made for staging, each with a low spend limit, are best).
2. **GitHub**, repository settings. Under Environments, create `staging`, and `production` with yourself as required reviewer and deployments from `main` only. **Do this before adding `PRODUCTION_DB_PASSWORD`**, so the secret is never readable without your approval. Then add the secrets and variables in the table.
3. **Vercel**, the project's settings. Under Domains, add a `.vercel.app` name for staging (such as `rfi-responder-staging.vercel.app`) tied to the Git branch `staging`. Under Environment Variables, give Preview the staging address and anon key. Under Deployment Protection, create a Protection Bypass for Automation secret and put it in GitHub as `VERCEL_BYPASS_SECRET`.
4. **The first run.** Push to a sprint branch (or re-run the Deploy workflow): it applies every migration to staging. Then, once, in staging's SQL Editor, run [`supabase/demo-hosted.sql`](../supabase/demo-hosted.sql), which loads the demo and stores the script the reset uses. Re-run the workflow: from then on every run resets the demo itself.
