# Sprint 17 test pack: one vocabulary, honest controls, knowledge as a page

**Your own accounts.** These cases run on the hosted demo at https://rfi-responder.vercel.app. You sign in as yourself (the admin) and, for case 3, as the second you from the Sprint 15 pack (a member). Both passwords are in your password manager; they do not belong in this file or the chat. The demo holds synthetic data only.

About 30 minutes, plus about 10 for the screenshots at the end. Firefox is fine; case 5 uses its phone-size view (Ctrl+Shift+M).

Already checked by Claude:
- 1004 unit and 338 database tests, CI on the local stack, and `npm run build`.
- A test that scans every visible string in the app and the guide for the retired words.
- An independent security review: no high issue, three medium and three low, all fixed and listed in `docs/refinement/sprint-17.md`.

The screens are not drawn in the automated tests, so cases 1 to 6 are the check of how they look.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |
| A second you | the member account from the Sprint 15 pack | in your password manager | Member |

## Before you start: update the live demo

`main` has this sprint, and Vercel deploys it by itself. Your copy in `C:\Code\rfi-responder` is up to date. In PowerShell there:

1. `npx supabase db push`, then answer `Y`. It applies one migration, `20261105100000_knowledge_overview.sql`. No functions need deploying.
2. In Vercel, check the production deployment is the latest commit on `main`, then reload the app.
3. Signed in as you, under **Governance**, **Demo**, reset the demo (type `reset the demo`, then **Reset the demo**), so the numbers below match.

**Expected outcome:** no errors, and the reset says it is done.

## Test cases

### 1. One vocabulary (S17-1, U-1)

**Flow**

1. Look at the menu, the overview of responses and its tiles.
2. Open **Bluefin Freight (fictional): security questionnaire**. Look at the counts, the filter tabs and one question card.
3. Open **Assignments**.

**Expected outcome**

- The menu reads **Responses**, **Knowledge**, **Assignments**, **Team**, **Governance**. There is no **KB** button in the top bar.
- Stages read No questions yet, In progress, Ready to send, Exported, Changed since export, Archived. The button for a new response reads **New response**.
- In Bluefin the filters read **All**, **To do**, **Approved**, **Not answered**. The buttons read **Approve** or **Save & approve**, and **Leave unanswered**.
- Nowhere do you see Opportunity, RFI Session, KB (as a word), In review, Accept, Skip or Pending. Entry numbers such as KB-0012 are fine.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. Every tile filters (S17-2, U-2)

**Flow**

1. On **Responses**, choose the **At risk** tile, then choose it again.
2. Do the same with **Overdue**, then with **In progress**.

**Expected outcome**

- Each tile, when chosen, shows only the responses it counts (an empty list is right if its number is 0), and looks pressed.
- Choosing it again shows every active response again.
- The archive and delete icons on a card are always visible, not only on hover.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. A member is not offered what they cannot do (S17-2)

**Flow**

1. Signed in as you, open Bluefin. Note the **Approve in bulk** bar and **Record export**.
2. In a private window, sign in as the second you (a member) and open Bluefin.

**Expected outcome**

- As you (admin): the bulk bar is there. Beside **Record export** you read why it is unavailable, without hovering, for example "8 questions are still to do: approve each or leave them unanswered first." (the number is Bluefin's to-do count).
- As the member:
  - There is no **Add a file** and no bulk bar.
  - In their place you read "Approving in bulk is for the owner (Priya Sharma) or an admin."
  - You can still read every question and its draft.

**Result:** ☐ Pass ☐ Fail. Notes:

### 4. The Knowledge page: what we know (S17-3, K-1)

**Flow**

1. As you, choose **Knowledge** in the menu.

**Expected outcome**

- The heading is **What we know**, with the line "130 answers, 100 in English and 30 in Japanese, added by 1 person."
- The four tiles read:
  - 100 reviewed and current;
  - 0 waiting for an admin's review;
  - 30 machine translations to check;
  - 0 overdue for review.
- Under the tiles: "2 proposed changes to existing answers are waiting for review too…", and a **Review entries** link (you are an admin).
- **By topic** starts with compliance (16 answers). Each topic shows how often it was cited.
- **Learned recently** lists two answers. One reads "KB-0132, a proposed change to KB-0015 · from Larkspur Health (fictional): data platform RFI · waiting for review". Neither shows a string of letters and numbers as its source.

**Result:** ☐ Pass ☐ Fail. Notes:

### 5. Browsing all answers (S17-3)

**Flow**

1. Choose the **machine translations to check** tile.
2. Choose **Browse all answers** (or **Knowledge / All answers**, then clear the filters). Search `KB-0101`, then `101`, then `encrypt`.
3. Clear the search. Tick **Japanese** under Language, then also **Reviewed and current** under State.
4. Under Sort, choose most cited.
5. Choose a learned answer under **Learned recently** (go back to the overview first).
6. Press Ctrl+Shift+M, choose a phone size, and look at the overview and the browse view.

**Expected outcome**

1. The translations tile shows 30 answers, all Japanese, and the first one is selected beside the list with where it came from ("Machine translation of KB-00…").
2. Both `KB-0101` and `101` find KB-0101. `encrypt` finds answers by their words.
3. **Japanese** alone shows 30. With **Reviewed and current** as well it shows only answers that are both: none on the reset demo, since every Japanese answer is a translation still to check, and the page says "No answers match. Clear a filter or change the search."
4. Most cited puts the most cited answers first.
5. A learned answer opens the answer it would change (KB-0015 or KB-0070), which is the current one.
6. At phone width the tiles stack one above another. Browse shows the list, then the selected answer below it. Nothing scrolls sideways.

**Result:** ☐ Pass ☐ Fail. Notes:

### 6. Adding an answer, and the introduction (S17-3, S17-4)

**Flow**

1. As the member, on **Knowledge**, choose **Add an answer**. Add the question `Sprint 17 test entry?` with any answer, and save.
2. As you, reload **Knowledge**.
3. As you, choose **Help**, then **Show the introduction**, and step through with **Next**.

**Expected outcome**

1. It is confirmed within a second or two with its number (KB-0133).
2. **waiting for an admin's review** now reads 1, and the total 131.
3. After "Export, and the knowledge base learns" comes "What we know", about the Knowledge page (no picture yet; it arrives with your screenshots). Then comes the admin step.

**Result:** ☐ Pass ☐ Fail. Notes:

## After the cases: retake the screenshots (S17-4, your answer to Q4)

On your PC, with Docker running, in `C:\Code\rfi-responder`:

1. `npx supabase start`, then `npx supabase db reset`. This is the local stack, not the live demo.
2. `npm run dev` in one window.
3. `npm run screenshots` in another. It refuses to run against anything but your local stack.

**Expected outcome:**
- It lists 18 files ending with `17-knowledge.png` and `18-knowledge-browse.png`, then "Every view fits 768 px." (or names the views that do not).
- Tell me when it is done. I'll fetch the pictures from `docs\screenshots`, add the two new ones to the guide and the introduction, and commit them.

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot. To tidy up, reset the demo again (it removes KB-0133).
