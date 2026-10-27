# Sprint 15 test pack: polishing the live demo

**Your own accounts.** These cases run on the hosted demo at https://rfi-responder.vercel.app, signed in as you (the admin), and in case 5 as a second address of yours. Passwords are in your password manager; they do not belong in this file or the chat. The demo holds synthetic data only.

About 30 minutes. Use Chrome or Edge.

Already checked by Claude: every database test (including the role matrix through the moved helpers), CI on the local stack (`invite-user` refuses the anon key, a malformed address and a member; `rpc/is_admin` is no longer an endpoint), and the independent security review with every finding fixed. After your update below, Claude checks the live project read-only: the migrations, the security advisors, and that `is_admin` cannot be called through the API.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |
| A second you | another address of yours (or the reviewer from the Sprint 14 pack) | chosen in case 5 | Member |

## Before you start: update the live demo (S15-6)

`main` already has this sprint, and Vercel deploys it by itself. Your copy in `C:\Code\rfi-responder` is up to date. In PowerShell there:

1. `npx supabase db push`, then answer `Y`. It lists three migrations, `20261103100000` to `20261103120000`, and applies them without an error.
2. `npx supabase functions deploy invite-user`. It deploys `invite-user`.
3. In Supabase, open the **SQL Editor**, paste the whole of `supabase\demo-hosted-reset.sql` and choose **Run**. This resets the demo once by the old route, which also stores the reload script the new button uses, and numbers the entries from KB-0001 again. Your `Hosted check` response from Sprint 14 goes with it.
4. In Vercel, check the production deployment is the latest commit on `main`.

**Expected outcome:** no errors. `select count(*) from kb_entries;` returns 132.

Then reply "updated", and I check the live project before you start the cases.

## Test cases

### 1. Search the knowledge base by number (S15-1, BUG-36)

**Flow**

1. Sign in, open **KB**.
2. Search `KB-0101`, then `kb0101`, then `101`.

**Expected outcome**

- `KB-0101` and `kb0101` each show one entry, KB-0101, labelled **Japanese**.
- `101` shows KB-0101 and any entry whose text contains "101".
- The search box reads "Search numbers, questions, answers, tags…".

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. Everything still works after the access changes (S15-2, S15-3)

**Flow**

1. Open the response that is in review (Bluefin). Expand a pending question, choose **Edit First**, add a word, and **Save & Accept**.
2. Open **Governance**: **Usage and limits**, **Entries to review** and **Audit log**.

**Expected outcome:** the answer saves and the question shows as accepted; each governance tab loads with no error message.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. Reset the demo from the app (S15-4, F-63)

**Flow**

1. Open **KB**, choose **Add entry**, and add a question `Sprint 15 test entry?` with any answer.
2. Open **Governance**, then the new **Demo** tab. Read the text, and note **Last reset**.
3. Type `Reset the demo` (capital R) in the box: the button stays unavailable. Change it to `reset the demo`, then choose **Reset the demo**.
4. Open **KB** and search `Sprint 15 test`, then `KB-0101`.
5. Open **Audit log** and choose **Demo resets** under **Show**.

**Expected outcome**

- **Last reset** reads "never" at first (the SQL route does not set it).
- While it runs the button reads **Resetting…**; then "The demo is reset: 132 knowledge-base entries and 4 responses. The reset is in the audit log." appears beside it, and **Last reset** shows now.
- Your test entry is gone; KB-0101 is the Japanese entry; Bluefin is back as it was, with the question from case 2 pending again.
- The audit log shows "Reset the demo: 132 knowledge-base entries and 4 responses loaded again; everything else removed." with your name.
- You are still signed in and still an admin; your limits are unchanged.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Invite someone from the app (S15-5, F-3)

**Flow**

1. Open **Team**. Under **Invite someone**, give your second address and a name, and choose **Send invitation**.
2. Open the email, follow the link, choose a password (12 characters or more, letters and digits), and sign in.
3. As them: look at the menu, and open **Team**.
4. Sign out, sign back in as you, and open **Audit log** with **Admin rights and invitations** under **Show**.

**Expected outcome**

- While sending the button reads **Sending…**; then "Invitation sent to <address>. They join as a member." The person appears on the **Team** page.
- The email comes from your sending domain and opens **Welcome: choose a password**.
- As them there is no **Governance** in the menu, and **Team** has no **Invite someone** form.
- The audit log shows "Invited <their name> as a member." by you.

If you reuse the Sprint 14 reviewer's address, expect case 5's message instead; use a new address for this case.

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Invitations that are refused (S15-5)

**Flow**

1. As you, on **Team**, invite the same address as in case 4 again.
2. Invite `not-an-address@` (type it and choose **Send invitation**).

**Expected outcome**

- The first says "<address> already has an account. Nothing was sent." and no email arrives.
- The second is stopped, either by the browser ("Please enter a part following '@'") or with "That is not an email address the app can invite."

**Result:** ☐ Pass ☐ Fail. Notes:

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot of what you saw. Then I close the sprint: the backlog, the risk register, the README and the project docs. To tidy up, you can delete the second account in Supabase (**Authentication**, **Users**), or keep it as a reviewer.
