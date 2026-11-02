# Sprint 21 refinement: sending made plain, gaps that make the knowledge base grow, and configuration as code

Refined 2 November 2026, as proposed at the Sprint 19 and 20 review: O-1 (from the Sprint 20 set-up), U-6 and K-4 (the next slice of option B, Sprint 16 spike), with F-67 (returned from Sprint 20) beside K-4. U-8 moves to Sprint 22 with U-5 and U-9. The first sprint refined under the working agreement (`build-working-agreement` skill) and checked by the browser tests (decision 0008).

## What refinement found

- **Downloading and recording are one step today.** **Record export** (on the bulk bar) records the export, teaches the knowledge base and closes the assignments; only then do the download buttons appear. Nothing says, before the click, what it will do. The glossary already expects the change: "Export", **Record export** and **Exported** stay "until downloading and marking a response as sent are separated (U-6)".
- **Most gaps are already learned, but nobody sees it.** When a response is recorded, edited and person-written answers become entries (`learned_entry_id` on the question links to it). What is missing is a view across responses: what the knowledge base could not answer, which of those a person has since answered (and whether that answer is in the knowledge base yet), and which are still open. Every member can read every response, so the view needs no new access rule.
- **The question texts and their outcomes are all stored.** A question the knowledge base could not answer has `draft_kind` `insufficient_evidence` (no answering entry) or `person_required` (pricing, never learned). Its decision (`status`, `final_answer`), and whether it was learned, are on the same row.
- **Supabase's sign-in settings for hosted projects cannot be pushed with today's tokens.** The project-scoped tokens have no write access to sign-in settings, by design (Sprint 20, H2). They can be given read access, so the deploy can check the settings against the repository without being able to change them.
- **The secrets set-up was eleven hand steps,** and one copy-and-paste slip (the service key in the anon key's place) reached Vercel before the build guard caught it.
- **The real-AI step on staging (F-67)** needs no new code in the app: Ask it a question already calls the full pipeline. It needs a browser test that asks once on staging and checks what only a real model gives (a calibrated confidence, the checker's verdict).

## Stories

### S21-1 Download separate from Mark as sent. M (U-6)

**The job.** An owner downloads the answers whenever they need a copy, and marks the response as sent once it has actually gone to the customer. Marking as sent says beforehand exactly what it will do.

**Before and after.**
- Today: **Record export** on the bulk bar, then a page with the download buttons. The words "export" and "recorded" do not say that the knowledge base learns or that assignments close.
- After: when every question is decided (Q1), the response shows **Download** (Excel, CSV, Word) and, separately, **Mark as sent**. Choosing **Mark as sent** opens a short confirmation saying what will happen: how many answers the knowledge base will learn (edited and person-written, never pricing), how many open assignments will close, and that this is recorded with their name and the time. After it: what was learned, as today.
- The stage word **Exported** becomes **Sent**, **Changed since export** becomes **Changed since sent**, and **Record export** becomes **Mark as sent**, in the app, the guide, the introduction and the glossary (whose test enforces it). The database keeps its names (`exported_at`, `record_export`), so nothing migrates.

**What changes.** `BulkBar.tsx` (**Mark as sent** replaces **Record export**), `ExportPanel.tsx` (downloads available before marking as sent), a confirmation in the workspace, `lib/responses.ts` (a preview of what marking as sent will do, from the questions on screen), the glossary, the guide pages, the onboarding step, the overview's stage label.

**Test cases.**
1. With questions still to do, there is no **Download** and no **Mark as sent**, with the reason shown (browser).
2. When every question is decided, **Download** works without marking anything: the response stays **Ready to send**, no assignment closes, nothing is learned (browser).
3. **Mark as sent** shows what will happen, with counts matching the questions (two edited answers learned, one pricing answer not, one open assignment closed); **Cancel** changes nothing (browser).
4. Confirming marks it **Sent**, records who and when (audit log), closes the assignment, and shows what was learned (browser).
5. A change after sending shows **Changed since sent**, and **Mark as sent** again records it (browser).
6. No visible text says "Exported", "Record export" or "export recorded" (the glossary test, CI).
7. A member who does not own the response sees neither button (browser; the database already refuses, tested since Sprint 3).

**Out of scope.** Sending to the customer from the app; downloads of unapproved drafts (Q1).

**Boundaries.** Rule 4: every downloaded answer still has a named human decision behind it (Q1). Rule 1: the confirmation's counts come from the same rules the database applies, and say "about" nowhere: if they cannot be known exactly beforehand, the confirmation says what kinds of answer are learned rather than a number.

### S21-2 Gaps: what the knowledge base could not answer. M (K-4)

**The job.** Anyone can see what the knowledge base could not answer in recent responses, what has happened to each, and act on the open ones in one step. It is how the knowledge base grows, shown.

**Before and after.**
- Today: nowhere.
- After: **Knowledge** gains **Gaps**: questions from responses in the last 90 days that the knowledge base could not answer (`insufficient_evidence`), pricing never listed. Questions with the same wording (ignoring case, spaces and punctuation) are grouped, with how many responses asked them (Q3). Each group shows where it stands:
  - **Learned**: answered by a person and now in the knowledge base, with a link to the entry;
  - **Answered, learned when sent**: a person has approved an answer and the response is not yet sent;
  - **Not answered yet**: still to do, with **Open it in the response** (to write it or assign it, as today);
  - **Left unanswered**: the owner chose not to answer it.
- The Knowledge overview shows the count of open gaps beside the other states.

**What changes.** An invoker function `public.knowledge_gaps()` (definer only if the role matrix needs it; it should not), returning the groups and their states; a **Gaps** view on `KnowledgePage.tsx`; the overview's count; the guide.

**Test cases.**
1. Data: a question with no answering entry in a response from the last 90 days is listed; one from 91 days ago, or in an archived response older than that, is not (database).
2. Pricing questions are never listed, whatever their state (database).
3. Two questions worded the same except for case and punctuation, in two responses, form one group with "asked in 2 responses" (database).
4. Each state: learned (with its entry), approved but not yet sent, still to do, left unanswered (database, and browser for how they show).
5. **Open it in the response** opens the response at that question, in its file (browser).
6. Every member sees the same gaps (all can read every response); a signed-out caller is refused (database).
7. A question text containing markup shows as text (browser).
8. With 5,000 questions the function answers in under a second (database, as Sprint 19's L3).

**Out of scope.** Grouping by meaning (Q3); a new "ask an expert" request outside a response (Q3); gaps from **Ask it a question** (nothing about an ask is saved, by design, Sprint 18).

**Boundaries.** Rule 7: nothing is learned from this view; learning still happens only when a response is marked as sent, with provenance. Pricing is never shown or learned.

### S21-3 Configuration as code, checked; and a set-up script. M (O-1)

**The job.** Rory's set-up and yearly key changes stop being hand steps, and a hosted setting that drifts from the repository fails the deploy.

**What changes.**
- **Settings as code, checked (Q4):** the hosted sign-in settings (sign-ups off, site address, redirect addresses) are written in the repository per environment; the deploy check reads each project's settings (read-only; the tokens gain **Auth Config: Read**) and fails, naming the difference, if they do not match. Vercel's settings are already code (`vercel.json`).
- **A set-up and rotation script** (`scripts/setup-secrets.ts`, run by Rory with `npx tsx` on his PC, signed in to the Supabase and GitHub command lines as himself): reads each project's keys and writes the right GitHub secrets, with a dry run first that lists what it would set (names only). No value is printed or passes through Claude. The access tokens and the AI keys are made by hand, by design (Supabase and the providers only issue them in their dashboards); the script then stores them from a prompt that does not echo.
- **Public settings through the connectors:** Vercel's public preview variables can be set by Claude with the Vercel connector, with Rory's approval each time; the runbook in `docs/DEPLOYING.md` says which steps are whose.

**Test cases.**
1. The deploy check passes on staging and the live demo as they are now (CI, staging run).
2. With a setting changed on staging (sign-ups turned on, by Rory, for the test), the staging deploy fails and names it; turned back, it passes (by hand, once: changing a live sign-in setting is Rory's).
3. The script's dry run lists the secrets it would set for each environment, by name only (CI: a unit test with the command-line tools replaced).
4. The script refuses to write a key whose kind does not match its secret (a secret key for an anon key: the Sprint 20 slip), and refuses the live demo's project for a staging secret (CI).
5. Nothing the script or the check prints contains a key (CI: the tests scan the output).

**Out of scope.** Applying sign-in settings automatically (Q4); creating access tokens (Supabase offers that only in its dashboard).

**Boundaries.** The working agreement: credentials stay with Rory and go to automation; Claude never sees a value. Least privilege: the tokens gain read access to sign-in settings only.

### S21-4 One real-AI step on staging. S (F-67)

**The job.** Each staging run proves the real pipeline end to end once: matching, the checker and drafting with the real models, at a cost of a fraction of a penny.

**What changes.** A browser test: on staging, the admin asks "How do you encrypt data at rest?" on Home and sees a drafted answer citing the encryption entry, a calibrated confidence and the checker's verdict; locally (providers off) the same test checks the fallback answer instead, and says which it checked. The demo page names the step that used the real model.

**Test cases.**
1. On staging: a calibrated confidence (not "Not calibrated"), the checker's verdict, and at least one cited entry (staging run).
2. Locally: the fallback answer with "Not calibrated" and its reason (CI).
3. The ask is recorded under the admin's usage, and the daily cap still applies (database tests exist since Sprint 18; the staging run reads the usage line on Governance).

**Boundaries.** Cost: one question per staging run, within staging's own $5 Anthropic limit.

## The sprint as a whole

Order: S21-4 (small, and it exercises staging's AI keys early), S21-1, S21-2, S21-3. About four days. No spike: the unknowns (exact settings fields the Management API returns, the Supabase CLI's key listing on Windows) are tried first inside S21-3, and nothing else depends on them.

**Hand checks for Rory.** Only S21-3 case 2 (changing a sign-in setting on staging is his to do), and running the set-up script's dry run once on his PC. Everything else is on the demo page.

## Questions for Rory

- **Q1 Downloads before every question is decided.** (a) Only when every question is decided, as now, but downloading no longer marks it as sent (recommended: rule 4 holds for every file that leaves the app); (b) a draft download at any time, every undecided answer marked "Draft: not approved".
- **Q2 The stage words.** Recommended, and already expected by the glossary: **Sent**, **Changed since sent**, **Mark as sent**, replacing **Exported**, **Changed since export**, **Record export** everywhere people see them. (Asked only to confirm.)
- **Q3 Gaps.** (a) Group the same wording only, and act on open gaps through the response, as today (recommended: M, nothing new to tune); (b) also group by meaning and add a request to an expert outside any response (L: needs a threshold measured like Sprint 3's, and a new kind of request).
- **Q4 Hosted sign-in settings.** (a) In code and checked by every deploy, read-only; a difference fails the deploy and says what to change (recommended: the tokens never gain write access to sign-in); (b) applied by the deploy, with the tokens given write access to sign-in settings.

## Rory's answers (2 November 2026)

- **Q1:** (a). Downloads once every question is decided; downloading no longer marks the response as sent.
- **Q2:** yes. **Sent**, **Changed since sent**, **Mark as sent**.
- **Q3:** (a). Same wording only; open gaps are acted on in their response.
- **Q4:** (a). Checked on every deploy, read-only.

**One consequence of Q4 for Rory.** Supabase's tokens cannot be changed once made, so S21-3 needs the two access tokens made again with one more permission, **Auth Config: Read**, and stored under the same names. It will be the first thing the set-up script (S21-3) does for him: he makes the two tokens in the dashboard, and the script stores them from a prompt.
