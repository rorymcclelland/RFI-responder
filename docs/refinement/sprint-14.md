# Sprint 14 refinement: a hosted demo

Refined 26 October 2026, after Rory chose at the Sprint 13 review to "make it hosted". From the backlog: F-8 (leaked-password protection, which only a hosted project has), F-57 (the audit log append-only for the service role), and a public demo. Until now the app has only run locally, and `docs/DEPLOYING.md` lists what a hosted deployment would need, none of it done.

## What refinement found

- **F-8 needs a paid Supabase plan.** "Prevent use of leaked passwords" is available only on the Pro plan and above; on the Free plan the switch is greyed out ([guide](https://www.guardlayer.io/blog/supabase-leaked-password-protection)). Free projects are also paused after a period without use, which would take a demo offline between visits. Q1.
- **Invitations need an email service.** Supabase's built-in email only delivers to members of the project's team, at 2 messages an hour, best effort ([Supabase docs](https://supabase.com/docs/guides/auth/auth-smtp)). Inviting a reviewer from outside, or letting someone reset a password, needs a custom SMTP provider, or accounts created by hand in the dashboard. Q3.
- **The demo data cannot come from `supabase/seed.sql`.** It creates the fictional users with a shared development password, which `DEPLOYING.md` rightly forbids on a hosted project. The demo needs the same knowledge base and responses with fictional authors who cannot sign in, and real accounts only for the people Rory invites.
- **Reviewers should be members, not admins.** An admin can raise the monthly AI budget, which spends on Rory's keys, and can delete responses. The provider consoles' own spending limits are the backstop either way. Q2.
- **The Edge Functions already support a hosted origin.** `APP_ORIGIN` sets the allowed browser origin (CORS); it must be set to the hosted address. The app reads its Supabase address and anon key at build time, so the static host needs those two values and nothing secret.
- **The app is a single page.** Invitation and password-reset links arrive with a hash, so the host must serve `index.html` for every path, and should send security headers (a content security policy limited to the app, the Supabase project and the font host).
- **F-57 is a grant change.** The Edge Functions hold the service-role key, and the service role can update and delete audit rows. Nothing in the functions writes the audit log directly, so revoking update, delete and truncate from the service role costs nothing.
- **Some steps are Rory's alone.** Creating the projects, choosing a plan, setting secrets and spending limits, and inviting people happen in his accounts. Keys never pass through Claude. Claude writes the files, the migration and a step-by-step go-live pack, and checks the result.

## Stories

### S14-1 The audit log cannot be changed by the service role (F-57). S

**What changes.** A migration revokes `UPDATE`, `DELETE` and `TRUNCATE` on `public.audit_log` from `service_role`, keeping `SELECT` and `INSERT`. A database test covers the service role. The risk register's R-09 residual and the data model are updated.

**Test cases.**
1. The service role can still insert and read audit rows.
2. The service role cannot update, delete or truncate them.
3. Every existing audit path (exports, reviews, settings, deletions) still writes its row.
4. Members and admins are unchanged: they cannot change the log either.

### S14-2 Demo data a hosted project can load. M

**What changes.**
- `npm run demo:hosted` writes `supabase/demo-hosted.sql` from the same sources as the local seed: the 130 knowledge-base entries and the four demo responses.
- The fictional people exist as authors with `@example.invalid` addresses and no password, so nobody can sign in as them. No development password appears anywhere in the file.
- The file is safe to run twice, and a reset section restores the demo (removes what reviewers added to responses and the knowledge base, then reloads it) without touching real accounts.

**Test cases.**
1. The file contains no password hash, no `LocalDev` string and no `@example.com` address.
2. Loaded on the test database, it gives the same knowledge base and responses as the local seed; the fictional users cannot sign in (no password).
3. Loading it twice changes nothing; the reset section returns the demo to its starting state and leaves real accounts and their roles alone.
4. Hostile: the generator refuses anything in the demo plan that looks like a real company or address, as the local seed does.

### S14-3 Ready to host. M

**What changes.**
- `vercel.json`: every path serves `index.html`; security headers (content security policy, no framing, no sniffing, a strict referrer policy).
- The build fails if `VITE_SUPABASE_URL` is local in a production build, or missing.
- A CI check that the content security policy allows only the app, the Supabase project's address pattern and the font host.
- `docs/DEPLOYING.md` becomes the go-live runbook, and a go-live pack (Markdown and PDF, the test pack format) lists Rory's steps in order, with each expected result.

**Test cases.**
1. A production build with a local or missing Supabase address fails with a clear message; a development build still works locally.
2. The header file sends every listed header, and the policy names no other host.
3. A deep link such as an invitation link with a hash loads the app.

### S14-4 Go live. M (most of it Rory's steps, with Claude checking)

**What changes, in Rory's accounts, following the go-live pack.**
1. Create the Supabase project in London (`eu-west-2`) on the Free plan (Q1, Q4), and link it.
2. Apply the migrations; deploy the Edge Functions; set the secrets (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `APP_ORIGIN`) with the CLI.
3. Authentication: sign-up off, minimum length 12 with letters and digits, leaked-password protection not available on Free (F-8 stays a residual, Q1), the site address and redirect address set to the hosted app, email as Q3 settles.
4. Spending limits in the Anthropic and Voyage consoles; Voyage's zero-retention opt-out on.
5. Low limits in the app's Governance page (a monthly budget of a few dollars, a daily cap per person).
6. Load `demo-hosted.sql`.
7. Create the Vercel project from the GitHub repository with the two public build values; deploy main.
8. Create Rory's admin account and invite the reviewers as members.

**Checks (a test pack against the hosted app, with Rory's own account).** Sign-in; an invitation link sets a password; the demo responses and knowledge base are there; processing a few questions works and is charged to the budget; Supabase's security advisor reports no errors (Claude reads it, with Rory's permission, through the connected Supabase tools); a fictional user cannot sign in.

### S14-5 Say what is hosted, and how. S

**What changes.** The README (the demo's address, who can get access and how, what it runs on, that it holds synthetic data only); `docs/governance/DATA-HANDLING.md` (reviewers' email addresses are the only personal data, where they are held, and how to remove them); `docs/governance/PROVIDERS.md` (Supabase and Vercel added, with plans, regions and terms checked on the day); the risk register (R-11 from planned to done; R-15 with F-8 as a stated residual on the Free plan); `DEPLOYING.md` saying what was done and what was not.

**Test cases.** 1. The docs tests pass: every provider row has a source and a date; no page claims a control that is not switched on. 2. The README names no credential.

### S14-6 Switching away and back keeps your place (BUG-34, reported by Rory 26 October). S

**The bug.** Expand a question, switch to another application, switch back: the question has collapsed. Open modals close too, and other state resets.

**The cause, found in refinement.** When the browser tab regains focus, Supabase's client checks the session again and reports it (`SIGNED_IN`, or `TOKEN_REFRESHED` when the token is renewed). `App.tsx` treats every such report as a new sign-in: it reloads the profile, and while it does so shows the full-page loading screen, which unmounts the whole app. Every expanded card, open modal, filter and half-written answer is lost, the knowledge base is reloaded, and indexing is started again. A hosted demo, where tokens are renewed, would make it worse.

**What changes.** The profile is loaded only when the signed-in person changes (a different user id) or after signing out; a session report for the same person only updates the stored session. The full-page loading screen is shown only before the first load, never once the app is on screen. A small pure function decides what an auth event should do, so it can be tested.

**Test cases.**
1. The same person's `SIGNED_IN` (on refocus) and `TOKEN_REFRESHED`: the profile is not reloaded and the loading screen is not shown.
2. A different person signing in: the profile is loaded.
3. `SIGNED_OUT`: the user is cleared and the sign-in page shows.
4. `PASSWORD_RECOVERY` still opens the set-password page.
5. By hand (test pack): an expanded question, an open modal and a half-written answer survive switching applications and back, and a token renewal.

## Not in this sprint

A custom domain (the Vercel address will do). Automatic deployment of the database and functions from CI (it would put the service key in GitHub; Rory deploys them from his PC). Real organisations' data: the hosted demo holds synthetic data only (rule 2).

## Boundaries

- **Rule 1, honesty:** the README says exactly what is hosted, who can use it, and which planned controls are on.
- **Rule 2, synthetic data only:** the demo data is the synthetic set; reviewers' email addresses are the only real data.
- **Keys:** only in the hosted project's secrets and the providers' consoles, set by Rory; never in chat, the repository or the app's build.
- **Rory makes the account changes himself:** projects, plans, billing, secrets, invitations.

## The sprint as a whole

**On the Free plan** the project pauses after a period without use; the go-live pack and the README say how Rory wakes it before a demo.

Order: S14-6 first (a quick fix that also matters for the hosted app), then S14-1, S14-2 and S14-3 (Claude, independent), then S14-4 (Rory with the go-live pack, Claude checking), then S14-5. Sizes: three S and three M, about three and a half days, then the security review, the hosted check and the close.

## Questions for Rory (answered 26 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | Supabase plan | Pro (about $25 a month) for as long as the demo is up: it is the only way to switch on leaked-password protection (F-8), and Free projects pause when unused. The alternative is Free, recording F-8 as a residual and waking the project before a demo **Rory: Free.** F-8 stays a residual (R-15): invite-only accounts, minimum length 12 with letters and digits, and passwords set by the reviewers themselves; the go-live pack says how to wake the project before a demo |
| Q2 | Who can use the demo | Invite-only: Rory is the admin; reviewers he names are members (they can do everything an owner can on their own responses, but cannot change limits or the budget) **Rory: agreed** |
| Q3 | How reviewers get in | A custom SMTP provider (for example Resend, sending from a domain Rory owns), so invitations and password resets work. The alternative is creating each account by hand in the dashboard and sending the password separately **Rory: agreed (custom SMTP)** |
| Q4 | Where it runs | Supabase in Europe (Ireland, `eu-west-1`) and the app on Vercel, deployed from GitHub's main branch **Rory: Supabase in London (`eu-west-2`), the app on Vercel** |

## Security review (27 October 2026)

An independent review of `main..sprint-14` before the first public deployment found no high issue, four medium and nine low; all are fixed, or written into the go-live pack, before go-live.

| | Finding | Fix |
|---|---|---|
| M1 | After a profile load that failed (for example while a Free project wakes), signing in again did nothing: the app thought the profile was loaded | A profile counts as loaded only once it is on screen; a failed load is retried at the next sign-in |
| M2 | The app passed its whole environment to the configuration, so every `VITE_` value on the host would be built into the bundle (confirmed with a planted key) | The app reads only its two settings; the hosted build searches the bundle for provider keys, hosts and the secret key and stops the deployment if it finds one |
| M3 | The service role could still erase who did what (deleting a profile nulls `actor`), backdate audit rows, and change approvals | Approvals are append-only for the service role too; every audit row is dated at insertion; `actor_ref` keeps who acted after a profile is deleted. Remaining: the service role can add a row in anyone's name (R-09) |
| M4 | The go-live order left sign-up open between deploying the app and changing the settings | Sign-up off and the password rules in step 1, and a check that `auth.users` holds only expected accounts |
| L1 | A slow profile result could show the previous person after a switch; signing out left their open response on screen; a changed role showed only after a reload | Results for someone no longer signed in are ignored; signing out resets every per-person view; the same person reported again refreshes the profile quietly |
| L2 | Each demo reset added the demo's recorded usage again, counting towards the budget | The reset replaces it |
| L3 | Setting secrets from the local `.env` would push every local setting | A hosted-only file, `.env.hosted.local`, from `.env.hosted.example`, with keys made for the demo |
| L4 | A missing chunk after a redeploy was answered with the page, failing as a script; the favicon and `bolt.new` preview tags were left from the prototype | Assets are no longer rewritten; an open tab reloads once on a missing chunk; favicon and description fixed |
| L5 | The build check accepted any https address, which the content security policy would then block | It requires a hosted Supabase project address. The policy allows any Supabase project rather than this one: the app only talks to its own, and the project address is not known when the file is written |
| L6 | The host installed whatever npm 11 was newest | Pinned to one version |
| L7 | Missing from the pack: two-factor sign-in, preview protection, the email rate limit, the cost of indexing on first sign-in | Added |
| L8 | The first-admin SQL wrote no audit row and failed silently on a different case | It matches case-insensitively, returns the row and writes the audit row |
| L9 | Anyone can ask for password-reset mail to the fictional addresses | The project's email rate limit is lowered to 10 an hour; a CAPTCHA is left for the backlog |

