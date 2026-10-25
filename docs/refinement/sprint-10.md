# Sprint 10 refinement: full documentation

Refined 25 October 2026 at Rory's request ("ensure that the project is fully documented, both technically, and in terms of user guides"), lightly, as he chose. Project rule 1 governs every page: nothing claims more than the code does, and the documentation is tested against the code so it cannot drift.

## What refinement found

- **The technical "why" is documented; the "what" and "how" are not.** The README, architecture page, seven decisions, deploying guide, governance pack and evaluation reports explain the design and its evidence. There is no reference for the data model and its access rules, the Edge Functions' requests and responses, or every setting; and no developer guide (how to add a migration safely, the role-matrix tests, the evaluations, the demo, the screenshots, CI).
- **There are no user guides.** Nothing tells a response owner, a specialist or an admin how to use the app, or what each label on a question card means (gates, verdicts, holds, confidence, provenance).
- **Settings live in two places**: environment files (`.env` for the app, `supabase/functions/.env` for the Edge Functions and evaluations) and the database (limits, budget and prices on the governance page). Both need a reference.

## Rory's answers (25 October 2026)

| Question | Answer |
|---|---|
| Where the user guides live | In the repository (`docs/guide/`) and in the app, through a Help link |
| Readers | All three roles: response owner, specialist (assignee) and admin, plus a reference to every label on a question card |
| Screenshots | Reuse and extend the screenshot script; one run on Rory's PC |
| Process | Sprint 10, lightly refined: test cases recorded, then build, an independent accuracy review, and a close |

## Stories

### S10-1 User guides (`docs/guide/`)

Pages: an index; getting started (signing in, roles, the screens); the response owner (a response from start to archive: create, upload a spreadsheet or Word file, check the questions, process, review, approve in bulk or one at a time, assign, export, learn, archive); the specialist (the inbox and deciding an assigned question); the admin (people and roles, the knowledge base: import, add, review, overdue; the governance page: spend, limits, budget, prices); the question card, label by label; and common problems.

**Test cases.**
1. Every UI label a guide names (written in bold) appears in the app's source exactly, so a renamed button fails the test; bold used for anything else is listed in the test as not a label.
2. Every link and screenshot in the guides exists.
3. Every role the app has, every gate and every bulk-approval hold reason in the code is explained on the card reference page (checked against the code's lists).
4. British spelling and no em dashes (the existing docs tests).

### S10-2 Help in the app

A **Help** link in the header opens the guides inside the app, starting at the page for the signed-in person's role. The guides are the same Markdown files, bundled at build time and shown by a small renderer that escapes everything (no HTML from the files is ever inserted), so the app and the repository cannot disagree.

**Test cases.** 1. The renderer escapes HTML and script in the source and supports only headings, paragraphs, lists, bold, code, links, tables and images. 2. Every guide page is reachable from the Help index, and links between guide pages open in the app. 3. Links outside the guides open in a new tab with `rel="noopener noreferrer"`. 4. The header still fits 768 px (the layout check).

### S10-3 Technical reference (`docs/technical/`)

Pages: data model and access (every table, view and function a signed-in user can reach, its access rule by role, with the migration and test that hold it); the Edge Functions (each one's request, response, authentication, limits and errors); configuration (every environment variable and database setting, where it is read, its default, and whether it is secret); and a developer guide (set-up, tests, adding a migration and its role-matrix tests, evaluations, recording the demo, screenshots, CI, how a sprint runs).

**Test cases.**
1. Every environment variable the code reads (app, Edge Functions, evaluations and scripts) is in the configuration reference, and every one there is read somewhere.
2. Every table, view and public function in the migrations is in the data model page.
3. Every Edge Function folder is documented, and every npm script is in the developer guide or the README.
4. Every path named exists (the existing docs tests, extended to the new folders).

### S10-4 Screenshots for the guides

`npm run screenshots` gains the views the guides need: the upload and column mapping, the Word preview, assigning a question, the inbox, the knowledge-base import, the governance limits. One run on Rory's PC; the layout check covers the new views.

**Test cases.** 1. Every screenshot a guide uses is produced by the script. 2. Every view fits 768 px.

### S10-5 Index, and an independent accuracy review

The README and the docs index point to the guides and the technical reference. A separate agent that has not seen the writing reads the guides and the reference against the code and reports anything they claim that the code does not do; every finding is fixed before the close.

### S10-6 Onboarding, shown once and available any time (added by Rory, 25 October 2026)

**The job.** Someone signing in for the first time learns what the app does and how a response goes from upload to export, without reading the guides; anyone can run it again later.

**Rory's answers.** A short dialog of steps, each a picture of the screen and a few lines (not a tour that points at the screen); remembered on the person's account, so it is shown once on any browser; content by role.

**What changes.**
- A dialog of steps: what RFI Respond is for; the overview of responses; uploading a spreadsheet or Word file; how a draft is made and what its confidence and checker mean; what is never approved in bulk and why; assigning to specialists and the inbox; export, provenance and what the knowledge base learns. Admins also get a step on people, the knowledge base and the governance page. Each step links to the guide page that covers it in full (S10-1).
- Roles: everyone sees the common steps, and the steps for running a response (any member can own one); admins see the admin step too.
- Shown automatically after the first sign-in, until the person finishes it or chooses **Skip**; available again at any time from the **Help** menu (S10-2), as **Show the introduction** or similar.
- Remembered on the account: a migration adds an `onboarded_at` column to `user_profiles`. A person can set only their own, and only that column; it is covered by the role-matrix tests (decision 0003).
- Keyboard and screen readers: focus moves into the dialog and back, Escape closes it (as Skip), and the steps are announced.

**Test cases.**
1. Database: a member can set their own `onboarded_at`; cannot set another person's; cannot change any other column through it; an admin cannot set it for someone else either (it is the person's own record of having seen it).
2. A person with no `onboarded_at` sees the dialog after signing in; finishing or skipping sets it and it does not appear again, on this or another browser.
3. **Show the introduction** opens it at any time, whatever `onboarded_at` says, and does not change it.
4. A member sees the common and response steps; an admin sees those plus the admin step.
5. Every UI label the steps name exists in the app, and every guide page they link to exists (as S10-1 test 1 and 2).
6. Escape closes it; focus returns to where it was; it fits a 768 px window.
7. If saving `onboarded_at` fails, the dialog still closes and the failure does not block the app (it is shown again next time).

**Size.** M. Depends on S10-1 (the guide pages it links to) and S10-2 (the Help menu).

## Found while building

Writing the guides and the technical reference meant reading every screen and function against what it claims. What that turned up:

- **BUG-29 (fixed).** The inbox showed an assignment's new stage, and saved notes, even when the database refused the change (for example after the response's export closed its assignments): the update affected no rows and reported no error. `src/lib/assignments.ts` now checks that a row changed and says so when it did not, the inbox reloads after each change, and marking yours approved approves the others on the same question only when you may (5 tests).
- **Fixed in the documentation.** The architecture page and the model card said each question stores "models and prompt versions"; it stores the matching, checking and drafting models and the drafting prompt's version only. Corrected. The limit messages pointed to a "Usage page" that the app calls **Usage and limits** on the governance page; reworded. `EXTRACT_MODEL` was missing from `supabase/functions/.env.example`; added.
- **For the close (code, not changed in this sprint).** From reading the Edge Functions: `embed` counts units against the daily cap even when it then refuses the request; `embed-entries` can report the daily limit when the monthly budget is the cause, and returns raw database error text on two 500s; a missing Voyage key gives a vague 500; nothing in the app calls `embed`; `rerank-3` has no price row, so its cost is recorded as unknown. From reading the data model: an assignee (or the owner) can still change a question on an exported but unarchived response, which reopens it; `purge_old_usage` is never scheduled; changes to `ai_prices` and an admin setting `kb_entries.superseded_by` directly are not audited; owners can set most columns of a new assignment; `handle_new_user` has `search_path = public` rather than empty; the settings, prices and learning thresholds are inserted by migrations, which the "no data in migrations" rule does not anticipate (they are configuration, not sample data). They are triaged at the close.

## Not in this sprint

New features. Translating the guides.

## The sprint as a whole

Order: S10-3 (reference, read from the code), S10-1 (guides), S10-2 (Help in the app), S10-6 (onboarding), S10-4 (screenshots, Rory's run, so the onboarding's pictures and the guides' come from one run), S10-5. About four days. No spike.
