# RFI Respond: independent heuristic walk-through

Written by an independent agent that did not see the spike's own analysis (Sprint 16, S16-4), kept as written apart from one correction marked in place. The admin introduction it found out of date was fixed the same day.

Input to the Sprint 16 UX spike. Written from the code under `src/` (treated as the truth), the guide in `docs/guide/` and the screenshots in `docs/screenshots/`, 28 October 2026. Nothing was run; behaviour is read from the code. Step counts are clicks or decisions on the shortest successful path; concept counts are the terms a person must already understand to take the next step.

## How the app is organised today

The top bar (`App.tsx`) has **Opportunities**, **Assignments**, **Team**, **Governance** (admins), then **Help**, **KB** (with an entry count) and the user. Every sign-in lands on **Opportunities**, whoever you are (`useState<AppView>('opportunities')`). These five destinations are the five main tables: `opportunities`, `question_assignments`, `user_profiles`, the admin settings and review tables, and `kb_entries`. Inside an opportunity the workspace (`RFIWorkspace.tsx`) is a state machine over one `rfi_sessions` row at a time (upload, mapping, preview, processing, review, export).

## 1. Response owner

### 1a. "A questionnaire has arrived; get it answered and sent by the due date"

| # | Screen | Action or decision | Concepts needed |
|---|---|---|---|
| 1 | Sign-in (`AuthPage.tsx`) | Sign in ("Welcome back", even the first time after setting a password) | |
| 2 | Introduction (`help/Introduction.tsx`) | Next through 8 steps, or Skip | |
| 3 | Opportunities | Decide that a questionnaire is an "Opportunity"; choose **New Opportunity** | Opportunity |
| 4 | New Opportunity dialog | Name, due date, **Create** | |
| 5 | Workspace, **New RFI Session** | Drop or browse to the file | RFI Session |
| 6 | **Map Your Columns** (spreadsheet) or **Check the questions** (Word) | Confirm the question column, **Match and draft**; or edit the list, **Save and match** | column mapping |
| 7 | Processing | Wait ("Matching, checking and drafting n / N") | |
| 8 | Review | Read the bulk bar, the 4 status filters, the 4 confidence filters and the red low-confidence alert | pending, accepted, skipped, confidence, calibrated |
| 9 | Bulk bar | Choose **High ≥80%**, **Medium ≥60%** or **All eligible** | bulk accept, eligible, held |
| 10 | Each held card | Expand; read **Confidence**, **Similarity**, **Checker**, **KB Sources**, a gate badge; then **Accept**, **Edit First**, **Write an answer** or **Skip** | similarity, checker, KB entry IDs, 8 gate types, draft kind |
| 11 | Some cards | **Expert Assignment**, **Assign for review**, **Assign** (then job 1c) | assignment |
| 12 | Bulk bar | **Record export** (greyed until nothing is pending; reason only on hover) | export as a recorded event, learning |
| 13 | Export panel | Download **Excel**, **CSV** or **Word** | provenance |
| 14 | Outside the app | Send | |
| 15 | Opportunities, later | Hover the card to reveal the archive icon, choose **Won/Lost/Withdrawn**, **Archive** | archive, outcome |

About 15 steps plus one loop per held question; about 22 concepts. Findings:

- **Three names for one thing, and a fourth beneath it.** The nav and button say **Opportunity**; the page subtitle says "Every response in flight"; the card says **Open workspace**; the workspace heading says **New RFI Session**; the delete dialog says "removes the response, its sessions and questions". The user must work out that opportunity, response and workspace are the same object and that a session is a file inside it (`OpportunitiesDashboard.tsx`, `workspace/UploadStep.tsx`).
- **"New RFI Session" is the first thing a new owner sees** after creating the opportunity, so the first new word they meet is the name of a table.
- **The workspace never shows the due date, owner or stage.** The review header is the file name (`bluefin-security-questionnaire.xlsx`) and three counts. The opportunity name is in the breadcrumb only at 1024 px and wider, truncated (`App.tsx`, BUG-33). "By the due date" has to be remembered from the overview.
- **Two progress vocabularies.** The overview says "7 of 14 decided" and stage **Ready**; the workspace says **accepted**, **pending**, **skipped**. "Decided" appears nowhere in the workspace.
- **Two different "Medium" bands on the same screen.** The confidence filter is "Medium 40–80%"; the bulk button is "Medium ≥60%" (`RFIWorkspace.tsx` `CONF_GROUPS` and `workspace/BulkBar.tsx`, visible in `2-review.png`).
- **The held-back explanation is one 70-word sentence** listing eleven database reasons ("matched before every entry was indexed, citing an unreviewed, overdue or replaced entry ...") in `BulkBar.tsx`. It describes the `bulk_accept` function's rules, not what the owner should do next.
- **The card exposes the pipeline.** Confidence and Similarity side by side (with a tooltip on cosine similarity), checker model names, "drafted by claude-haiku-5-5 (prompt version)", calibration set names. Useful to an auditor; on the owner's main path it is noise (`RFIQuestionCard.tsx`).
- **Two numbers per question**: the upload-order index ("07") and the customer reference ("A7"), next to each other (`2-review.png`).
- **Record export comes before download.** The files are only offered after the export is recorded, which also closes assignments and triggers learning (`BulkBar.tsx`, `ExportPanel.tsx`). The owner cannot download a draft for a colleague to read without committing the response. "Export" here is a database event, not the act of getting a file.
- **Archive is hover-only** (`opacity-0 group-hover:opacity-100`) on the overview card, and Won/Lost are disabled until the export is recorded, with the reason only in a tooltip.
- **Every question is shown as one long list** sorted by confidence; there is no "what is left for me" view beyond the Pending filter.

### 1b. "Where are all my responses, and which need me today?"

Opportunities, then possibly Assignments, **Sent**. 3 to 6 steps; concepts: stage (six values), decided, at risk, overdue, with experts, Mine only.

- **The two urgent tiles do nothing.** **In review** and **Ready to export** filter the list; **At risk** and **Overdue** have no `onClick` and render as disabled buttons (`OpportunitiesDashboard.tsx`, `tiles`). The most important question on the page is the one you cannot click through.
- **"At risk" is defined only in the guide** (three working days with under 80% decided, and so on); the card gives no reason.
- **"Mine only" means "I am the owner".** Responses where I have assignments, or where colleagues have answered something I asked, are not included.
- **No "needs me" signal on a card.** "2 with experts" counts open assignments; it does not say that one has come back answered. That lives on a different screen (Assignments, Sent) with no link back.
- **Sorted by due date only**; the stage filter row has seven pills including "Changed since export", which is a state of the export record rather than something a user asks for.
- The **Import KB** button sits beside **New Opportunity** on this page, mixing a knowledge-base job into the response overview.

### 1c. "A colleague has answered something I asked them; act on it"

There is no notification (no in-app badge, no email in `src/` or `supabase/functions/`). Shortest path, if the owner thinks to look:

1. Assignments, 2. **Sent**, 3. filter **Answered**, 4. expand the card: question, **Proposed Answer**, notes. No link to the question and no Accept here. 5. Remember the opportunity name shown on the card. 6. Opportunities, 7. find and open it. 8. The workspace opens on the newest session; if the assignment belongs to an older file, 9. choose **New upload** (which resets the workspace), 10. find the file under **Previous Sessions**, **Resume**. 11. Search for the question text, 12. expand the card, read "Accepted (edited) by ..." or the unchanged draft, 13. **Accept** or **Revise Answer**.

About 13 steps and 9 concepts (assignment, its four stages, Sent, opportunity, workspace, session, Previous Sessions, accept). Findings:

- **The inbox's Proposed Answer is a copy taken when the assignment was made** (`answer_text` inserted in `useAssignments.ts`). If the colleague edited the answer in the workspace, the inbox still shows the old text.
- **Two separate status machines for one piece of work.** The assignment moves Pending, In Review, Answered, Approved, Closed (`UserInbox.tsx`); the question is pending, accepted or skipped. Marking an assignment **Approved** does not accept the question, and accepting the question does not move the assignment (`lib/assignments.ts`). "Approved" and "Accepted" sit a click apart with different meanings.
- **The owner cannot move an assignment.** The status button appears only when `isOwn` (the assignee); in **Sent** the owner can only add notes. Assignments close only when the export is recorded.
- **The workspace banner only shows assignments that have notes** (`assignmentsWithNotes` in `RFIWorkspace.tsx`), titled "n assignments with notes to review". A colleague who marks Answered without writing a note does not appear in it, and the banner keeps showing approved ones.
- **Assignments are loaded per session** (`useAssignments` filters on `session_id`), so an answer on an older file is invisible until the owner reopens that file.
- **"In review"** is both a response stage (overview) and an assignment stage (inbox), meaning different things.

## 2. Contributor

### "I have been asked to answer or check something; do it and get back to my work"

| # | Screen | Action | Concepts |
|---|---|---|---|
| 1 | Sign-in | Sign in | |
| 2 | Introduction | 8 steps, of which upload, bulk approval and export are owner jobs | |
| 3 | Opportunities (default landing) | Realise this is not your work; choose **Assignments** | Opportunity, Assignment |
| 4 | Assignments, **My Inbox** | Find the item; expand it | assignment stages (dots) |
| 5 | Card | **Mark as In Review** | In Review |
| 6 | Card | **Add Notes**, type, **Save Notes** | notes |
| 7 | Card | Read the response name; remember it | |
| 8 | Opportunities | Search for and open the response | workspace |
| 9 | Workspace | If the question is in an older file: **New upload**, then **Previous Sessions**, **Resume** | session, Previous Sessions |
| 10 | Review list | Search for the question (no "assigned to me" filter) | |
| 11 | Card | Expand; **Edit First**; **Save & Accept** (or **Accept**, **Write an answer**) | confidence, checker, KB Sources, gates, accept |
| 12 | Assignments | Go back; **Mark as Answered** | Answered |
| 13 | Card | Optionally **Mark as Approved** (their own work) | Approved |

About 13 steps and 14 concepts, across three screens, for what is usually one answer. Findings:

- **The inbox cannot do the job.** It has no answer box: the specialist guide says so outright ("The inbox tracks the assignment; the answer is decided in the response's workspace", `docs/guide/specialists.md`) and tells the user to choose **New upload** to find an older file. That instruction exists because the screen is organised around sessions.
- **The stage buttons are ceremony.** Pending to In Review to Answered to Approved are four clicks that change only the `question_assignments.status` column; none saves an answer. The contributor can approve their own assignment.
- **The landing page is wrong for this user.** A contributor's work is in Assignments, but every sign-in opens Opportunities, and the nav label is "Assignments" while the tab inside is "My Inbox".
- **The workspace is the owner's screen with things greyed out.** The contributor sees the bulk bar with disabled buttons ("Only the response owner or an admin can approve questions in bulk"), all questions rather than theirs, and a **New upload** button that leads to a dead end (below).
- **Dead end: New upload for non-owners.** `New upload` and the upload step are shown whenever the response is not archived. A member who is not the owner can choose a file, map the column and press **Match and draft**, and only then gets "The session could not be created: " followed by the database's row-level security message (insert policy "Owner or admin adds a session to a response", `supabase/migrations/20261023150000_sprint3_review_fixes.sql`).
- **No way to say "this is not mine" or hand it back**, other than a note.

## 3. Admin

### 3a. "Keep the knowledge base trustworthy"

Governance, **Entries to review**, then per entry **Approve** or **Correct** then **Save corrections and approve**; then **Overdue for review**, per entry **Still correct** or **Correct**. 3 steps plus one or two per entry. Concepts: entry, reviewed, overdue, review interval, replaces (supersedes), bulk-approval hold, origin ("Learned from a response; answer approved by James Okafor, who is not an admin"), entry number.

- **Nothing tells the admin there is work.** No count on the Governance nav item or on the tabs (`GovernanceAdmin.tsx`); the only proactive banner is about spend.
- **The knowledge base lives in two places that do not link.** **KB** in the top bar is a modal listing all entries with a **Not yet reviewed** badge, but no filter for it and no review action; reviewing happens in Governance, which has no search and no link to the entry in the KB.
- **Approve or Correct are the only outcomes.** There is no reject, retire or delete for an entry in the UI, although the product brief makes deletion an admin power and the audit log has a `kb.deleted` action (`lib/auditLog.ts`). A wrong learned answer can only be overwritten.
- **The impact of an entry is hidden.** The card says approving "releases" held questions, and overdue cards show "cited n times in 90 days", but not which open responses are waiting on it, so the admin cannot prioritise by what is blocking a due date.
- **The review interval is set on another tab** (**Usage and limits**, "Review knowledge-base entries every (months)"), and the Overdue tab says so; the admin has to remember it across tabs.

### 3b. "Keep spend under control"

Governance, **Usage and limits**: this month's spend, by person, by model and job, ten numeric limits, **Save limits**, a price table. 2 steps to see, 3 or more to change. Concepts: tokens, model and "job" (judge, gate, draft, embed), reserve, indexing, extract, per 1,000 characters, exchange rate, UTC day.

- **A table name in the UI**: "the figure is too low until its price is added to the ai_prices table" (`GovernanceAdmin.tsx`). Prices are read-only on the page, so this is a dead end that sends the admin to the database.
- **Implementation settings beside policy ones.** "Reserve per question (US$)", "Reserve per knowledge-base text indexed (US$)", "Reserve per 1,000 characters of a Word document (US$)" and "Pounds per US dollar" sit in the same form as the monthly budget, with equal weight.
- The spend warning banner on every page ("See Governance") is a good, task-shaped signal; it is not a link.

### 3c. "Add a colleague"

Team, **Invite someone** (email, optional name), **Send invitation**. 3 steps. To make them an admin or set expertise: find their card, **Edit**, **Admin Access** toggle or tags, **Save Changes** (4 more, and only after they have accepted). Concepts: member, admin, expertise tags.

- Works, and is on the page an admin would look for. But **the admin introduction contradicts it**: step "For admins" says "Invite people from the Supabase dashboard" (`lib/onboarding.ts`), which predates the Sprint 15 invite form.
- Expertise tags, which drive expert suggestions, are not asked for at invitation; nothing prompts anyone to fill them later.
- Re-sending or withdrawing an invitation still needs Supabase Studio (`docs/guide/admin.md`).

### 3d. "See who did what"

Governance, **Audit log**, optionally **Show**. 2 to 3 steps. Readable plain-language lines, but:

- Each line ends with the raw action code (`response.archived`, `kb.confirmed`) in monospace.
- Some lines do not say what they are about: "Archived a response as won." with no response name (`16-audit-log.png`).
- Only the latest 200 entries; no filter by person, response or date, and no way to get from a response or entry to its history.

## 4. First-time demo visitor (invited member, no training)

### "Understand in five minutes what this does and see it work"

1. Follow the invitation link, set a password (`SetPassword.tsx`). 2. The introduction opens: 8 steps with real screenshots of the demo data. 3. Land on Opportunities with three fictional active responses (New, In review, Exported) and one archived. 4. Open **Bluefin Freight** (In review): a review list of 14 questions, a bulk bar whose buttons are disabled, cards with no Accept ("Only the response owner, an admin, or someone this question is assigned to can decide it"). 5. Open **Juniper Utilities** (New): **New RFI Session** with an upload box. 6. Choose a file (the visitor has none: `sample-data/sample-questions.csv` is in the repository, not in the app). 7. Map the column, **Match and draft**: refused with the row-level security message, because the visitor is not the owner. 8. Go back, **New Opportunity**, name it, **Create**, upload their own questionnaire, **Match and draft**, wait. Their real questions will mostly score Low against a synthetic security knowledge base, or hit the per-person daily cap or the monthly budget (£5 on the live demo; members do not see Governance). [Corrected by Claude: the walk-through said £10, the seed's default.]

About 10 steps and 12 or more concepts before seeing a single draft being made, with one dead end on the way, and the only success path needs a file the visitor has to supply. Findings:

- **A member can watch but not act on the demo data.** Every demo response is owned by a fictional person, so the visitor's first three clicks show a read-only product.
- **No guided "try it" path.** Nothing offers a sample questionnaire or a sandbox response the visitor owns. The introduction explains the pipeline (checker, calibration, Japanese, translated drafts) before the visitor has seen one draft.
- **The vocabulary is a barrier for this user most of all**: Opportunity, RFI Session, KB, calibrated confidence, similarity, checker, gate, Record export.
- The sign-in page copy ("Knowledge-base matching, collaborative expert review, and one-click export") and the introduction's first step ("It drafts answers only from that knowledge base ... a person approves every answer") are clear and honest; they are the right five-minute message.

## Summary of counts

| Job | Steps (shortest path) | Concepts | Screens | Dead ends |
|---|---|---|---|---|
| 1a Owner: answer and send | ~15 + per question | ~22 | 4 + dialogs | Record export before download; hidden archive |
| 1b Owner: what needs me | 3 to 6 | ~7 | 2 | At risk and Overdue tiles inert |
| 1c Owner: act on colleague's answer | ~13 | ~9 | 3 | No link from Sent; no notification |
| 2 Contributor | ~13 | ~14 | 3 | Inbox cannot answer; New upload refused |
| 3a Admin: KB trust | 3 + per entry | ~8 | 1 (+ KB modal) | No reject or delete |
| 3b Admin: spend | 2 to 3 | ~10 | 1 | "ai_prices table" |
| 3c Admin: add colleague | 3 (+4) | 3 | 1 | Intro says use Supabase |
| 3d Admin: who did what | 2 to 3 | 2 | 1 | No filter by person or response |
| 4 Demo visitor | ~10 to first draft | 12+ | 4 | Read-only demo; RLS refusal; no sample file |

## Where the data model leaks into the interface, ranked by harm

1. **Assignment and question are separate objects with separate states, on separate screens** (`UserInbox.tsx`, `RFIQuestionCard.tsx`, `lib/assignments.ts`). The contributor's whole job and the owner's follow-up both cross three screens, and "Approved" does not mean "Accepted". Fix: make the assigned question itself the unit of work, answerable where it is listed.
2. **The session (`rfi_sessions`) as a navigable layer** ("New RFI Session", "Previous Sessions", "Other Sessions: not linked to this opportunity", "New upload" as the way to reach an earlier file; `UploadStep.tsx`, `openResponse.ts`). Fix: treat files as sources of one response's question list, not as places.
3. **Navigation is one item per table, and everyone lands on Opportunities** (`App.tsx`). No screen answers "what needs me today" across responses, assignments and reviews. Fix: a role-aware home listing the person's next actions.
4. **Permissions enforced only by the database surface as raw errors or greyed controls** (upload for non-owners, bulk bar, missing Accept). Fix: show each person only the actions they can take, and say why up front.
5. **Opportunity, response, workspace and session for one thing** (overview, workspace, delete dialog). Fix: one name, ideally the user's ("questionnaire" or "response").
6. **"Record export" as a step before download** (`BulkBar.tsx`, `ExportPanel.tsx`). Fix: separate "download" from "mark as sent", and say that the second one teaches the knowledge base.
7. **Bulk-approval and gate rules exposed as the database's list** (the eleven-reason sentence; eight gate badges; "Not calibrated", "Some entries not searched"). Fix: group into "needs a person" with one reason each, details on demand.
8. **Pipeline internals on the question card** (similarity, model names, prompt version, calibration set). Fix: keep for an audit or details view.
9. **The knowledge base split between the KB modal and Governance tabs**, with no reject or delete. Fix: one knowledge-base place with a review queue in it.
10. **Admin settings and messages that name implementation** ("ai_prices table", reserves in US$, "indexed for meaning-based search" toasts on sign-in, raw `action` codes in the audit log). Fix: plain-language summaries, technical settings behind an advanced section.
11. **Status words reused with different meanings**: "In review" (response stage and assignment stage), "decided" against "accepted", "Medium 40–80%" against "Medium ≥60%". Fix: one vocabulary, checked like the guide labels are.

## What already works well and should be kept

- **The four-step strip on the upload screen** (Upload, Match and draft, Review, Export): the one place the app describes the job rather than the data (`UploadStep.tsx`).
- **Review sorted by need**: uncalibrated first, then lowest confidence, with the customer's own numbering kept.
- **Plain-language gate badges** such as "Pricing: a person answers" and "Legal: review individually", and a per-card reason for every hold.
- **Expert suggestions with their reasons** ("wrote KB-0001", "expertise: encryption", **Top pick**), shown in `11-assign.png`.
- **Overview cards**: owner, due date, "7 of 14 decided", "2 pricing or legal open", "2 with experts", **At risk** and **Overdue** pills.
- **Disabled controls that say why** (Record export, bulk buttons, Won/Lost), though the reasons should not be hover-only.
- **Word import that saves nothing until checked** (**Check the questions**, **Where it came from**).
- **Entries to review shows what an approval replaces** ("Approving this replaces KB-0070, which currently says").
- **The export panel's honest summary of what was learned** and of provenance in each file.
- **The invite form on Team**, and the audit log written in sentences.
- **The introduction**: role-filtered, with real screenshots and links into the guide, and reopenable from **Help**. Its content needs to follow the code (the Supabase invite step).
- **The workspace opens on the latest file with a proper loading and error state** (S16-1), rather than an empty upload box.
