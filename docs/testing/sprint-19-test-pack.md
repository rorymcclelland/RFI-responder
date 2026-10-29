# Sprint 19 test pack: questions for you, and Home

**Your own accounts.** These cases run on the hosted demo at https://rfi-responder.vercel.app. You play two people:
- **You**, the admin, assign questions and decide them, as an owner would.
- **The second you** (the member account from the Sprint 15 pack) answers them, in a private window.

Both passwords are in your password manager; they do not belong in this file or the chat. The demo holds synthetic data only.

About 40 minutes, plus about 10 for the screenshots at the end. No AI calls are needed on the demo.

Already checked by Claude:
- 1064 unit and 377 database tests, and CI on the local stack.
- An independent security review: no high issue, three medium and six low, all fixed and listed in `docs/refinement/sprint-19.md`.
- The new screens, checked by eye against the demo data (James sees Priya's Bluefin question; Priya sees Bluefin at risk).

The screens are not drawn in the automated tests, so cases 1 to 6 are the check.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |
| The second you | the member account from the Sprint 15 pack | in your password manager | Member |

## Before you start: update the live demo

`main` has this sprint, and Vercel deploys it by itself. Your copy in `C:\Code\rfi-responder` is up to date. In PowerShell there:

1. `npx supabase db push`, then answer `Y`. It applies one migration, `20261107100000_my_assignments.sql`. No functions need deploying.
2. In Vercel, check the production deployment is the latest commit on `main`, then reload the app.
3. As you, under **Governance**, **Demo**, reset the demo (type `reset the demo`, then **Reset the demo**).

**Expected outcome:** no errors, and the reset says it is done.

## Choosing the questions

In cases 2 to 5 you assign three questions from Bluefin to the second you. On **Responses**, open **Bluefin Freight (fictional): security questionnaire**, choose the **To do** filter, and pick three that are not about pricing or liability. Call them A, B and C, and note their first words here:

A: ______________________ B: ______________________ C: ______________________

## Test cases

### 1. Home, as you (S19-3)

**Flow**

1. Sign in as you.
2. Look at **Needs you**, then choose the line under **For admins**.
3. Back on **Home** (first in the menu), look at **Your responses** and **What we know**.

**Expected outcome**

1. The app opens on **Home**, first in the menu, with "Hello, <your first name>".
2. **Needs you** has **For admins**: "Answers to review", with "30 translations to check, 2 proposed changes". Choosing it opens **Knowledge**, **All answers**, with **Waiting for review**, **Translation to check** and **Overdue for review** ticked.
3. **Your responses** says you own none in progress. That is right: the demo's responses belong to its fictional people. **What we know** says 130 answers, with **Open Knowledge** and **Ask it a question**.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. A question for the second you (S19-1)

**Flow**

1. As you, in Bluefin, open question A. Under **Expert Assignment** choose **Assign for review**, then **Assign** beside the second you.
2. In a private window, sign in as the second you.
3. On **Home**, choose question A under **Questions for you**.
4. Choose **Add Notes**, type `Checking with the SOC.`, and choose **Save notes**.

**Expected outcome**

1. The question shows them as assigned.
2. The second you lands on **Home**, where **Questions for you (1)** lists question A, "<your name> asked you · Bluefin Freight (fictional): security questionnaire · due …".
3. **Assignments** opens on **Questions for you**, with question A chosen:
   - its draft in **Your answer**;
   - its confidence and checker;
   - the answers it was drawn from (each opens its page under Knowledge);
   - **Open it in the response**;
   - "Working on it."
4. "Notes saved.", and the note shows on the question.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. Send to the owner, and the owner uses it (S19-1, S19-2)

**Flow**

1. As the second you, change a word in **Your answer** and choose **Send to the owner**.
2. As you, reload **Home** and choose question A under **Answered by colleagues**.
3. On question A's card, choose **Use their answer**, then **Save & approve**.

**Expected outcome**

1. "Sent to the owner, who decides." The question stays to do.
2. **Answered by colleagues** lists question A, "<the second you's name> answered · Bluefin…". Choosing it opens Bluefin at question A, its card open, in the right file.
3. The card shows "<name> marked it answered, with this answer:" with the edited text and the notes. **Use their answer** puts it in the editor; after **Save & approve** the question is **Approved**, by you.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. Hand back (S19-1)

**Flow**

1. As you, assign question B to the second you.
2. As the second you, reload **Assignments**, choose question B, then **Hand back**. Try **Hand it back** with `no`, then type `Ask the legal team.` and choose **Hand it back**.
3. As you, reload **Home**, then open question B's card in Bluefin.

**Expected outcome**

1. The assignment shows on question B.
2. **Hand it back** stays unavailable until the note has 5 characters. Then: "Handed back to the owner, with your note."
3. Home lists question B under **Answered by colleagues**: "<name> handed this back: Handed back: Ask the legal team. · Bluefin…". The card shows "<name> handed this back:" with the note.

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Approve, and when the owner was quicker (S19-1)

**Flow**

1. As you, assign question C to the second you.
2. As the second you, reload **Assignments**, choose question C and leave it open.
3. As you, approve question C on its card (**Approve**).
4. As the second you, without reloading, choose **Approve**.
5. As you, open the Bluefin card of any other question still to do, assign it to the second you, and as the second you choose **Approve** at once.

**Expected outcome**

4. "The owner has already decided this question since you opened it, so nothing was changed. The list now shows their decision." Question C moves to **Decided**, and the answer you approved is unchanged.
5. "Approved. The owner will see it as decided." In Bluefin the question is **Approved**, and the second you is recorded as approving it.

**Result:** ☐ Pass ☐ Fail. Notes:

### 6. On a phone, and the old lists (S19-3)

**Flow**

1. As the second you, press Ctrl+Shift+M, choose a phone size, and look at **Home** and **Assignments**.
2. As you, on **Assignments**, choose **Sent**.

**Expected outcome**

1. Home's parts stack one above another; the question list and the question stack too; nothing scrolls sideways.
2. **Sent** lists the questions you assigned, with their stages (**Asked**, **Working on it**, **Answered**, **Approved**). There are no buttons to move a stage on by hand.

**Result:** ☐ Pass ☐ Fail. Notes:

## After the cases: retake the screenshots (S19-4)

On your PC, with Docker running, in `C:\Code\rfi-responder`:

1. `npx supabase start`, then `npx supabase db reset` (the local stack).
2. `npx supabase functions serve` in one window (for the ask picture; a few pence).
3. `npm run dev` in a second window.
4. `npm run screenshots` in a third.

**Expected outcome:** it lists 21 files, including `21-home.png` and a new `5-assignments.png` (questions for you), then "Every view fits 768 px." Tell me when it is done; I add the new pictures to the guide and the introduction and close the sprint.

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot. To tidy up, reset the demo again.
