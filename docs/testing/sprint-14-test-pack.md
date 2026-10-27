# Sprint 14 test pack: the hosted demo

**Your own account.** These cases run on the hosted demo at https://rfi-responder.vercel.app, signed in as you (the admin you created in go-live step 8). Your password is in your password manager; it does not belong in this file or the chat. The demo holds synthetic data only.

Commit `693503d` or later on `main` (Vercel deploys it by itself; check the Vercel dashboard shows that commit as the production deployment). About 30 minutes. Use Chrome or Edge, with the developer console open (F12, then **Console**) for case 8.

Already checked by Claude before this pack (27 October): the project's security advisors (no errors; the warnings are listed in the sprint review), the 56 migrations applied, the 132 entries indexed, the fictional people unable to sign in, the audit log and approvals locked against the service role, the limits as set in step 9, the security headers on the live site, a deep link loading the app, and a missing file answered with a 404.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |

## Test cases

### 1. The demo data is there (S14-2)

**Flow**

1. Sign in at https://rfi-responder.vercel.app.
2. Look at **Opportunities**, then open **KB** and search for `KB-0101`.

**Expected outcome**

- Four responses, each marked "(fictional)", at their stages (new, in review, exported, archived).
- The knowledge base has 132 entries; KB-0101 is labelled **Japanese**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. Switching away and back keeps your place (S14-6, BUG-34)

**Flow**

1. Open the response that is in review (Bluefin). Expand a question's card, choose **Edit First**, and type a few words into the answer without saving.
2. Switch to another application for about a minute, then come back to the browser.
3. Open **KB** (the modal), switch away again, and come back.

**Expected outcome**

- The card is still expanded and your unsaved words are still in the answer.
- The knowledge-base modal is still open.
- No full-page loading screen appears at any point.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. Processing works on the hosted demo, and is charged to the budget

**Flow**

1. On **Opportunities**, choose **New Opportunity**, name it `Hosted check`, and choose **Create**.
2. Upload `sample-data\checks\sprint-13-questions.csv`, keep the `Question` column, and choose **Match and draft**.
3. When it finishes, open **Governance**, then **Usage and limits**.

**Expected outcome**

- All four questions are processed, with drafts and checker verdicts, and no error message.
- The usage shows this month's spend above zero and well under the £5 budget.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Save limits says it worked (BUG-35)

**Flow**

1. In **Governance**, **Usage and limits**, change **Questions per person per day** from `50` to `51` and choose **Save limits**. Then set it back to `50` and save again.

**Expected outcome**

- While saving, the button reads **Saving…** and cannot be clicked again.
- Then "Saved. The change is in the audit log." appears beside the button.
- **Audit log** lists both changes.

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Exports download from the hosted app

**Flow**

1. In `Hosted check`, accept the four questions (write an answer where there is no draft) and choose **Record export**.
2. Download **Excel (.xlsx)** and **Word (.doc)**.

**Expected outcome:** both files download and open, with the answers and the provenance (the **Translation** column reads "drafted from English entries" for the second question if its draft was translated).

**Result:** ☐ Pass ☐ Fail. Notes:

### 6. The guide and the introduction show their pictures

**Flow**

1. Open **Help**, then **Running a response**, and scroll to a screenshot.
2. Choose **Show the introduction**.

**Expected outcome:** the screenshots appear in both; nothing shows as a broken image.

**Result:** ☐ Pass ☐ Fail. Notes:

### 7. Nobody can sign in as a fictional person (S14-2)

**Flow**

1. Sign out. Try to sign in as `sarah.chen@example.invalid` with any password, for example `NotARealPassword1`.

**Expected outcome:** the sign-in is refused. Nothing about whether the account exists is shown beyond the usual error.

**Result:** ☐ Pass ☐ Fail. Notes:

### 8. The security policy blocks nothing the app needs (S14-3)

**Flow**

1. With the console open (F12, **Console**), sign in again and visit **Opportunities**, a response, **KB**, **Governance** and **Help**.

**Expected outcome:** no console message mentioning "Content Security Policy" or "Refused to". Other messages (for example a 404 for a missing favicon in an old tab) do not matter here; tell me if you are unsure.

**Result:** ☐ Pass ☐ Fail. Notes:

### 9. A reviewer's invitation (go-live step 10)

**Flow**

1. Invite one reviewer (or a second address of yours) from Supabase, **Authentication**, **Users**, **Invite user**.
2. Follow the invitation as them, set a password, and sign in.

**Expected outcome**

- The email arrives from your domain and opens **Welcome: choose a password**.
- Signed in as them, there is no **Governance** in the menu: they are a member.

**Result:** ☐ Pass ☐ Fail. Notes:

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot of what you saw. Then I close the sprint: the README and governance pages (S14-5) saying what is hosted, the backlog, the risk register and the project docs. To tidy up afterwards, you can delete the `Hosted check` response or reset the demo.
