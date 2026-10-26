# Sprint 14 go-live pack: the hosted demo

**Your accounts, your keys.** Every step here happens in your own Supabase, Vercel, Resend, Anthropic and Voyage accounts. No key, password or token goes into this file, the chat or the repository. Where a step needs one, it says where you keep it.

Branch `main`, after Sprint 14's security review is merged (it holds `vercel.json`, the hosted build check and the demo data). About 90 minutes, most of it waiting for DNS and deployments. Do the steps in order: later ones need values from earlier ones.

Two values you will note as you go (they are not secret):
- **Project ref**: the Supabase project's ID (in its address, `https://<project-ref>.supabase.co`).
- **App address**: the Vercel address, for example `https://rfi-respond.vercel.app`.

## Before you start

- A **Resend** account (or another SMTP provider) with a sending domain you own verified. Resend shows the DNS records to add; verification can take a while, so start it first.
- The **Anthropic** and **Voyage** keys you use locally (in `supabase/functions/.env` on your PC).
- Docker Desktop is not needed for these steps.

## Steps

### 1. Create the Supabase project

**Flow**

1. In the Supabase dashboard, choose **New project**: name `rfi-respond-demo`, region **London (eu-west-2)**, plan **Free**.
2. Generate a database password and save it in your password manager.

**Expected outcome:** the project is ready, and its address is `https://<project-ref>.supabase.co`.

**Result:** ☐ Done. Project ref:

### 2. Apply the migrations and deploy the functions

**Flow** (PowerShell in `C:\Code\rfi-responder`, on `main`)

1. `npx supabase login`
2. `npx supabase link --project-ref <project-ref>` and enter the database password when asked.
3. `npx supabase db push`, then answer `Y`.
4. `npx supabase functions deploy`

**Expected outcome**

- `db push` lists the migrations from `20260430145610` (the prototype's) to `20261102100000` and applies them all without an error.
- `functions deploy` deploys `embed`, `embed-entries`, `extract-questions` and `process-questions`.

**Result:** ☐ Done. Notes:

### 3. Set the function secrets

**Flow**

1. `npx supabase secrets set --env-file supabase/functions/.env`. This reads your keys from the file, so they never appear on the command line.
2. `npx supabase secrets list`

**Expected outcome:** the list shows `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `EMBEDDING_PROVIDER` and `EMBEDDING_MODEL`, with their values hidden. `APP_ORIGIN` comes in step 5.

**Result:** ☐ Done. Notes:

### 4. Deploy the app on Vercel

**Flow**

1. In Supabase, open **Project Settings**, then **API**, and copy the **Project URL** and the **anon** (or **publishable**) key. Never copy the `service_role` or secret key.
2. In Vercel, choose **Add New**, then **Project**, and import `rorymcclelland/RFI-responder`.
3. Under **Environment Variables**, add `VITE_SUPABASE_URL` (the Project URL) and `VITE_SUPABASE_ANON_KEY` (the anon key). Leave the build settings as `vercel.json` sets them.
4. Choose **Deploy**.

**Expected outcome**

- The build log shows `npm run build:hosted` passing, then the deployment is ready.
- Opening the app address shows the RFI Respond sign-in page.
- If the build stops with "The hosted build stopped", the message names the variable to fix.

**Result:** ☐ Done. App address:

### 5. Point Supabase at the app

**Flow**

1. `npx supabase secrets set APP_ORIGIN=<app address>` (no trailing slash).
2. In Supabase, open **Authentication**, then **URL Configuration**. Set **Site URL** to the app address, and add `<app address>/**` under **Redirect URLs**.

**Expected outcome:** the secret is listed, and both addresses are saved.

**Result:** ☐ Done. Notes:

### 6. Sign-in settings and email

**Flow**

1. **Authentication**, then **Sign In / Providers**:
   - turn **Allow new users to sign up** off;
   - keep **Email** on, with **Confirm email** on.
2. In the same place, set **Password requirements**: minimum length `12`, **Letters and digits**. Leaked-password protection is greyed out on the Free plan (agreed, Q1).
3. **Authentication**, then **Emails**, then **SMTP Settings**: turn on custom SMTP.
   - Host `smtp.resend.com`, port `465`, user `resend`.
   - Password: a Resend API key with send access only (create it in Resend).
   - Sender: an address on your verified domain, with the sender name `RFI Respond demo`.

**Expected outcome:** all settings saved; Supabase accepts the SMTP settings.

**Result:** ☐ Done. Notes:

### 7. Load the demo data

**Flow**

1. In Supabase, open the **SQL Editor** and start a new query.
2. Paste the whole of `supabase\demo-hosted.sql` and choose **Run**.
3. Run `select count(*) from kb_entries;` and `select name from opportunities;`

**Expected outcome**

- The first run reports success.
- There are 132 entries: 130 seeded and 2 learned by the demo's exported response.
- There are four responses, each marked "(fictional)".

**Result:** ☐ Done. Notes:

### 8. Your admin account

**Flow**

1. **Authentication**, then **Users**, then **Invite user**, with your own email address.
2. Open the email, follow the link, and set a password (12 characters or more, letters and digits). Save it in your password manager.
3. In the SQL Editor, replacing the address with yours: `update public.user_profiles set is_admin = true where id = (select id from auth.users where email = 'you@yourdomain');`
4. Sign out of the app and back in.

**Expected outcome**

- The email arrives from your sending domain.
- The link opens the app's **Welcome: choose a password** page.
- After signing in again you see **Governance** in the menu.

**Result:** ☐ Done. Notes:

### 9. Limits, in the app and at the providers

**Flow**

1. In the app, open **Governance**, then **Usage and limits**. Set:
   - **Monthly budget (£)** to `5`;
   - **Questions per person per day** to `50`;
   - **Word documents read by AI per person per day** to `5`.
2. In the Anthropic console, set a monthly spend limit for the key's workspace.
3. In the Voyage dashboard, set a usage limit, and switch on the zero-retention opt-out (`Organization`, then `Terms of Service`, the dashboard's labels).

**Expected outcome:** the governance page shows the new limits. Both provider limits are saved, and the Voyage opt-out is on.

**Result:** ☐ Done. Notes:

### 10. Invite the reviewers

**Flow**

1. For each reviewer: **Authentication**, then **Users**, then **Invite user**, with their address.
2. Tell them to expect the email, and that the demo holds synthetic data only.

**Expected outcome:** each appears under **Users** as invited; they are members, not admins.

**Result:** ☐ Done. Notes:

## When the demo has been idle

On the Free plan Supabase pauses a project after a period without use. Before a demo, open the project in the dashboard and choose **Restore project** if it is paused. Wait until it is ready, then load the app once.

## To reset the demo

Paste the whole of `supabase\demo-hosted-reset.sql` into the SQL Editor and run it. It removes every response and knowledge-base entry, including what reviewers added, and loads the demo again. Accounts, roles, limits, usage and the audit log are kept.

## When you have finished

Reply "live", with the app address. I then check the hosted project's security advisors and the app's pages (with your permission, through the connected Supabase tools and the browser), and send the hosted test pack.
