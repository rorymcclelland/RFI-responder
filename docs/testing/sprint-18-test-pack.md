# Sprint 18 test pack: each answer's story, and asking the knowledge base

**Your own accounts.** These cases run on the hosted demo at https://rfi-responder.vercel.app. You sign in as yourself (the admin) and, for case 3, as the second you from the Sprint 15 pack (a member). Both passwords are in your password manager; they do not belong in this file or the chat. The demo holds synthetic data only.

About 40 minutes, plus about 10 for the screenshots at the end. Case 5 makes a few real AI calls (a few pence). Case 6 uses the phone-size view (Ctrl+Shift+M in Firefox).

Already checked by Claude:
- 1035 unit and 368 database tests, CI on the local stack (including `ask-knowledge`: its refusals, a draft, the pricing hold, nothing written, usage recorded, and the daily cap), and `npm run build`.
- An independent security review: no high issue, two medium and six low, all dealt with and listed in `docs/refinement/sprint-18.md`.
- The new screens, checked by eye against the demo data at desktop and phone widths.

The screens are not drawn in the automated tests, and the live AI calls are not made in CI, so cases 1 to 6 are the check.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |
| A second you | the member account from the Sprint 15 pack | in your password manager | Member |

## Before you start: update the live demo

`main` has this sprint, and Vercel deploys it by itself. Your copy in `C:\Code\rfi-responder` is up to date. In PowerShell there:

1. `npx supabase db push`, then answer `Y`. It applies three migrations: `20261106100000_entry_numbers_past_9999.sql`, `20261106110000_entry_detail.sql` and `20261106120000_retire_entries.sql`.
2. `npx supabase functions deploy ask-knowledge process-questions`. The first is new; the second now shares its set-up with it and knows about retired answers.
3. In Vercel, check the production deployment is the latest commit on `main`, then reload the app.
4. Signed in as you, under **Governance**, **Demo**, reset the demo (type `reset the demo`, then **Reset the demo**), so the numbers below match.

**Expected outcome:** no errors, and the reset says it is done.

## Test cases

### 1. One answer and its history (S18-2, K-2)

**Flow**

1. As you, choose **Knowledge**, then **Browse all answers**, and search `KB-0015`.
2. Choose KB-0015 in the list.
3. Search `KB-0001`, open it, and under **Other languages** choose its translation.

**Expected outcome**

- The breadcrumb reads "Knowledge / All answers / KB-0015". The page shows the answer, "Reviewed and current", its topics, its source and a **Next review** date.
- **A proposed change is waiting**: KB-0132, from Larkspur Health (fictional): data platform RFI, with **Approve the change** and **Decline the change**.
- **Where it has been used (1)**: Larkspur Health (fictional): data platform RFI, "How do you comply with GDPR?", approved after editing; the response is exported.
- **History**: "Loaded with the demo data".
- KB-0001's **Other languages** lists KB-0101, a Japanese translation to check; KB-0101's page says it was translated from KB-0001.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. Mark as still correct, and Edit (S18-2)

**Flow**

1. As you, open KB-0002 and choose **Mark as still correct**.
2. Choose **Edit**, add `, test` to the end of the topics, and choose **Save**.
3. Choose **Edit** again, change one word of the answer, and choose **Save**.

**Expected outcome**

1. "KB-0002 marked as still correct." The history gains "Reviewed by <you>: correct as it stands"; the next review is a year from today (the demo's review interval is 12 months).
2. "KB-0002 saved." The history gains "<you> changed the topics from … to …, test".
3. "KB-0002 corrected and reviewed." The history gains "Corrected and reviewed by <you>", with "Answer before:" and the original answer under it.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. A member sees the same page, without the admin's buttons (S18-2)

**Flow**

1. In a private window, sign in as the second you (a member) and open KB-0002.

**Expected outcome**

- The same page and history as in case 2, including your changes.
- No **Mark as still correct**, **Edit**, **Retire**, **Approve the change** or **Decline the change**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Retire, Restore and Decline (S18-3)

**Flow**

1. As you, open KB-0003 and choose **Retire**. Try **Retire it** with the reason `no` (too short), then type `Our access control framework is being rewritten.` and choose **Retire it**.
2. Go back to the overview (**Knowledge**), then **Browse all answers**. Tick **Retired** under State.
3. Open KB-0003 again and choose **Restore**.
4. Open KB-0070, and under **A proposed change is waiting** choose **Decline the change**, with the reason `Customer data stays in the UK and the EU, as now.`
5. Look at the overview, and at **Governance**, **Audit log**.

**Expected outcome**

1. **Retire it** stays unavailable until the reason has 5 characters. Then "KB-0003 retired.", and the page says "Retired on <today> by <you>: Our access control framework is being rewritten. It is no longer used for drafts, and its question is free for a new answer."
2. The overview says 129 answers. Browse leaves KB-0003 out; with **Retired** ticked it shows only KB-0003.
3. "KB-0003 restored."; it is back in browse and the overview says 130 answers.
4. "KB-0131 declined." KB-0070 no longer shows a proposed change; KB-0131's page says "Declined as a change to KB-0070 on <today> by <you>: …".
5. The overview says "1 proposed change to an existing answer is waiting for review too". The audit log shows the retirement, the restore and "Declined KB-0131, a proposed change to KB-0070. Reason: …".

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Ask it a question (S18-4, K-3)

**Flow**

1. On the Knowledge overview, under **Ask it a question**, type `How do you encrypt customer data at rest?` and choose **Ask**.
2. Choose the first answer under **Answers it drew on**.
3. Back on the overview, ask `What is the annual licence cost for 250 users?`
4. Ask `顧客データを保存時にどのように暗号化していますか？` (the same question in Japanese).

**Expected outcome**

1. "Matching, checking and drafting…" for a few seconds, then a draft drawn from the encryption answers, its confidence (High, Medium or Low, with a percentage), the checker's verdict and reason, and the answers it drew on (KB-0001 among them, marked as cited).
2. That answer's page opens.
3. "A person must answer pricing questions; none is drafted." No draft is shown.
4. A draft, with a line saying that in a response it would be held for a person to approve individually (for example because it crosses languages, or cites a translation not yet checked).
5. Nothing new appears among your responses; **Governance**, **Usage and limits** shows the month's spend a little higher.

**Result:** ☐ Pass ☐ Fail. Notes:

### 6. From a response, and on a phone (S18-2)

**Flow**

1. On **Responses**, open Bluefin, open the question "How do you protect data at rest in your platform?", and under **Knowledge-base sources** choose KB-0001. In the box that opens, choose **Open its page in Knowledge**.
2. Choose **Responses** and then **Knowledge** again.
3. Press Ctrl+Shift+M, choose a phone size, and on **Browse all answers** choose any answer, then **Back to the list**.

**Expected outcome**

1. KB-0001's page opens under Knowledge, and its **Where it has been used** includes Bluefin.
2. Knowledge opens on the overview, not on KB-0001.
3. At phone width the answer's page replaces the list. **Back to the list** returns to the list at that answer. Nothing scrolls sideways.

**Result:** ☐ Pass ☐ Fail. Notes:

## After the cases: retake the screenshots (S18-5)

On your PC, with Docker running, in `C:\Code\rfi-responder`:

1. `npx supabase start`, then `npx supabase db reset`. This is the local stack, not the live demo.
2. `npx supabase functions serve` in one window, so the ask can be photographed (it uses the keys in `supabase\functions\.env`; a few pence).
3. `npm run dev` in a second window.
4. `npm run screenshots` in a third.

**Expected outcome:** it lists 20 files, ending with `19-answer-page.png` and `20-ask.png`, then "Every view fits 768 px." (or names the views that do not). If the ask is not answered it says "20-ask.png skipped" and carries on. Tell me when it is done, and I will add the new pictures to the guide and close the sprint.

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot. To tidy up, reset the demo again: it undoes cases 2 and 4.
