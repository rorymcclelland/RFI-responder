# Sprint 7 refinement: documentation and publish

Refined 24 October 2026, for Rory's sign-off before building. Backlog: `docs/BACKLOG.md` (Sprint 7 proposed at the Sprint 6 review). The goal of the whole upgrade is a codebase Rory can show and discuss: this sprint makes it readable by someone who was not here, closes two safety gaps the published figures rest on, and publishes it. Project rule 1 (never claim more than the code does) governs every word that leaves.

## What refinement found

- **F-33 has numbers behind it.** Of 293 questions at or above the 80% bulk line in the Sprint 6 answerability run (voyage-4 + judge), 26 had a "partly" verdict, and 4 of those (15%) had the wrong top entry, against 18 of 267 (7%) for "yes". Requiring "yes" for bulk approval would send about 9% of bulk-eligible questions to individual review.
- **The git history is clean of secrets.** A scan of all 102 commits found only the deliberately fake keys used in CI tests (`sk-should-never-appear`), no `.env` other than `.env.example`, and no hosted Supabase project address. The emails are the synthetic seed users, `example.invalid` test addresses, and Rory's own on his commits. The original Bolt commit contains invented contact details (`sales@rfirespond.com`, `rfirespond.com`), removed in Sprint 0 (S0-1) but still in history.
- **`main` holds only the initial commit**; each sprint branch builds on the last. Publishing means bringing `main` up to the final sprint.
- **A fresh install shows two empty responses.** `supabase/seed.sql` has the knowledge base, users and two response names; everything else on Rory's PC was created during end-to-end runs. A first-time reader would see none of the workflow.
- **CSV cannot carry file metadata**, so a machine-readable marker there has to be a column (F-27).
- **Leaked-password protection (F-8) is a setting on a hosted Supabase project.** It matters only if something is hosted.

## Stories

### S7-1 Bulk approval needs a "yes" verdict (F-33)

**The job.** A draft is bulk-approved only when the checker said the entries answer the question ("yes"), not merely in part. We know it works when a "partly" question at 80% or more stays pending after bulk approval and is counted.

**Before and after.** Before: "partly" at 80% or more is bulk-approvable, kept safe on near misses only by the drafter's refusal. After: `bulk_accept` leaves "partly" and "no" verdicts for individual review and reports how many; questions calibrated on similarity alone (no checker configured, verdict empty) keep today's rule.

**What changes.** `bulk_accept` (new migration), the bulk bar's held-back text, `describeBulk`, the card (shows why it is not bulk-eligible), model card, risk register R-01/R-12.

**Test cases.** 1. "yes" at 85%: accepted by bulk at 80%. 2. "partly" at 87.5%: held, counted as `heldPartly`. 3. "no" with a draft (should not happen, but if it does): held. 4. No checker (verdict empty, similarity calibration): accepted as today. 5. Individual acceptance of a "partly" question still works. 6. The "All eligible" button follows the same rule.

**Boundaries.** Rule 4 (human in the loop) strengthened. **Size.** S.

### S7-2 A draft citing a replaced entry is held from bulk (F-32)

**The job.** If an entry a draft cites has since been replaced by a newer one, the draft is reviewed individually, because it was written from outdated text.

**What changes.** `private.source_gate` and `entry_review_status` treat a superseded entry like an overdue one: gate `stale_source`, reason "Cites KB-0012 (replaced by KB-0118), so it is reviewed individually." The release trigger and the live check at bulk approval pick it up with no further change.

**Test cases.** 1. A pending question citing an entry that is then superseded is held at bulk approval, with the replacement named. 2. Processing a question that cites a superseded entry gates it. 3. A question citing only current entries is unaffected. 4. Accepted, exported and archived questions are not changed.

**Size.** S.

### S7-3 Exported answers say how they were produced (F-27)

**The job.** Every exported answer carries a machine-readable record of whether a model drafted it, whether a person edited it, and who approved it, so a recipient's tools (and an auditor) can tell. This is a step towards EU AI Act Article 50(2) marking, not a claim of compliance; whether the duty applies to this internal tool is not settled (`docs/governance/FRAMEWORKS.md`), and Claude is not a lawyer.

**Values.** `model-drafted, approved unedited`; `model-drafted, edited by a person`; `written by a person`; `not answered`. Taken from what the database recorded (draft kind, generated against final answer, the approval).

**What changes (Q2).** Excel: a "Provenance" sheet (question number, origin, model, prompt version, approved by, when) and document properties (`AIGenerated`, `AIModel`, `Generator: RFI Respond`). Word (.doc as HTML): `<meta>` tags in the head and a provenance table at the end. CSV: an `answer_origin` column. Wording in the exported files follows Q2.

**Test cases.** 1. Each origin value from the right combination of recorded facts. 2. Excel: properties present, Provenance sheet row per question. 3. Word: meta tags present and escaped; table rows match. 4. CSV: column present, values neutralised against formula injection like every other cell. 5. Hostile: a model name or approver name with markup or a leading `=` is escaped or neutralised.

**Size.** M.

### S7-4 The layout fits narrower windows (F-10)

**The job.** Every screen works at 768 px wide (a tablet, or a laptop window side by side), with no horizontal scrolling of the page.

**What changes.** Overview, workspace (bulk bar, filters, cards, preview step), assignments, governance tabs, knowledge-base window: wrapping and stacking at the `md` breakpoint. Phones are out of scope (the review work needs a wider screen).

**Test cases.** Checked in the browser at 1280, 1024 and 768 px on each screen: no horizontal page scroll (measured: `scrollWidth` not above `clientWidth`), no clipped buttons, the bulk bar and card actions reachable.

**Size.** M.

### S7-5 Demo data that shows the workflow (Q4)

**The job.** A fresh install shows responses at each stage, so a reader (and the screenshots) see what the tool does.

**What changes.** `supabase/seed.sql` (synthetic only, never in migrations): four fictional responses, one per stage (new, in review with a mix of high, medium, gated and held questions, exported with learning recorded, archived as won), with assignments and an approval history. Drafts, verdicts and confidences come from Q4's source, and the seed says where they came from (dates, models, prompt versions) so nothing is presented as more than it is.

**Test cases.** 1. A fresh `supabase db reset` loads without errors and the overview shows the four stages. 2. Every response, company and person name is marked fictional or uses `example.com`. 3. The database tests still pass on a seeded database (the shim). 4. The seed states its provenance in a header comment and in the response names or descriptions.

**Size.** M.

### S7-6 Documentation for a first-time reader

**The job.** Someone opening the repository understands in five minutes what it is, how it works, what has been measured, and what it does not do; and can run it in thirty.

**What changes.**
- `README.md` rewritten: what it is, a screenshot, what the code does and does not do (honest limits up front), how it was built (the sprint method, with links to refinements, reviews and decisions), quick start.
- `docs/ARCHITECTURE.md`: a diagram (Mermaid, which GitHub renders) of the browser, Supabase (Auth, PostgREST, row-level security, the private schema), the Edge Functions and the providers, with the trust boundaries and where each control sits; then the data flow of one question from upload to export and learning.
- `docs/evals/README.md`: the current figures in one table, each linked to its report, checked by a test like the model card's.
- Governance pack refreshed: provider terms and prices rechecked on the day (looked up, not remembered), data handling, the frameworks note.
- `CONTRIBUTING.md` not needed (Q6 decides whether outside changes are invited).

**Test cases.** 1. Every figure in the evaluations summary matches its report (test). 2. Every file path and link in README and ARCHITECTURE exists (test). 3. British spelling and no em dashes (test over `docs/` and README). 4. A reader check: an agent that has not seen the project reads only the README and ARCHITECTURE and answers ten questions about it; wrong answers mean the docs are unclear.

**Size.** M to L.

### S7-7 Screenshots (Q5)

**The job.** Six to eight screenshots of the main moments (overview, upload preview, review with confidence and checker, bulk approval, assignment inbox, governance usage, export), in `docs/screenshots/`, used in the README.

**Test cases.** 1. Every screenshot shows only demo data. 2. Each is referenced from the README and exists (covered by S7-6 test 2).

**Size.** S.

### S7-8 Publish (Q3, Q6, Q7)

**The job.** The repository is public, on `main`, with a licence, and nothing in it or its history that should not be.

**What changes.** Licence file (Q6). History handled as Q7 decides. `main` brought up to the final sprint branch (fast-forward, so every story commit is kept), set as the default branch, CI green on it. Repository description and topics. A short `docs/DEPLOYING.md` if Q3 keeps it local-only, covering what a hosted deployment would need first (F-8 leaked-password protection, provider spending limits, the Voyage zero-retention opt-out, R-11, R-15).

**Boundaries.** Making the repository public is Rory's action, in GitHub's settings, after he has read the final state: Claude prepares everything and does not change the visibility.

**Test cases.** 1. Secret scan of the full history repeated on the final branch, clean. 2. CI green on `main`. 3. The README renders on GitHub (Mermaid included), checked after Rory makes it public.

**Size.** S (plus Rory's steps).

### S7-9 CV and website wording checked against the code (Q8)

**The job.** Every claim Rory makes about RFI Respond in his CV and on his website is true of the published code.

**What changes.** A claims table: each sentence about the project on the site and in the CV's current master version, the evidence for it (file, test or report), and a proposed rewording where it overclaims or undersells. Rory makes the edits himself. Submitted application materials are not touched.

**Size.** S.

## Not in this sprint

F-16 (calibration intervals) ranks next: it would make the published figures more honest about their uncertainty, but it is a larger piece of evaluation work. C-1, F-35, F-19, F-14 and F-15, F-20, F-34, F-2, F-3 and F-4 stay ranked in the backlog. F-8 is in the sprint only as documentation unless Q3 chooses a hosted demo.

## The sprint as a whole

Order: S7-1 and S7-2 (small safety fixes, change figures and docs), S7-3, S7-4, S7-5 (demo data), then S7-7 screenshots (needs S7-4 and S7-5), S7-6 docs (needs the screenshots), S7-9, and S7-8 last. Sizes: four S, four M, one M to L; about five to six days. No spike.

## Questions for Rory

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | F-33 | (a) Bulk approval needs "yes" (about 9% fewer bulk-eligible). (b) Keep "partly", but exclude it when similarity is low. (c) Leave as is, stated as a residual | (a): simplest rule, and "partly" was wrong twice as often |
| Q2 | F-27 marker form | (a) Machine-readable only: Excel properties and a Provenance sheet, Word meta tags and an end table, a CSV column. (b) As (a) plus a visible line on each answer. (c) Leave exports unmarked, documented | (a): marks every file without changing the answers the customer reads; the organisation decides what to tell its customer |
| Q3 | Hosting | (a) Public repository, run locally; a deploying guide lists what hosting needs (F-8 and others). (b) Also a hosted demo with demo accounts | (a): no running costs, no live keys, no public sign-in to protect; a hosted demo can be its own sprint |
| Q4 | Demo data source | (a) Recorded from a real run of the pipeline on synthetic questions, with its date and models stated. (b) Written by hand and labelled as illustrative | (a): what the reader sees is what the code produced |
| Q5 | Screenshots | (a) A Playwright script on your PC captures fixed views at fixed sizes (repeatable; installs a test browser, about 150 MB). (b) You take them from a shot list. (c) Also a short video | (a): repeatable when the screens change; video later if wanted |
| Q6 | Licence | (a) MIT: anyone may reuse with attribution. (b) Apache 2.0: the same plus an explicit patent grant. (c) No licence: visible but not reusable | (a) if reuse is welcome; (c) if it is a portfolio piece only. Not legal advice |
| Q7 | Git history | (a) Keep it all: the Bolt original and every story commit show the upgrade, and the scan is clean. (b) Squash to one commit | (a): the history is the evidence of the method |
| Q8 | CV and website | (a) Claims table and proposed wording; you edit. (b) Leave them out of this sprint | (a): the code and the claims go public together |

## Answers (Rory, 24 October 2026)

| # | Answer |
|---|---|
| Q1 | Bulk approval needs a "yes" verdict |
| Q2 | Machine-readable marking only: Excel properties and a Provenance sheet, Word meta tags and an end table, a CSV column |
| Q3 | Public repository, run locally; a deploying guide lists what hosting would need (F-8 stays open for a hosted sprint) |
| Q4 | Demo drafts and scores recorded from a real run on synthetic questions, with date and models stated |
| Q5 | A Playwright script on Rory's PC captures the screenshots; no video this sprint |
| Q6 | No licence: the README says no licence is granted and all rights are reserved, so the code is visible but not offered for reuse (GitHub's own terms still let people view and fork public repositories). Not legal advice |
| Q7 | Keep the full history |
| Q8 | A claims table with proposed wording; Rory edits his CV and website himself |

All nine stories are Ready.

## Close (25 October 2026)

**Checks, with evidence.** CI green on `sprint-7` (all three jobs). 545 unit tests and 227 database tests at the close; typecheck and lint clean.

| Check | Result | Held? |
|---|---|---|
| S7-1: "yes" accepted in bulk; "partly" and "no" held and counted; similarity-only as before | Database tests 1 to 6, and test 7 added at the review | Yes |
| S7-1 on screen | Bulk buttons greyed with the reason when nothing is eligible (local PC, Bluefin). A pending "partly" question at 80% or more was not in the demo data, so the held case was checked by the database tests only | Partly (see F-37) |
| S7-2: a draft citing a replaced entry is held, naming the replacement | Database tests | Yes |
| S7-3: every export carries the record | Built in the browser on the local PC as James (Larkspur), without downloading: CSV `answer_origin` column; Word `ai-generated` and model meta tags and a "How each answer was produced" table; Excel Provenance sheet and a document description ("6 of 7 answered questions were drafted by a model"). The Excel title property is empty (F-36) | Yes |
| S7-4: every view fits 768 px | `docs/screenshots/layout-check.json`: all eight views fit | Yes |
| S7-5: demo at four stages from a real run | Recorded 25 October 2026 with usage (73 Claude calls); Juniper (new), Bluefin (in review), Larkspur (exported), Harbour (archived, won); seed regenerated and tested | Yes |
| S7-6: docs for a first-time reader | A reader given only the README and the architecture page found four gaps (Word extraction drawn in the browser, no pricing branch, "unchecked" undefined, R-06 unexplained), all fixed; docs tests check figures, links, paths and spelling | Yes |
| S7-7: screenshots by script | Eight views captured on the local PC | Yes |
| S7-8: history scan, main, CI on main | Full history (117 commits, 744 file versions): only the deliberately fake keys in tests and CI, and `env(...)` placeholders in the Supabase config. `main` brought up to `sprint-7` at the close | Yes; the public switch and the README render check are Rory's |
| S7-9: claims table | `claude/rfi-respond-claims-table.md` in the project; Rory edits his CV and website | Yes |

**Bugs found and fixed in the sprint.** BUG-23: the demo-seed database test collided with the real demo data (the test now strips the demo section). BUG-24: the screenshot script timed out signing in the second user (a fresh browser session per user). BUG-25: the screenshot script looked for the governance tabs as buttons. BUG-26: the "new" demo response showed "In review", and the governance page showed $0.0000 per question, because the seed had no usage (the new response has no questions; the recording now keeps each call's tokens).

**Independent security review.** No high findings; two medium and five low, all fixed and tested (`20261027110000_sprint7_review_fixes.sql`, commit `7f66757`):

1. (Medium) With a reranker as the checker, questions with a score but no verdict were bulk-approved as if no checker were configured. Now held and counted (`heldNoVerdict`).
2. (Medium) The CSV and the export screen said the file recorded who approved each answer; the CSV had the origin only. It now has model, prompt version, approver, time and how; the Word table gained the prompt version and time.
3. (Low, worse than reported) A no-draft placeholder accepted unedited was exported as "written by a person" and learned into the knowledge base. The database now refuses it for everyone; the card offers "Write an answer"; earlier records export as "placeholder accepted unedited".
4. (Low) The seed generator's quoting could be ended by dollar-quote text. Refused; plan numbers checked.
5. (Low) The evaluations summary named the wrong test, and the check only looked for a figure anywhere in its report. It now checks each figure's own row and column.
6. (Low) The governance screenshot includes two embedding calls made on the local install after the seed loaded; the README says so (cause not established: F-38).
7. (Low) The card now says why a drafted question is left out of bulk approval.

**Checked after the close (Rory, 25 October, local PC).** As Priya on Bluefin, A11 (no draft) offers "Write an answer" instead of Accept; the box opens empty; "Save & Accept" stays greyed until text is typed and greys again when it is deleted. The hold-reason line on the card has no demo case to show it (F-37) and is covered by unit tests.

**After publishing (Rory, 25 October).** The repository is public, with its description and topics; the README renders with all seven screenshots. BUG-27: the architecture page's sequence diagram did not render on GitHub, because a semicolon ends a statement in Mermaid and three messages contained one. Fixed, both diagrams checked with the Mermaid renderer (which reproduced the failure), and a docs test now refuses a semicolon inside a diagram.

**Raised at the close, now in the backlog.** F-36 Excel title property empty. F-37 the demo data has no pending "partly" question at the bulk line. F-38 the source of two embedding calls after a fresh seed is not established, and the recording does not keep embedding usage. F-39 the screenshot script checks that the app is local, not that the Supabase address in `.env` is.
