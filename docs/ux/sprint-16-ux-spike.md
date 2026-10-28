# UX spike: organising RFI Respond around jobs, not entities

Sprint 16, story S16-4, 28 October 2026. Time-box two days (Rory, Q3). A spike: it recommends and outlines; nothing here is built, and anything chosen is refined from Sprint 17.

## The question

Rory, 28 October: the screens "mirror the data model rather than the actual user journeys and jobs to be done", so a user "has to have a reasonable understanding of the entity relationships ... rather than approaching it from, I have a problem, where do I get started?" How should the app be organised so each kind of user starts from their problem and is led through it? Is tidying the current screens enough, or does it need a different structure?

## How this was done, and its limits

- **Two walk-throughs, done separately.** An independent agent walked nine jobs for four users through the app from its code, the user guide and the screenshots, without seeing this analysis ([`sprint-16-independent-walkthrough.md`](sprint-16-independent-walkthrough.md), with step and concept counts per job). Claude did the same from the code and the guide, then compared. They agree on every major finding below; where only one found something, it says so.
- **Checked against the code.** The main claims were confirmed in the source (for example the copied answer in an assignment, the inert tiles, the upload offered to people who cannot upload). One was out of date and fixed straight away: the admin introduction still said to invite people from Supabase.
- **Not tested with users.** No real owner, contributor or admin was observed. The counts are heuristic (the shortest path a person who already knows the app would take), so the real figures for a newcomer are higher, not lower.
- **The live walk-through is pending.** Walking the hosted demo needs a signed-in browser, and Claude does not type passwords. If Rory signs in to the browser pane, the walk-through on the live demo is added to this report; until then, it is from the code, the guide and the screenshots.

## The jobs, per person

Written as jobs to be done: the situation, what the person wants to get done, and how they know it is done. Today's job stories (`docs/JOB_STORIES.md`, from the prototype) are organised by screen, which is part of the problem.

**Response owner** (bid, sales or security lead; anyone can be one)
1. *A questionnaire has arrived.* Get every question answered well enough to send, by the due date, with as little of my own time as possible. Done when I have a file I trust and have sent it.
2. *Several responses are in flight.* Know which need me today and why. Done when I have acted on everything that is waiting for me.
3. *I asked a colleague.* See their answer and accept it, without hunting for it. Done when the question is decided.
4. *It is over.* Record what was sent and whether we won, so the knowledge base learns from it.

**Contributor** (subject expert, often busy elsewhere)
5. *I have been asked to answer or check something.* Give my answer and get back to my work. Done when the owner has what they need from me.
6. *I know something the knowledge base does not.* Add it once, so I am not asked again.

**Admin** (one or two people)
7. *Keep the knowledge base trustworthy.* See what is waiting for review, starting with what blocks a response, and fix or retire wrong entries.
8. *Keep spend and people in order.* Know whether anything needs me (spend, a new person to invite), and change a limit when it does.
9. *Account for what happened.* Find who decided an answer, or changed an entry, and when.

**First-time visitor to the demo** (a hiring manager or prospective customer, invited as a member, no training)
10. *I have five minutes.* Understand what this does and see it work on a real questionnaire. Done when I have seen questions drafted, held and approved, and I believe the claims.

## What the walk-throughs found

### How many steps and ideas each job takes today

From the independent walk-through (shortest path, from sign-in):

| Job | Steps | Ideas the person must already hold | Dead ends |
|---|---|---|---|
| 1 Answer a questionnaire | about 15, plus one round per held question | about 22 | Record export before any download; archive only on hover |
| 2 What needs me today | 3 to 6 | about 7 | The At risk and Overdue tiles cannot be clicked |
| 3 Act on a colleague's answer | about 13 | about 9 | No link from the assignment to its question; no notification |
| 5 Answer what I was asked | about 13, across three screens | about 14 | The inbox cannot answer; **New upload** is offered and then refused |
| 7 Knowledge-base review | 3, plus one or two per entry | about 8 | No way to retire or delete an entry; nothing says there is work |
| 10 Demo visitor sees it work | about 10 before a single draft | 12 or more | Every demo response is read-only to them; uploading is refused; no sample file |

### Where the data model shows through, ranked by harm

1. **An assignment and its question are two things on two screens.** The contributor's inbox moves an assignment through four stages (pending, in review, answered, approved) but cannot answer the question; the answer is decided in the response's workspace, which the inbox does not link to, and if the question came from an earlier file the guide tells the contributor to choose **New upload** to find it. "Approved" on the assignment does not accept the question. The answer shown in the inbox is a copy taken when the question was assigned. *Both walk-throughs.*
2. **Files (sessions) are a layer you have to navigate.** The first thing a new owner sees after creating a response is **New RFI Session**; earlier files are reached through **New upload** and **Previous Sessions**; every workspace shows "Other Sessions: not linked to this opportunity". *Both.*
3. **The navigation is one item per table, and everyone lands on the same page.** Opportunities, Assignments, Team, Governance and KB are the main tables. A contributor's work is in Assignments, but they land on Opportunities; no page answers "what needs me today" across responses, assignments and reviews. *Both.*
4. **Permissions held only by the database show up as greyed controls or raw errors.** A member who is not the owner is offered the upload, gets as far as **Match and draft**, and is then shown the database's refusal; the bulk bar is shown to people who cannot use it. *Independent; confirmed in code.*
5. **One thing has four names.** The navigation says **Opportunity**, the page says "response", the card says **Open workspace**, the workspace says **RFI Session**. *Both.*
6. **"Export" is a database event, not getting a file.** Files are offered only after **Record export**, which also closes assignments and makes the knowledge base learn. An owner cannot download a draft for a colleague to read without declaring the response finished. *Both.*
7. **The rules behind bulk approval are shown as the database's list.** One sentence of about 70 words lists eleven reasons; eight hold labels; "Not calibrated", "Some entries not searched". What the owner needs is "these need a person", with one reason each. *Both.*
8. **The question card shows the pipeline.** Similarity next to confidence, model names, prompt versions, calibration set names: right for an audit, noise on the owner's main path. *Both.*
9. **The knowledge base is in two places.** **KB** in the top bar lists entries but cannot review them; review is under **Governance**, which cannot search them; neither can retire an entry. *Both.*
10. **Admin pages name implementation**: "added to the ai_prices table", reserves in US dollars next to the monthly budget, raw action codes in the audit log. *Independent.*
11. **The same word means different things**: "In review" is a response stage and an assignment stage; "Medium" is 40 to 80% in the filter and at least 60% on the bulk button; the overview says "decided", the workspace "accepted". *Independent; confirmed.*

### Worth keeping

The independent walk-through and this one agree that these already work and should survive any change: the four-step strip on the upload screen (the one place the app describes the job); review sorted by need; plain hold labels with a reason on every card ("Pricing: a person answers"); expert suggestions that say why; the overview cards (owner, due date, decided out of total, at risk); Word import that saves nothing until the questions are checked; "Approving this replaces KB-0070, which currently says"; the honest export summary of what was learned; the invite form; the audit log in sentences; the role-filtered introduction.

## The underlying problem

The app is honest and careful about **what** each record is, and that care is visible on every screen. What it does not do is say **what to do next**. Each screen is a view of one table, so the user carries the journey in their head: which response, which file inside it, which question, which assignment of it, whose turn it is. The jobs above cut across the tables: "answer what I was asked" touches an assignment, a question, a session and a response; "what needs me" touches all of them at once.

The data model itself is sound and does not need to change for most of this. The fix is a layer of task-shaped screens over it.

## Options

### A. Tidy what is there (about one sprint)

Fix the leaks without changing the structure: one name for a response; **Files** instead of sessions, as a list inside the response; the At risk and Overdue tiles clickable; a link from every assignment to its question; owners able to move assignments; upload and bulk controls shown only to people who can use them; **Download** separate from **Mark as sent**; the hold rules grouped; pipeline details behind a **Details** toggle; one vocabulary, checked by the docs tests.

- **Serves:** jobs 1, 2 and 10 partly; 3 and 5 a little (fewer clicks, same three screens).
- **Risks:** low; no change to who may do what.
- **Leaves:** the contributor still answering on the owner's screen; still no "what needs me" page; the demo visitor still cannot act.

### B. Reorganise around jobs, keeping the data model (about three sprints; recommended)

A task-shaped layer over the same tables and the same rules:

- **Home, different for each person**: "Needs you" first (questions colleagues have answered, questions assigned to you, responses at risk, entries waiting for review), then "Your responses". Everyone lands here; nobody needs to know which table their work is in.
- **A response page that is a journey**: a header with the customer, due date, owner and progress; three stages, **Questions**, **With experts**, **Send**; questions grouped as **Needs a person**, **Ready to approve** and **Approved**, each with one reason; files listed as sources of the one question list, not as places to go.
- **"Questions for you"** for a contributor: the question, the current draft, its sources, and an answer box, with **Send to owner** and, where they may, **Approve**. The assignment's stage follows what they do, rather than being a separate set of buttons.
- **Knowledge, in one place**: search, add, import, and a review queue with counts, starting with entries that are holding questions in open responses; retire an entry, with a reason, audited.
- **Settings for admins in plain terms**: budget and daily limits first; reserves, exchange rate and prices under **Advanced**; the audit log filterable by person and response.
- **Try it, for the demo**: "Try it with a sample questionnaire" makes the visitor's own copy of a sample response, owned by them, so they can draft, approve and download within the budget.

- **Serves:** every job above. Estimated on the mockups with the walk-through's way of counting (not measured), job 5 drops from about 13 steps on three screens to about 4 on one; job 3 from about 13 to 2 (Home, then the question); job 10 to about 3 before a draft.
- **Risks:** moderate. The screens change, so the guide, the introduction and its screenshots must be redone, and returning users relearn the layout. Access rules do not change; a few new read functions are needed (a person's "needs you" list across responses). The contributor's answer box decides the question with the same rules as today.
- **Leaves:** assignments and questions still separate underneath, which is invisible to users once the screens follow the question.

### C. Restructure around a single work queue (five sprints or more)

Everything becomes a task in one queue (answer this, approve that, review this entry), and responses become projects that group tasks. Assignments and question decisions merge into one record in the database.

- **Serves:** the same jobs as B, with a cleaner model underneath.
- **Risks:** high. A migration of assignments, approvals and the audit trail; new access rules and tests for the whole role matrix; the calibrated, evaluated pipeline untouched but every screen rebuilt. Much of the gain over B is in the model, which users would not see.

## Recommendation

**Option B, built in slices that each stand alone, starting with the contributor.** The contributor's job is the one the current structure fails worst (three screens, a guide telling them to use **New upload** to find a question), and it is the one a hiring manager trying the demo is most likely to meet next, after the owner's. Option A's quick wins that B would replace anyway are not worth building separately; the few that B keeps (one vocabulary, clickable tiles, controls only for those who can use them) go into the first slice. Option C is not worth its cost while B can hide the split between assignments and questions.

The mockups that go with this report (the design "RFI Respond: jobs-first mockups", six screens you can click through with Play) show option B: Home for an owner, a response as a journey, a contributor's question, sending, the knowledge base with its review queue, and the demo's **Try it** start. They use the demo's fictional names; their figures are illustrative, not measured. One idea in them goes beyond today's rules and needs a decision at refinement: a contributor's answer can update the knowledge base straight away (waiting for an admin's review), rather than only when the response is marked as sent.

## Rory's decision, and the knowledge base as the product (28 October 2026)

Rory chose **option B**, and left the order of the slices to Claude. He added one requirement: the app exists to demonstrate an **institutional knowledge base**, with the RFI responder as the real-world use around it, so the knowledge base should not be a pop-up. "Not front and foremost, but more fully featured and occupying more of the screen", since it is the value proposition for most people looking at it.

What that changes in option B:

- **Knowledge is a main destination**, beside Responses, and fills the screen. Home stays first, because people come to do a job; Home carries a "What we know" panel that leads into it.
- **An overview of what the organisation knows**: how many approved answers, in which languages, from whom; their health (reviewed, waiting for review, translations to check, gaps); answers by topic, with how often each topic is cited; what was learned recently.
- **Ask it a question**: type a question as a customer would and see the answer it would draft, with its confidence and the entries behind it, before any questionnaire arrives. This is the shortest demonstration of the value, for a visitor and for an owner deciding whether to trust it. It uses the same matching, checking and drafting as a response, counted against the same limits.
- **Browse and search, full screen**: by number, words or meaning, filtered by state, language and where an answer came from, with the selected answer beside the list.
- **One answer and its whole history**: the answer, its state and topics; a proposed change waiting beside it; where it has been used, in which responses and with what outcome; its history (imported, reviewed, confirmed by use, what it replaced); its other languages; its next review. Edit, mark as still correct, or retire with a reason.
- **Gaps**: questions from recent responses that it could not answer, grouped, with the answer a person wrote, so it can be added in one step, or an expert asked to write one. Pricing is never listed: it is never learned.

The mockups were extended accordingly: four knowledge screens (7 to 10) and the "What we know" panel on Home. The earlier knowledge screen with its review queue is replaced: the review queue is the **Waiting for review** filter in browse, and the proposed change on each answer's page.

What it needs underneath, to check at refinement: **Ask it a question** needs a server function that matches and drafts without a response, metered like processing; **where it has been used** and **gaps** read across responses (members can already read every response, so no access rule changes); **retire** needs a new audited database function; topic counts come from entries' tags.

## Outline stories (for refinement from Sprint 17; not refined)

Ordered so each slice is useful on its own. K stories are the knowledge base as a full place (Rory, 28 October).

| | Story | Serves | Size (rough) |
|---|---|---|---|
| U-1 | One vocabulary: a response is a "response" everywhere; "files" instead of sessions; one set of status words, checked by the docs tests | all | S |
| U-2 | Controls only for those who can use them: no upload or bulk bar for people who cannot, and the reason said up front, not on hover | 1, 5, 10 | S |
| K-1 | Knowledge as a full page in the main menu: the overview (counts, health, topics, learned recently) and full-screen browse and search with filters, replacing the pop-up | 6, 7, 10 | M |
| K-2 | One answer and its history: where used, history, other languages, next review; edit, mark as still correct, retire with a reason (audited) | 7, 9 | M |
| K-3 | Ask it a question: the draft it would give, with confidence and sources, metered | 10, 1 | M |
| K-4 | Gaps: what it could not answer, with one-step add or ask an expert | 6, 7 | M |
| U-3 | "Questions for you": a contributor answers, approves or hands back an assigned question on one screen, with the current draft and sources; the assignment's stage follows (and, to decide at refinement, their answer proposed to the knowledge base at once) | 5, 6 | M |
| U-4 | Home with "Needs you" and "What we know": answered by colleagues, assigned to you, at risk, entries to review; everyone lands there | 2, 3, 7 | M |
| U-5 | The response as a journey: header with due date and progress, stages, questions grouped by what they need, files as sources | 1, 4 | L (split at refinement) |
| U-6 | Download separate from **Mark as sent**; mark as sent records the export, closes assignments and teaches the knowledge base, and says so | 1, 4 | S |
| U-8 | **Try it** for demo visitors: their own copy of a sample response, within the budget | 10 | M |
| U-9 | Plain settings with **Advanced**, and the audit log filterable by person and response | 8, 9 | S |
| U-10 | The guide, the introduction and the screenshots redone, a slice at a time | all | M |

(U-7, "knowledge in one place", is replaced by K-1 to K-4.)

### The order (Claude's choice, as Rory asked)

| Sprint | Slice | Why first |
|---|---|---|
| 17 | U-1, U-2, K-1 | The knowledge base becomes the visible centre of the app at once, and the vocabulary and controls every later screen relies on are settled |
| 18 | K-2, K-3 | Each answer's history is the proof that the knowledge is trustworthy; asking it a question is the shortest demonstration of the value |
| 19 | U-3, U-4 | The contributor's job, the worst today, and Home, which ties the jobs together |
| 20 | U-6, U-8, K-4 | Sending made plain, the demo's **Try it**, and gaps that make the knowledge base grow |
| 21 | U-5, U-9 | The response page rebuilt as a journey, once the pieces it links to exist |

U-10 goes with each slice: every sprint updates the guide and the introduction for the screens it changes.

## Decisions taken

1. **Option B** (Rory, 28 October), with the knowledge base as a full place in the app.
2. **Order:** as above (Claude, at Rory's request); refined one sprint at a time, starting with Sprint 17.
3. **Still open, for Sprint 17's refinement:** whether to walk the live demo together first, with Rory signed in to the browser pane.
