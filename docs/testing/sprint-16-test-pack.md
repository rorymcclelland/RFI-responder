# Sprint 16 test pack: the last rough edges

**Your own account.** These cases run on the hosted demo at https://rfi-responder.vercel.app, signed in as you (the admin). Your password is in your password manager; it does not belong in this file or the chat. The demo holds synthetic data only.

About 20 minutes. Firefox is fine; cases 2 and 4 use its developer tools (F12).

Already checked by Claude: 975 unit and 330 database tests, CI on the local stack, and an independent security review (no high issue, three medium and seven low, all fixed and listed in `docs/refinement/sprint-16.md`). The loading screen and the steady knowledge-base box are not covered by automated tests, which do not draw the screens, so cases 1, 2 and 4 are the check.

| User | Email | Password | Role |
|---|---|---|---|
| You | your own address | in your password manager | Admin |

## Before you start: update the live demo

`main` has this sprint, and Vercel deploys it by itself. Your copy in `C:\Code\rfi-responder` is up to date. In PowerShell there:

1. `npx supabase db push`, then answer `Y`. It applies one migration, `20261104100000_save_entry_vectors.sql`.
2. `npx supabase functions deploy embed-entries process-questions`. Both now save vectors a batch at a time.
3. In Vercel, check the production deployment is the latest commit on `main`, then reload the app.

**Expected outcome:** no errors.

## Test cases

### 1. A response shows that it is loading (S16-1, BUG-39)

**Flow**

1. Press F12, open **Network**, and set the speed menu (it reads **No throttling**) to **Regular 3G**, so the loading is slow enough to see.
2. On **Opportunities**, open Bluefin.
3. Set the speed back to **No throttling**.

**Expected outcome**

- While it loads you see "Loading Bluefin…" and "Reading its questions and answers."
- Then its questions appear. At no point do you see the upload box ("New RFI Session") for it.

**Result:** ☐ Pass ☐ Fail. Notes:

### 2. A failed load says so, and Try again works (S16-1)

**Flow**

1. Go back to **Opportunities**. In **Network**, tick **Offline** (in the speed menu, or the checkbox beside it).
2. Open Bluefin.
3. Untick **Offline**, then choose **Try again**.

**Expected outcome**

- Offline, the response says "This response could not be loaded. Check your connection and try again." with **Try again**, and no upload box.
- After **Try again**, the questions appear, with no leftover error message above them.

**Result:** ☐ Pass ☐ Fail. Notes:

### 3. Adding an entry is confirmed at once (S16-2, BUG-40)

**Flow**

1. In **Governance**, **Demo**, reset the demo (type `reset the demo`, then **Reset the demo**). This removes the knowledge base's index, as the reset did before your Sprint 15 test.
2. Open **KB**, choose **Add entry**, add the question `Sprint 16 test entry?` with any answer, and choose **Add entry**. Note how long the confirmation takes.
3. Wait half a minute, then search the knowledge base for `Sprint 16 test`.

**Expected outcome**

- "KB-0133 added." appears within a second or two, not about ten.
- No message about indexing appears afterwards (one would mean indexing failed; tell me what it said).
- The entry is in the knowledge base.

**Result:** ☐ Pass ☐ Fail. Seconds to confirm: Notes:

### 4. The knowledge-base box stays still while you search (S16-3, BUG-38)

**Flow**

1. Open **KB** and type `encrypt` slowly into the search, then delete it, then type `zzzz` (no matches).
2. Press Ctrl+Shift+M for the phone-size view, choose a phone size, and open **KB** again.

**Expected outcome**

- The box and the search field stay where they are while the list changes, including when it shows "No entries match your search".
- In the phone-size view the box fills the screen and the list scrolls inside it.

**Result:** ☐ Pass ☐ Fail. Notes:

## When you have finished

Reply "all good", or the numbers of any failed cases with a screenshot. To tidy up, reset the demo again. The UX spike carries on in the meantime; it does not depend on these cases.
