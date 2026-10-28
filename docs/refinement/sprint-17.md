# Sprint 17 refinement: one vocabulary, honest controls, and the knowledge base as a full page

Refined 28 October 2026, the first slice of option B from the Sprint 16 UX spike (`docs/ux/sprint-16-ux-spike.md`): U-1 one vocabulary, U-2 controls only for those who can use them, and K-1 the knowledge base as a full page, replacing the pop-up (Rory: the knowledge base is the value proposition, so it should be fully featured and fill the screen). The data model and the access rules do not change.

## What refinement found

- **The vocabulary problem is concentrated.** "Opportunity" appears in the navigation, the overview's heading and buttons, the new-response dialog and the breadcrumb (`App.tsx`, `OpportunitiesDashboard.tsx`); "RFI Session", "Previous Sessions" and "Other Sessions" in the upload step (`workspace/UploadStep.tsx`); "KB" on the header button and the import dialog. The guide and the introduction use the same words, and the guide test already fails if the guide bolds a label the app does not show, so renaming in the app forces the guide to follow.
- **Two status words clash today.** "In review" is a response stage on the overview and an assignment stage in the inbox; "Medium" is 40 to 80% in the confidence filter (`RFIWorkspace.tsx`) and at least 60% on the bulk button. The workspace counts say accepted, pending and skipped, while the overview says "decided".
- **The upload is offered to people who cannot upload.** `UploadStep` and **New upload** are shown whenever the response is not archived; only the owner or an admin may add a file, so a member fills in the steps and then gets the database's refusal. The bulk bar is shown, disabled, to everyone. The reasons for disabled controls (**Record export**, **Won** and **Lost**) are only in a tooltip, and the archive control appears only on hover.
- **The At risk and Overdue tiles cannot be clicked** (`OpportunitiesDashboard.tsx`), though they are the overview's most urgent counts.
- **Everything K-1 needs is readable already.** Signed-in users may read every knowledge-base entry and every question, so the overview's counts (by state, language, topic, author, citations) can come from one invoker function, which reads under the caller's own rights. Searching **by meaning** needs a server call (the question must be embedded); that is the job of K-3, **Ask it a question**, next sprint.
- **Reviewing stays where it is for now.** Approving, correcting and marking an entry still correct are in **Governance** today; K-2 (next sprint) brings them onto each answer's page. Until then the knowledge page links to them.
- **Screenshots will be out of date.** The guide's screenshots show the old labels. The screenshot script runs only on Rory's PC against the local stack, so new ones need him to run it (Q4).

## Stories

### S17-1 One vocabulary. S (U-1)

**The job.** Everyone meets one word for each thing, the same in the app, the guide and the introduction.

**What changes.**
- **Response**, never Opportunity: the navigation item **Responses**, **New response**, the overview's heading, the dialog, the breadcrumb.
- **Files**, never sessions: the upload step is headed **Add the questions**; earlier files are **Files in this response**; files not linked to any response are no longer listed in every response (an admin sees them in Governance only if any exist, which on the demo none do).
- **Knowledge**, never KB, in labels (entry numbers keep their `KB-` prefix).
- **Status words** (Q2): a response is **No questions yet**, **In progress**, **Ready to send**, **Exported**, **Changed since export**, **Archived**; a question is **To do**, **Approved** or **Not answered**, everywhere (counts, filters, cards); an assignment's middle stage is **Working on it**, not In Review; the confidence filter's bands match the bulk buttons: **High ≥80%**, **Medium 60–80%**, **Low <60%**. Export words stay until U-6 (Sprint 20) separates downloading from marking as sent.
- `docs/GLOSSARY.md`: each word, what it means, and the words not to use; a docs test fails if a retired word appears in the app's visible text, the guide or the introduction.
- The guide and the introduction updated; database tables, functions and code names unchanged.

**Test cases.**
1. No visible text in `src/` (labels, headings, buttons, messages, the introduction) uses Opportunity, RFI Session, Previous Sessions, Other Sessions or KB as a word; the test scans JSX text and string literals, and allows code identifiers and `KB-` numbers.
2. The guide and introduction use the glossary's words only (the same test over `docs/guide/` and `src/lib/onboarding.ts`).
3. The overview's stage labels, the workspace's counts and filters, and the inbox's stages use the agreed words; "In review" appears nowhere.
4. The confidence filter's Medium band is 60 to 80%, matching **Medium ≥60%**; a question at 59% is Low, at 60% Medium (unit test on the band function).
5. The existing guide test still passes: every bolded label exists in the app.

### S17-2 Controls only for those who can use them. S (U-2)

**The job.** Nobody is offered something they cannot do, and anything unavailable says why where it is, not on hover.

**What changes.**
- The upload step and **New upload** only for the owner or an admin. Anyone else opening a response with no questions sees "Sarah Chen, the owner, adds the questions. You can follow along here."
- The bulk bar only for the owner or an admin; others see one line: "Approving in bulk is for the owner (Sarah Chen) or an admin."
- A question card that the person cannot decide says so in its body ("Only the owner, an admin or someone asked to answer this can decide it"), instead of showing no buttons.
- **Record export** shows its reason as text beside it while unavailable ("3 questions still to do"); **Won** and **Lost** say why when unavailable.
- The archive and delete controls on a response card are always visible, not only on hover.
- The **At risk** and **Overdue** tiles filter the list like the others.

**Test cases.**
1. A member who is not the owner and not assigned: no upload, no **New upload**, no bulk bar; the explanation lines appear (unit tests on a pure `workspaceControls(role)` function returning what to show and why, for owner, admin, assignee, member, and archived).
2. The owner and an admin see everything they did before.
3. An assignee sees decision buttons on their question only, and the explanation on the others.
4. **Record export**, **Won** and **Lost** show their reason as visible text when unavailable (the reason strings are tested).
5. Choosing **At risk** or **Overdue** shows only those responses; choosing it again clears it.
6. The database still refuses the same things as before (no access rule changes; the role matrix tests pass unchanged).

### S17-3 The knowledge base as a full page. M (K-1)

**The job.** Anyone can see what the organisation knows and find any answer, on a page of its own that fills the screen.

**Before and after.** Today **KB** opens a pop-up list with a search box. After, **Knowledge** is in the main menu beside Responses (Home stays where people land until U-4), with two views, as in mockups 7 and 8.

**What changes.**
- **Overview** (`/knowledge`): how many approved answers, in which languages, from how many people; health counts that link into browse with the matching filter (reviewed and current, waiting for review, translations to check, overdue for review); answers by topic (from tags), with how many times each topic's entries were cited; learned recently (the latest entries learned from responses, with where from); **Add an answer** and **Import a spreadsheet**, moved here from the pop-up and the overview of responses.
- **Browse**: search by number or words (S15-1's rule), filters for state, language and where it came from (imported, learned from a response, added by hand), sort by number, most cited or oldest review; the list beside the selected answer, which shows its answer, tags, source, origin in words, reviewed date and, for admins, a link to review it in Governance until K-2.
- One new database function, `knowledge_overview()`, security invoker (it reads under the caller's own rights), returning the counts, topics and citations; tested for every role.
- The pop-up is removed; links that opened it (a draft's sources, the header) go to the page.
- The guide's knowledge-base section and the introduction updated.

**Test cases.**
1. The overview's counts equal what the entries hold: on the demo data, the total, each language and each state match a direct count of the table (database test on the demo seed).
2. Topic counts and citation counts are right for a small fixture (two topics, three entries, questions citing them twice and once), including an entry with no tags (counted under "No topic").
3. Role matrix: a member and an admin get the same overview; an anonymous visitor gets nothing; the function cannot change anything.
4. Browse filters combine (Japanese and waiting for review), the search still finds by number and words, and sorting by most cited and oldest review orders correctly (unit tests on a pure filter-and-sort function).
5. The selected answer shows its origin in words for each origin (imported, manual, learned from a response, translated).
6. At phone width the overview's tiles stack and browse shows the list, then the selected answer below it (checked by hand in the test pack).
7. Hostile: entry text with markup is shown as text; a search of 100,000 characters does not hang.

### S17-4 Guide, introduction and screenshots for the changed screens. S

The guide pages and the introduction steps that show these screens are rewritten in the glossary's words; the screenshots that show them are retaken by Rory on his PC with `npm run screenshots` (Q4), or marked as out of date until U-10.

## The sprint as a whole

Order: S17-1 first (every later string uses its words), then S17-2 and S17-3, then S17-4, the security review, the live update (one migration; the app deploys itself), the test pack and the close. Sizes: three S and one M, about two days. No spike: nothing here depends on an unknown.

## Questions for Rory (answered 28 October 2026)

| | Question | Recommended |
|---|---|---|
| Q1 | The name for what is now an "Opportunity" | **Response** (the product brief's word; "a questionnaire" is what arrives, "a response" is what you build and send) **Rory: agreed** |
| Q2 | The status words | As in S17-1: a response is No questions yet, In progress, Ready to send, Exported, Changed since export, Archived; a question is To do, Approved or Not answered; an assignment's middle stage is Working on it; Medium means 60 to 80% everywhere **Rory: agreed** |
| Q3 | Search by meaning in the new browse | Not this sprint: words and numbers now; meaning comes with **Ask it a question** (K-3, Sprint 18), which needs a server call **Rory: agreed** |
| Q4 | The guide's screenshots | You retake them on your PC with `npm run screenshots` at the close (about 10 minutes, Docker running); otherwise they are marked out of date until U-10 **Rory: agreed, he retakes them** |
| Q5 | Walk the live demo together before building | Not needed now: the spike's findings were confirmed in the code; walk it in the test pack instead (not asked again; Rory has not asked for it) |
