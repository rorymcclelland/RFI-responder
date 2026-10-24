# Deploying

RFI Respond has only been run locally, on synthetic data (Sprint 7 decision: repository only, no hosted demo). This page lists what a hosted deployment would need before it held real data or real users. None of it has been done or tested here.

## Before anything is hosted

| Step | Why | Risk |
|---|---|---|
| Turn on leaked-password protection in the hosted Supabase project (Authentication settings) | Weak or leaked passwords are the main risk to a public sign-in page; the setting is not available on the local stack (backlog F-8) | R-15 |
| Keep sign-up off; invite users from the dashboard | Accounts are invite-only by design | R-08 |
| Set spending limits in the Anthropic and Voyage consoles | The app's own caps are estimates from dated prices; a provider limit stops a bug from spending past them | R-07 |
| Switch on Voyage's zero-retention opt-out (dashboard, `Organization`, `Terms of Service`), or use local embeddings | Until then Voyage may keep and use embedded text | R-11 |
| Put the API keys in the hosted project's Edge Function secrets, never in the app's environment | Anything in the app's `.env` is built into the browser bundle; the app refuses to start with a service-role key | R-06 |
| Limit direct database connections to administrators | The access rules assume members reach the database only through the API ([decision 0003](decisions/0003-access-control.md)) | R-09 |
| Do not load `supabase/seed.sql` | It creates the fictional users with a shared development password | R-15 |
| Review the provider terms and prices on the day ([`docs/governance/PROVIDERS.md`](governance/PROVIDERS.md)) and update `ai_prices` | Terms and prices change | R-11, R-07 |

## Then

1. Create the hosted Supabase project and link it: `npx supabase link`.
2. Apply the migrations: `npx supabase db push`.
3. Deploy the Edge Functions and set their secrets: `npx supabase functions deploy` and `npx supabase secrets set`.
4. Build the app with the hosted project's URL and anon key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) and serve `dist/` from any static host.
5. Invite the first admin, and set the limits on the Governance page.
6. Load the organisation's own knowledge base through **Import KB**, and recalibrate on an evaluation set drawn from it: the calibration tables shipped here are fitted to the synthetic set and will not carry over ([`docs/evals/README.md`](evals/README.md)).
