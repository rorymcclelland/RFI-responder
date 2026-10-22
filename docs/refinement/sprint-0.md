# Sprint 0 refinement: baseline and clean-up

Refined 22 October 2026 against `main` at `25c6f07` (the original Bolt export of 11 May 2026). Status: **all nine stories Ready, Sprint 0** (answers agreed 22 October 2026, recorded at the end). Updated the same day to align with the product brief, `docs/PRODUCT.md`: see "Changes after the product brief" at the end.

## Why this sprint exists

Nothing in Sprints 1 to 4 is worth building on the code as it stands. It does not type-check, it parses untrusted spreadsheets with a library that has known high-severity flaws, its knowledge base vanishes on reload, any signed-in user can make themselves an admin, and a public page makes claims the tool cannot back. Sprint 0 makes the base honest, safe and reproducible, and puts the testing and documentation habits in place that every later sprint relies on.

## What the review found (baseline)

| Area | Finding |
|---|---|
| Type check | 10 errors (`tsc`): unused imports, a mistyped Supabase join, session `status` typed as `string` instead of the union |
| Lint | 5 errors, 3 warnings (unused imports, missing hook dependencies) |
| Dependencies | `xlsx` 0.18.5 (npm): high severity, no fix published to npm. `ws` 8.18.3 (via Supabase realtime): high severity, fixable |
| Honesty | `public/factsheet.html` has an invented testimonial and "80% faster" style figures. `synthesis.ts` sets confidence partly from `Math.random()` and picks canned openers at random |
| Knowledge base | Held in React state only (`App.tsx` line 125). Bulk imports and "add to KB" are lost on reload |
| Access control | `user_profiles` lets a user update their own row with no column restriction, so anyone can set `is_admin = true` on themselves. Open sign-up. Seed migration creates users who all share the password `SamplePass123!` |
| Export | CSV export does not neutralise cells starting `=`, `+`, `-`, `@` (formula injection). Word export escapes `<` only |
| Environment | No `.env.example`, no setup instructions, README is a StackBlitz link. Seed users live in a migration, so they would be created in any real deployment |
| Tests and CI | None |

## Stories

### S0-1 Remove misleading content (S)

**The job.** Nobody who opens the repo or the app is told something the code does not do. Rory can show any screen without caveats.

**Before and after.** Before: a factsheet with an invented customer quote and invented figures; a "confidence" that is 30% dice roll; random canned openers so the same question gives different drafts. After: no factsheet; the score shown is the retrieval match score, labelled "Match score"; drafts are deterministic.

**What changes.** Delete `public/factsheet.html` and any link to it. `synthesis.ts`: remove `randomConfidence()` and random opener/closer selection (fixed, neutral wording). `RFIWorkspace.tsx computeConfidence`: score = retrieval match only. UI copy: replace "AI", "generated" or "confidence" wording that implies a model, until Sprint 2 adds one. Note in `JOB_STORIES.md` that 3.2's "AI" wording is aspirational.

**Test cases.**
1. Same question, same KB, run twice: identical draft and identical score.
2. Question with no KB overlap: score 0, draft states no matching source.
3. Question matching one KB entry exactly: score is the top retrieval score, not a blend.
4. `grep -ri "testimonial\|factsheet\|Math.random" src public` returns nothing relevant.
5. Built bundle contains no `factsheet.html`.

**Out of scope.** Better retrieval (Sprint 1), real drafting (Sprint 2).

**Boundaries.** Rule 1 (honesty), directly.

**Dependencies.** None. Do first, a quick win.

**Risks.** Bulk-accept thresholds (80% / 60%) were tuned to the inflated score; with honest scores far fewer items qualify. Accept that until Sprint 1 recalibrates.

**Questions.** None.

### S0-2 Clean build (S)

**The job.** The project type-checks, lints and audits clean, so CI can hold that line from now on.

**What changes.** Fix the 10 type errors properly (type the Supabase join result, narrow session `status` at the database boundary rather than casting). Fix lint errors and the three hook-dependency warnings. `npm audit fix` for `ws`. Generate Supabase types (`supabase gen types`) so database rows are typed at source, as the meeting tool already does.

**Test cases.**
1. `npm run typecheck` exits 0.
2. `npm run lint` exits 0 with zero warnings.
3. `npm audit --omit=dev` shows no high or critical (after S0-3 removes `xlsx`).
4. App still builds and every screen loads (manual smoke test list in the README).

**Out of scope.** Refactoring large components (`RFIWorkspace.tsx` is 874 lines); logged for Sprint 2 when the drafting path is rewritten anyway.

**Boundaries.** None touched.

**Dependencies.** Type generation needs the local database from S0-6; the plain fixes do not. Order: fix errors first, generate types once S0-6 lands.

**Questions.** None.

### S0-3 Safe spreadsheet handling (M)

**The job.** RFI spreadsheets come from customers and are untrusted. Reading them must not expose the user to known parser flaws, and exporting must not hand the customer a file that runs formulas.

**Before and after.** Before: `xlsx` 0.18.5 from npm (prototype pollution and ReDoS advisories, no npm fix); no size limits; CSV cells exported raw. After: a maintained parser, file and row limits with clear errors, safe export in all three formats.

**What changes.** Swap the library in `BulkUploadModal.tsx`, `RFIWorkspace.tsx` and `exportUtils.ts`, behind one small module (`src/lib/spreadsheet.ts`) so the choice is isolated and testable. Limits: file size (proposed 5 MB), rows (proposed 2,000), cell length (proposed 5,000 characters). CSV and Excel export: prefix a `'` to any cell starting `=`, `+`, `-`, `@`, tab or carriage return. Word export: full HTML escaping (`&`, `<`, `>`, `"`).

**Test cases.**
1. Normal: the repo's `sample-questions.csv` and an `.xlsx` of it parse to the same 40 questions.
2. Normal: `.xls` file parses (if that format is kept; see question).
3. Edge: empty file, header-only file, file with blank rows: friendly message, no crash.
4. Edge: question column not first; detection still picks it.
5. Failure: renamed `.exe` as `.xlsx`: rejected with a message.
6. Failure: 6 MB file or 2,001 rows: rejected before parsing the whole file.
7. Hostile: a question `=HYPERLINK("http://evil","click")` exports to CSV and Excel as text, not a formula.
8. Hostile: a question containing `<script>alert(1)</script>` and `&amp;` exports to Word as literal text.
9. Hostile: a header row named `__proto__`: no prototype pollution (object created without prototype).

**Out of scope.** Prompt-injection defences for uploaded text (Sprint 2).

**Boundaries.** Rule 6 (untrusted input).

**Dependencies.** None; can run in parallel with S0-1 and S0-2.

**Risks.** Library choice (question 1).

**Questions.** See Q1.

### S0-4 Persist the knowledge base (M)

**The job.** The knowledge base is the product's core asset. Entries, their source and when they were added must survive a reload and be shared across the team, and this is also where Sprint 1's embeddings will live.

**Before and after.** Before: 8 entries hard-coded in `knowledgeBase.ts`; imports and add-back live only in browser memory. After: a `kb_entries` table; imports and add-back write to it; the KB modal reads from it; each entry records source, who added it and when.

**What changes.** Migration: `kb_entries (id, question, answer, tags text[], source, origin enum('seed','manual','import','response'), origin_ref, created_by, created_at, updated_at, superseded_by references kb_entries, last_reviewed_at)`. The provenance and versioning columns are created now so nothing has to be back-filled when learning arrives in Sprint 3; in this sprint they are written (origin, origin_ref, created_by) or left empty (superseded_by, last_reviewed_at). Hand-added and imported entries are tagged `manual` and `import`, RLS per the S0-5 role matrix. `App.tsx`: load from the database, `addToKB` inserts. `BulkUploadModal`: insert in batches with a duplicate check (same question text, case-insensitive). Seed data moves to the dev seed (S0-6), not a migration. Remove `initialKnowledgeBase` from the bundle.

**Test cases.**
1. Import the 100-row security CSV; reload; 100 entries present with source "Data Protection Policy v3.1" etc., origin `import`, and `created_by` set to the importer.
2. Accept answers in an RFI, "add to KB", reload: they are there, tagged with origin `rfi` and the file name.
3. Import the same CSV twice: second import reports 100 duplicates skipped, adds none.
4. Edge: row missing an answer: skipped and reported, others imported.
5. Failure: database unavailable mid-import: user told how many were saved; no silent partial success.
6. Access: a non-admin member can read entries; whether they can add or delete follows the role matrix (S0-5 test cases).
7. Hostile: answer text containing HTML renders as text in the KB modal.

**Out of scope.** Editing and deleting individual entries in the UI (logged as a backlog candidate), embeddings (Sprint 1), learning at export and supersession (Sprint 3). The existing "add to KB" button stays for now, tagged origin `response`; Sprint 3 replaces it with learning at export.

**Boundaries.** Rule 2 (synthetic data: the seed set and the 100 Q&As stay generic), rule 5.

**Dependencies.** S0-5 (role matrix) for its policies; S0-6 for the local database.

**Questions.** See Q4.

### S0-5 Fix access control (M)

**The job.** The database is safe even though the anon key is public: users can do only what their role allows, and nobody can promote themselves.

**Before and after.** Before: any user can `update user_profiles set is_admin = true where id = auth.uid()` from the browser console. Anyone can sign up. Sessions, questions and opportunities are readable and editable by every signed-in user. After: a written role matrix, policies that implement it, and a test for every cell.

**Role matrix** (agreed; aligned with the product brief). "Member" is any signed-in user; the **response owner** is per response (the opportunity's `owner_id`, defaulting to its creator), not a global role.

| Action | Admin | Response owner | Member |
|---|---|---|---|
| Read opportunities, sessions, questions, KB | Yes | Yes | Yes |
| Create an opportunity (and become its owner), run an RFI session | Yes | Yes | Yes |
| Edit an opportunity, change its owner | Yes | Yes | No |
| Permanently delete an opportunity | Yes (created in error only) | No | No |
| Add to KB (import or add-back) | Yes | Yes | Yes (agreed Q3) |
| Delete KB entry | Yes | No | No |
| Assign questions on a response | Yes | Yes | No |
| Update an assignment | Yes | Yes | Assignee only |
| Edit own display name, title, expertise tags | Yes | Yes | Yes |
| Change anyone's `is_admin` | Yes | No | No |
| Create users | Yes (invite) | No | No |

Archiving replaces deletion as the normal route in Sprint 3; until then the delete button is shown to admins only.

**What changes.** New migration: column-level protection on `is_admin` (revoke update on that column from `authenticated`; admin changes go through a `security definer` function that checks the caller is admin), insert policy that forces `is_admin = false`. `opportunities.owner_id` added (back-filled from `created_by`). Policies rewritten to the matrix. Open sign-up switched off in Supabase auth settings and the sign-up form removed; admins invite users. Seeded shared-password users removed from migrations (dev seed only, S0-6). Existing migrations are left as history; changes are new migrations.

**Test cases** (database tests, run as each role):
1. Member updates own `display_name`: allowed.
2. Member sets own `is_admin = true`: denied.
3. Member inserts own profile with `is_admin = true`: denied, or forced false.
4. Member updates another user's profile: denied.
5. Admin promotes a member via the function: allowed and logged.
6. Member calls the promote function: denied.
7. Owner or member deletes an opportunity: denied; admin: allowed.
12. Owner edits their own opportunity and reassigns ownership: allowed; a non-owner member: denied.
13. Owner assigns a question on their response: allowed; a member who is not the owner: denied.
8. Member updates an assignment not assigned to them: denied.
9. Anonymous (anon key, no session) reads any table: zero rows.
10. Sign-up endpoint with the anon key: rejected.
11. Fresh migration run contains no `auth.users` inserts.

**Out of scope.** SSO, multi-tenant separation between organisations (one organisation per deployment, confirmed in the product brief).

**Boundaries.** Rules 3 and 5.

**Dependencies.** S0-6 for running the database tests. S0-4 uses the matrix.

**Questions.** See Q2 and Q3.

### S0-6 Reproducible local environment (M)

**The job.** Anyone (Rory, an interviewer, CI) can go from a clean clone to a running app with sample data by following the README, without the original Bolt-hosted project.

**What changes.** `supabase/config.toml` via `supabase init`; local stack with the Supabase CLI (Docker). `supabase/seed.sql`: dev-only users (admin and member, passwords documented as dev-only), the 8 seed KB entries, two sample opportunities. `.env.example`. npm scripts: `db:start`, `db:reset`, `db:test`, `types`. README setup section.

**Test cases.**
1. Clean clone, follow README: app runs at localhost, sign in as the dev admin, see seed KB and opportunities.
2. `supabase db reset` rebuilds from migrations and seed with no errors.
3. Missing `.env`: app shows a clear configuration error, not a blank screen.
4. Production-like run (migrations only, no seed): no users, no KB, no sample data.

**Out of scope.** A hosted demo instance (decided in Sprint 4).

**Boundaries.** Rule 3: `.env` stays ignored; `.env.example` has placeholders only.

**Dependencies.** None; it unblocks S0-2 type generation, S0-4, S0-5 tests and S0-7.

**Risks.** Docker on Rory's PC (question 5). The CLI and Docker run fine in the cloud workspace where Claude builds, so this only matters for Rory running it himself.

**Questions.** See Q5 and Q6.

### S0-7 Tests and CI (M)

**The job.** Every change from here on is checked automatically, and the test suite is something Rory can point to in interviews.

**What changes.** Vitest for pure logic: retrieval, draft assembly, question-column detection, spreadsheet module, export escaping. Database tests (pgTAP via `supabase test db`) for the S0-5 matrix. GitHub Actions workflow on push and pull request: install, typecheck, lint, unit tests, audit, then start Supabase and run database tests.

**Test cases.**
1. Workflow passes on the Sprint 0 branch.
2. A deliberately introduced type error fails the workflow (tried once, then reverted).
3. A policy change that lets a member set `is_admin` fails the database tests.
4. Coverage report produced for `src/lib` and the pure modules (no target set yet).

**Out of scope.** Browser end-to-end tests (backlog candidate for Sprint 4, for the demo path).

**Dependencies.** S0-6. Test cases written in S0-1 to S0-5 land here.

**Risks.** Supabase in Actions adds a few minutes per run; acceptable for a private repo's free minutes.

**Questions.** None.

### S0-8 Documentation baseline (S)

**The job.** The repo explains itself honestly from day one, and decisions are recorded as they are made, so the Sprint 4 documentation is assembly rather than archaeology.

**What changes.** README: what it is (opening from `docs/PRODUCT.md`), current status (stated plainly: keyword retrieval and template drafting until Sprints 1 and 2), stack, setup, scripts, project rules. `docs/decisions/` with numbered short decision records: 0001 keep React, Vite and Supabase; 0002 spreadsheet library; 0003 role matrix; 0004 local-first environment; 0005 AI route (from S0-9). `CLAUDE.md` (agent context: rules, commands, where things live). `.bolt/` removed. `JOB_STORIES.md` moved to `docs/`.

**Test cases.**
1. A reader with only the README can describe what the tool does today without overstating it.
2. Every decision taken in this sprint has a record.

**Boundaries.** Rule 1.

**Dependencies.** Written last, after the others settle.

### S0-9 Spike: where the AI runs (S, time-boxed to half a day)

**The question.** Sprints 1 and 2 need an embedding model and a drafting model. Where they run decides the architecture: a local model (Ollama on Rory's PC) can only be reached if the app's server side runs on the same machine, which rules out a hosted demo using it; a hosted API works anywhere but sends RFI text to a provider.

**Output.** A one-page decision note (`docs/decisions/0005`) comparing: local Ollama embeddings and model; hosted embeddings (for example Voyage or OpenAI) with Claude for drafting; and a mixed option with a provider switch behind one interface. For each: privacy, cost for the 100-entry KB and a typical 40-question RFI, demo-ability, and setup effort. Includes a quick check that pgvector is available locally and on hosted Supabase.

**Why now.** Sprint 1 cannot be refined without it, and a spike may not share a sprint with the stories that depend on it.

**Out of scope.** Building retrieval.

## The sprint as a whole

**Order.** S0-1 and S0-3 first (stand-alone quick wins), S0-2 fixes alongside; then S0-6, which unblocks S0-5, S0-4 and S0-7 in that order; S0-9 any time; S0-8 last.

**Size.** 4 small and 5 medium, roughly 6 to 7 working days of build at the pace of earlier sprints. If that is too much for one sprint, the natural split is to move S0-7's database tests in CI to Sprint 1 (unit tests and CI stay); everything else is a foundation for Sprint 1.

**Spike check.** S0-9 is the only spike. No Sprint 0 story depends on it; Sprint 1 does, and will be refined at its close.

## Questions for Rory

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Which spreadsheet library replaces `xlsx` 0.18.5? | (a) SheetJS 0.20.x from SheetJS's own registry: patched, same API, keeps `.xls`. (b) ExcelJS: on npm, well maintained, but drops old `.xls` files | (a): smallest change, keeps every format the stories promise |
| Q2 | Sign-up | (a) Invite-only, admins create users. (b) Open sign-up | (a): a tool holding a firm's bid answers would never allow open sign-up |
| Q3 | Who can add to the knowledge base? | (a) Admins only, members propose. (b) Any member | (a): the KB is what the AI will quote, so it is a governance point worth showing; the "propose" flow is a later story |
| Q4 | Treat the 100 security Q&As and seed entries as synthetic demo data? | (a) Yes, label them synthetic in the repo. (b) They came from somewhere real, so replace them | (a), if you confirm they were generated rather than copied from a real questionnaire |
| Q5 | Do you want to run it on your own PC? | (a) Yes: needs Docker Desktop and the Supabase CLI. (b) No: Claude runs it in the cloud workspace and you read the code and test results on GitHub | (b) for now, (a) before Sprint 4 so you can demo it |
| Q6 | The original Bolt-hosted Supabase project | (a) Pause or delete it. (b) Keep it as the hosted demo | (a): it has open sign-up and shared-password users; a clean hosted project can be set up in Sprint 4 |

## Answers and changes (22 October 2026)

| # | Answer | Effect |
|---|---|---|
| Q1 | SheetJS 0.20.x from SheetJS's registry | S0-3 as written; `.xls` kept (test case 2 stays) |
| Q2 | Invite-only | S0-5 as written (test case 10 stays) |
| Q3 | Any member can add to the KB | Role matrix changed: members may import and add back; deleting entries stays admin-only. Every entry records `created_by`, so additions remain traceable. S0-4 test 6 and S0-5 tests follow the new matrix |
| Q4 | Generated; label as synthetic | S0-8 README and a header note on both CSVs say "synthetic demo data" |
| Q5 | Not yet | Claude runs the stack in the cloud workspace; Rory reads code and CI results on GitHub. Docker set-up on Rory's PC before Sprint 4 |
| Q6 | Pause or delete the Bolt-hosted project | Action for Rory (Claude has no access to it): pause or delete it in the Supabase dashboard |
| Size | Keep the sprint whole | No stories moved |

All nine stories: **Ready, Sprint 0**.

## Changes after the product brief (22 October 2026)

Rory briefed the original intent (now `docs/PRODUCT.md`). Effect on Sprint 0, which stays a clean-up sprint:

| Story | Change |
|---|---|
| S0-4 | Knowledge-base table gains provenance and versioning columns now (`origin` includes `manual` and `response`, `superseded_by`, `last_reviewed_at`), so Sprint 3's learning loop needs no back-fill |
| S0-5 | Role matrix gains the per-response **owner** (`opportunities.owner_id`). Only the owner or an admin edits a response or assigns its questions; permanent deletion is admin-only, ahead of archiving in Sprint 3. Two test cases added (12, 13) |
| S0-8 | README opens from the product brief |
| Backlog | Rule 4 reworded so the owner's recorded bulk approval counts as human approval; rule 7 added (learning only with provenance). Later sprints re-ranked into five: retrieval and calibration; grounded drafting and safety gates; workflow and learning loop; ingestion and governance pack; publish |

Sizes unchanged: S0-4 and S0-5 stay M. All nine stories remain **Ready, Sprint 0**.
