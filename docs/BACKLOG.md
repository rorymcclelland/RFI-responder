# RFI Respond: upgrade backlog

Started 22 October 2026. Product brief: `docs/PRODUCT.md` (the reference for every story). Goal: take the Bolt prototype to an acceptable standard (sound code, real and proportionate use of AI, safety and governance built in, full documentation), then make the repo public as a portfolio piece.

Way of working: Claude writes the code, Rory reads and questions it. Each sprint is refined before it starts (`docs/refinement/sprint-N.md`) and closed with a review; anything not delivered goes back here and the backlog is re-ranked. The repo stays private until the final sprint.

## Project rules (checked against every story)

1. **Honesty.** Nothing in the code, UI, docs or demo claims more than the code does. No invented customers, testimonials or performance figures. Claims elsewhere (CV, website) follow `_context\shared\positioning.md`.
2. **Synthetic data only.** No real company's questionnaire, policy or customer data in the repo, the database or any demo.
3. **Secrets stay server-side.** No API keys in the browser bundle or the repo. Only the Supabase anon key is public, and the database rules must hold with it in an attacker's hands.
4. **Human in the loop.** The AI drafts; a person approves. Every answer in an exported response has a named human decision behind it: either an individual review, or the response owner's bulk approval above a stated threshold, recorded with who, which threshold and when. Pricing and legal or contractual questions are never bulk-approved. Calibrated confidence is what makes bulk approval safe.
5. **Least privilege.** Every table has row-level security matched to a written role matrix.
6. **Untrusted input.** Uploaded spreadsheets and questions are treated as hostile (malformed files, formula injection, prompt injection from Sprint 2).
7. **The knowledge base only learns with provenance.** Every entry records who, from where and when, and what it superseded. Pricing answers are never learned automatically.

## Sprint 0: baseline and clean-up

Refinement: `docs/refinement/sprint-0.md`

| ID | Story | Acceptance criteria (summary) | Size | Status |
|---|---|---|---|---|
| S0-1 | Remove misleading content | Factsheet deleted; random confidence removed; UI and docs describe what the code does | S | Done, Sprint 0 |
| S0-2 | Clean build | Zero type errors, zero lint errors, no high-severity audit findings | S | Done, Sprint 0 |
| S0-3 | Safe spreadsheet handling | Vulnerable library replaced; upload limits; export escapes formula injection | M | Done, Sprint 0 |
| S0-4 | Persist the knowledge base | Entries stored in the database with source; survive reload; imports and add-back write to it | M | Done, Sprint 0 |
| S0-5 | Fix access control | Users cannot make themselves admin; written role matrix; policies match it; no shared-password users in migrations; sign-up policy settled | M | Done, Sprint 0 |
| S0-6 | Reproducible local environment | One documented command sequence brings up database, seed data and app from a clean clone | M | Done, Sprint 0 |
| S0-7 | Tests and CI | Unit tests for pure logic; database access tests; GitHub Actions runs typecheck, lint, tests, audit on every push | M | Done, Sprint 0 |
| S0-8 | Documentation baseline | README rewritten; decisions log started; agent context file | S | Done, Sprint 0 |
| S0-9 | Spike: where the AI runs | Time-boxed note settling embedding and drafting model route and its hosting consequences | S | Done, Sprint 0 (answer: provider switch, decision 0005) |

### Sprint 0 review (22 October 2026)

**Checks, with evidence.** CI green on all three jobs (type check, lint, unit tests, audit, build; 73 database tests on Postgres; migrations and auth settings on the real Supabase stack). 43 unit tests. A deliberate type error failed CI on a throwaway branch (S0-7 test 2). End-to-end run in a browser on Rory's PC against local Supabase: sign-in, import of 100 entries persisting across reload, 40-question upload and drafting, assignment, bulk accept, add-back (31 added, 2 duplicates skipped), member restrictions. An independent security review found seven gaps, all fixed and tested (decision 0003).

**Bugs found and fixed in the sprint.** BUG-1: bulk accept never saved (Bolt-era); fixed, unit-tested and re-checked end to end (33 accepted after reload). BUG-2: `[auth.email] enable_signup = false` disabled email login entirely; fixed, caught by CI. BUG-3: test shim granted to a role before creating it; fixed.

**Decisions at the review.** Spike S0-9 answered: provider switch, hosted Voyage and Claude by default, local Ollama mode (decision 0005 agreed). Rory will provide Voyage and Anthropic keys. Japanese test questions are machine-translated, checked by back-translation and labelled unreviewed until a native reader checks them. Local Docker on Rory's PC for now (decision 0004).

**All nine stories Done, Sprint 0.** Nothing returned.

### Where every review item now lives

| Item | Now |
|---|---|
| F-1 End-to-end browser test | Done in Sprint 0 (review) |
| F-12 Generous keyword confidence | Folded into S1-6 |
| F-9 Silent save errors | Proposed for Sprint 1 |
| F-2 Generated database types | Backlog, from Sprint 0 review; now possible on Rory's PC |
| F-5 Split RFIWorkspace | Sprint 2 (drafting rewrite) |
| F-6, F-7, F-11 | Sprint 3 (learning loop and readiness workflow); F-11 near-duplicates move there from Sprint 1, since supersession is where they matter |
| F-3 Invite screen | Sprint 4 |
| F-8, F-10 | Sprint 5 (hosted demo, layout polish) |
| F-4 Tailwind 4 | Backlog, low priority |

## Sprint 1: real retrieval and calibrated confidence (confirmed 22 October 2026)

Refinement: `docs/refinement/sprint-1.md`

Goal: find the right knowledge-base entry by meaning, in English and from Japanese, and make "confidence" mean what it says, measured on an evaluation set.

| ID | Story | Why now | Size | Status |
|---|---|---|---|---|
| S1-1 | Evaluation set: two English paraphrases of each of the 100 synthetic questions, one Japanese version (machine-translated, back-translation checked, labelled unreviewed), and questions the knowledge base cannot answer | Everything else in the sprint is judged against it | M | Done, Sprint 1 (364 items after near misses were added at the review) |
| S1-2 | Embedding provider behind one interface, in a Supabase Edge Function: Voyage (hosted) and Ollama (local); key held server-side | Decision 0005 | M | Done, Sprint 1 |
| S1-3 | Vectors in the knowledge base: pgvector column with model name and dimension, embedded on import and add-back, re-embed command | Retrieval needs them; storing the model prevents mixing vectors | M | Done, Sprint 1 (gaps filled after import and on sign-in, not a separate command) |
| S1-4 | Model bake-off: keyword baseline against voyage-4, qwen3-embedding and bge-m3, English and Japanese-to-English, recall@5 and MRR; choose the model (Rory runs the local half on his PC) | Choose by measurement, not leaderboard | M | Done, Sprint 1 (decision 0006) |
| S1-5 | Hybrid retrieval in the app: vector and keyword results combined (reciprocal rank fusion) in a database function | The product's core improvement | M | Done, Sprint 1 (ranks by meaning, keywords as fallback: fusion measured worse) |
| S1-6 | Calibrated confidence: score mapped to the measured chance the top entry is right, with a reliability chart; "no good match" below a floor (folds in F-12) | Makes bulk approval safe (project rule 4) | M | Done, Sprint 1, with a residual accepted by Rory: the abstention bar is not met for near misses; the fix is Sprint 2's answerability check |
| F-9 | Report failed saves for single accept, edit and skip, and question inserts | Small reliability fix in code this sprint touches | S | Done, Sprint 1 |

Order: S1-1 and S1-2 first (independent), then S1-3, S1-4, S1-5, S1-6; F-9 any time. No spike in this sprint; S1-4 is a measurement whose design is already known, and the stories after it do not change shape whichever model wins.

### Sprint 1 review (22 October 2026)

**Checks, with evidence.** 103 unit tests and 87 database tests pass; type check and lint clean; the built bundle contains no provider details (now a CI step). Model comparison and calibration run on Rory's PC (`docs/evals/retrieval-2026-10-22.md`, `docs/evals/calibration-2026-10-22.md`, set 2026-10-22.2). In the app on Rory's PC with voyage-4: 108 entries embedded; 40 sample questions plus 6 near misses run; Japanese questions find the right English entry (encryption at rest, incident handling); keyword-only matching works when no vector is given; a Japanese near miss (cyber insurance, 20%) shows "No confident match".

| Bar (agreed at refinement) | Result with voyage-4 | Held? |
|---|---|---|
| English recall@5 at least 90% | 99.5% | Yes |
| Japanese recall@5 at least 80% | 100% (machine-translated, unreviewed) | Yes |
| Calibration error at most 0.10 | 0.036 | Yes |
| 80% of unanswerable questions below the floor | 62.5% overall; 35.3% of near misses | **No** (residual accepted) |
| F-12: fewer than 33 of 40 sample questions at 80% or more without evidence | 33 of 40; the 7 below include mean time to detect, which the knowledge base does not answer | Partly: the known gap now sits below the bulk line. Correction (Sprint 2): DSARs were also listed here as unanswerable, but entry KB-0015 (GDPR) does answer them (30-day response SLA); the item was removed from the near-miss set (set 2026-10-22.3) |

**Found at the review and fixed.** BUG-4: source chips and the entry window multiplied similarity by 333 (Sprint 0's keyword ceiling), showing matches of 120%; now shown as similarity, labelled not a probability. The first unanswerable set held only off-topic questions, which made abstention look better than it is; 34 near misses were added (set 2026-10-22.2) and the calibration report now shows near misses and wrong top entries at or above the 80% bulk line (voyage-4: 1 of 34, 7 of 166).

**Decisions at the review.** Keep the 0.3 floor and record the abstention bar as not met; an answerability check goes into Sprint 2 (decision 0006, point 5). Hosted default voyage-4. Local default qwen3-embedding:0.6b, confirmed by Rory: better recall and calibration than bge-m3, which lets fewer near misses reach the bulk line (2 of 34 against 6); the answerability check covers that. Decision 0006 agreed.

**All seven items Done, Sprint 1.** S1-6 carries the residual above. Nothing returned.

### Where every Sprint 1 review item now lives

| Item | Now |
|---|---|
| Near misses pass the floor | Sprint 2, answerability check (proposed S2-1) |
| BUG-4 Source similarity shown as 120% | Done in Sprint 1 (review) |
| F-13 Right Japanese matches score about 77%, so never reach the bulk line | Proposed for Sprint 2 with the answerability check, which changes confidence anyway |
| F-14 Reviewed, reworded Japanese evaluation items | Backlog, from Sprint 1 review; needs a native reader |
| F-15 Near-miss set is small (34) and written by Claude | Backlog, from Sprint 1 review; grows with Sprint 2's red-team and labelled sets |
| Local default model | qwen3-embedding:0.6b, confirmed at the review (decision 0006) |

## Sprint 2: grounded drafting and safety gates (confirmed 22 October 2026)

Goal: a draft that says only what the knowledge base supports, and questions that must not be bulk-approved (near misses, pricing, legal) kept away from bulk approval, measured on evaluation sets.

| ID | Story | Why in this sprint | Size | Status |
|---|---|---|---|---|
| S2-0 | Evaluation sets: gate set (pricing, legal, lookalikes), drafting labels, red-team set (injected questions and entries) | They judge the rest of the sprint; written first | S | Done, Sprint 2 (plus 30 held-out gate questions) |
| S2-1 | Answerability check: compare Voyage rerank-2.5, rerank-3 and Claude Haiku 5.5 as judge on the Sprint 1 set; the chosen signal feeds calibrated confidence | The one Sprint 1 bar not met | M | Done, Sprint 2, with a residual Rory accepted: by score alone 56% of near misses fall below the floor (bar 80%); judged as a system, the drafter refuses all of them. Rerankers not compared: split out as F-20 |
| S2-2a | Server-side processing and enforcement: an Edge Function scores, gates and drafts; members can no longer write confidence or gates; bulk accept becomes a database function that refuses gated questions | Refinement found the controls run in the browser, where a signed-in user could switch them off (rules 4 and 5) | M | Done, Sprint 2 (plus the security review's fixes and two end-to-end fixes) |
| S2-2b | Grounded drafting: Claude drafts from matched entries only, cites them, says "insufficient evidence"; citations and figures checked in code; no draft for pricing | The product's promise; decision 0005 | M | Done, Sprint 2, with a residual Rory accepted: right entry cited 89.8% (bar 90%); all misses are refusals |
| S2-3 | Pricing and legal gates: rules and a classifier, gated if either fires; rules still work when Claude is down | Project rule 4 | M | Done, Sprint 2 |
| S2-4 | Drafting evaluation: citation accuracy, faithfulness, coverage, abstention; model and prompt version saved with every draft | Measure drafting as Sprint 1 measured retrieval | M | Done, Sprint 2 |
| S2-5 | Red team: injected questions and knowledge-base entries change nothing | Rule 6; first sprint where an LLM reads untrusted text | S | Done, Sprint 2, with a residual Rory accepted: 1 of 35 injections raised the judge's verdict, contained by the translation gate; judge stability tracked as F-22 |
| F-5 | Split `RFIWorkspace.tsx` | S2-2a removes its scoring anyway | S | Done, Sprint 2 |
| F-13 | Calibration per language | Same run as S2-1 | S | Done, Sprint 2 |

Refinement: `docs/refinement/sprint-2.md`. Order: S2-0 first; S2-1 and S2-3 in parallel; S2-2a; S2-2b with F-5; then S2-4, S2-5 and F-13. No spike: S2-1 compares three known options by measurement, and the stories after it take a score whichever wins. The Anthropic key is in place. A little larger than Sprint 1; if it runs long, F-13 and then S2-5 return to the backlog (S2-5 must land before any hosted demo).

### Sprint 2 review (23 October 2026)

**Checks, with evidence.** CI green on all three jobs (162 unit tests; 121 database tests; the real Supabase stack, including a batch processed with every provider failing). Evaluations on Rory's PC, all in `docs/evals/`:

| Bar (agreed at refinement) | Result | Held? |
|---|---|---|
| Every pricing and legal question gated | 100 of 100 | Yes |
| At most 15% of lookalikes gated | 12.9% (9 of 70) | Yes |
| No near miss at or above the 80% bulk line | 0 of 33 (voyage-4 + Claude judge) | Yes |
| At least 80% of near misses below the floor | 56% by score; 100% get no draft | Residual accepted (judged as a system) |
| At most 10% of answerable questions below the floor | 2% | Yes |
| Calibration error at most 0.10 | 0.041 | Yes |
| Right entry cited for at least 90% of answerable questions | 89.8% (all misses are refusals) | Residual accepted |
| Faithfulness at least 95% of claims | 100% of 280; Rory agreed with the judge on 9 of 9 | Yes |
| At least 80% of near misses answered "insufficient evidence" | 100% of 20 | Yes |
| No injection succeeds | 1 of 35 changed a verdict, contained | Residual accepted |

End-to-end on Rory's PC: 46 questions processed server-side; near misses refused with reasons; bulk approval at 80% as an admin accepted 30 and held back 16 with reasons (7 below 80%, 2 legal, 7 with no draft); the database's own count agreed; a member who does not own the response was refused bulk approval, multi-row accepts and score writes, and could still accept one gated question; anonymous visitors were refused everything. An independent security review found six gaps, all fixed and tested (decision 0003).

**Bugs found and fixed in the sprint.** BUG-5: bulk approval could accept a question with no draft (100% confidence, failed drafting call). BUG-6: Rory's local `.env` held the service-role key as the browser key; the app now refuses to start with a secret key. BUG-7: the dev proxy captured the browser's requests for shared code (blank page). BUG-8: sessions from before Sprint 2 looked eligible for bulk approval on screen (the database refused correctly). BUG-9: the CI bundle check matched the key guard's own wording. Plus a Sprint 1 labelling error (the DSAR "near miss" was answerable), corrected.

**Decisions at the review.** Three residuals accepted, as above. Defaults: Claude Haiku 5.5 as answerability judge, gate classifier and drafter (decision 0007). Sprint 3 confirmed as proposed.

### Where every Sprint 2 review item now lives

| Item | Now |
|---|---|
| F-16 Calibration unstable on about 180 items | Backlog, from Sprint 2 review |
| F-17 Confidence shown as "100%" | Sprint 3 (touches the question card) |
| F-18 Judge says "no" for answerable questions; shown as 63% beside a refusal | Backlog, from Sprint 2 review |
| F-19 Faithfulness judge not yet tested on unfaithful drafts | Backlog, from Sprint 2 review |
| F-20 Rerankers not compared (Voyage rate limit) | Backlog, returned from S2-1 |
| F-21 No per-user rate limit or cost cap on processing | Folded into Sprint 4's cost caps |
| F-22 Judge consistency across repeated runs | Backlog, from Sprint 2 review (accepted residual of S2-5) |
| F-23 No way to start a new upload from the review screen | Sprint 3 (touches the workspace) |
| Member-added entries are trusted by the draft checks | Sprint 4 governance pack (review of member-added entries) |
| BUG-5 to BUG-9 | Done in Sprint 2 (review) |


## Sprint 3: workflow and the learning loop (confirmed 23 October 2026)

Refinement: `docs/refinement/sprint-3.md` (answers recorded 23 October). Each item with its reason:

| ID | Story | Why now | Status |
|---|---|---|---|
| S3-1 | Overview of responses in flight: owner, due date, progress, overdue and at-risk flags | Rory's brief: several responses at once | Done, Sprint 3 |
| S3-2 | Recorded approvals (who, individual or bulk, threshold, model and prompt versions) and a readiness gate before export | Rule 4 says bulk approval counts when recorded; the audit trail completes Sprint 2's controls | Done, Sprint 3 |
| S3-3 | Archive with outcome (won or lost); admin-only hard delete for responses created in error, logged | Rory's brief: archive, never delete | Done, Sprint 3 |
| S3-4 | Learning at export: edited and person-written answers (including legal) become entries with provenance, near-duplicates superseded (F-11, threshold measured in S3-4b), origin_ref set by the system (F-6), pricing and Japanese never learned; unedited drafts confirm their entries | The self-improving knowledge base; replaces the manual Add to KB button | Done, Sprint 3 (learning became an allow list after the security review) |
| S3-4b | Near-duplicate threshold measured on the Sprint 1 evaluation set | Supersession must not replace a different question's entry | Done, Sprint 3: voyage-4 0.30, qwen 0.47, each with 1.9% wrong supersessions (bar 2%) |
| S3-5 | Questions editable only by the owner, assignees and admins (F-7) | Same tables as S3-2 | Done, Sprint 3 |
| S3-6 | Expert suggestions from answer history as well as stated expertise | Uses the provenance S3-4 records | Done, Sprint 3 |
| F-17 | Show high confidence as "99% or more", never "100%" | Small, and the card changes anyway | Done, Sprint 3 |
| F-23 | Start a new upload from the review screen | Small, and the workspace changes anyway | Done, Sprint 3 |

No spike: near-duplicate detection uses the vectors already stored, with a threshold measured on the evaluation set.

All nine committed items closed as done; nothing returned to the backlog.

### Sprint 3 review (23 October 2026)

**Checks, with evidence.** CI green on all three jobs at `a83e0ec` (181 unit tests; 150 database tests, including one per role-matrix row for every new table and function; the real Supabase stack). Near-duplicate thresholds in `docs/evals/duplicates-2026-10-23.md`. End-to-end on Rory's PC, on a new synthetic response of six questions:

| Check (agreed at refinement) | Result | Held? |
|---|---|---|
| Overview shows owner, due date, stage, progress, overdue and at risk | Due tomorrow with 2 of 6 decided showed "At risk"; cleared once exported | Yes |
| Every approval recorded (who, how, threshold) | "by Sarah Chen, bulk at 80%" and "by Maya Patel" on screen; rows in `approvals` | Yes |
| Export blocked while anything is pending | Disabled with the reason; enabled once all six were decided | Yes |
| Learning: edits learned with provenance, unedited drafts confirm, pricing never learned | 1 added (KB-0109, linked to response, session and question, indexed at once), 3 confirmed, 1 pricing not learned; the edit sat beside KB-0012 because the judge said KB-0012 does not answer it | Yes |
| Only owner, admin or assignee decides (F-7) | Tom: no controls; database refused a direct update (0 rows) and bulk approval (403). Maya, once assigned, edited and accepted | Yes |
| Archive with outcome; archived responses read-only | Archived as won; database refused a new session and an edit, even from an admin | Yes |
| Admin-only delete with a reason, logged | Throwaway response deleted; export, archive and delete all in the audit log with details | Yes |
| Expert suggestions give reasons | Stated expertise, and "wrote KB-0012" | Yes |

An independent security review found five gaps, all fixed and tested (`20261023150000_sprint3_review_fixes.sql`, decision 0003): self-assignment onto another response's question, learning by block list, members creating archived responses or adding to others' responses, a writable `origin_ref`, and supersession trusting a verdict about another entry.

**Bugs found and fixed in the sprint.** BUG-10: an edited or person-written answer sat under "Proposed Response", whose tooltip says every citation and figure was checked (rule 1); it is now labelled as a person's answer. BUG-11: the approval line appeared only after a reload. BUG-12: an archived response still offered New upload and Start New RFI (the database refused both). BUG-13: assigning or unassigning ignored errors.

**Decisions at the review.** F-24 is not accepted as a residual: Rory chose to fix it in Sprint 4. Sprint 4 confirmed as proposed (cost controls and governance), with Word ingestion moved to its own Sprint 5 and publishing to Sprint 6.

### Where every Sprint 3 review item now lives

| Item | Now |
|---|---|
| Five security review findings | Done in Sprint 3 (review), decision 0003 |
| BUG-10 to BUG-13 | Done in Sprint 3 (review) |
| F-24 `app.*` transaction settings can be forged over a direct SQL connection | Sprint 4 (Rory chose a fix over accepting the residual) |
| F-25 Learning confirms every matched entry, not only the ones the draft cited | Backlog, from Sprint 3 review |
| F-26 Assignments stay open after a response is exported or archived ("1 with experts" on an archived response) | Backlog, from Sprint 3 review |
| MFA draft at 75% with a "no" verdict | Folded into F-18 (judge says "no" to answerable questions) |
| F-6, F-7, F-11 | Done in Sprint 3 (S3-4, S3-5, S3-4 with S3-4b) |

## Later sprints (one line each; refined at the previous sprint's close; re-ranked at the Sprint 3 review)

**Sprint 4 (confirmed 23 October 2026): cost controls and governance pack.** Per-user rate limits and cost caps on processing (F-21); settings that cannot be forged for bulk approval and delete (F-24); review of member-added knowledge-base entries, which the draft checks trust; knowledge-base review dates and a stale-entry report (uses `last_reviewed_at`, which Sprint 3 now sets); confirm only cited entries (F-25); model card, risk register, data-handling and retention rules; provider terms checked (no training on customer data); light mapping to NIST AI RMF and the EU AI Act transparency duties.

**Sprint 5: ingestion.** Word documents ingested with AI-assisted question extraction alongside spreadsheets, with its own evaluation set and red-team cases (an LLM reading a whole untrusted document); close assignments at export (F-26). PDF and pasted text stay in the backlog.

**Sprint 6: documentation and publish.** Architecture diagram, evaluation reports, governance pack, synthetic demo data covering several responses at different stages, screenshots or short demo video, licence decision, repo made public, CV and website wording updated to match.

**Not yet in a sprint, ranked at the Sprint 3 review.** 1. F-18 judge says "no" to answerable questions (it now also decides supersession; candidate for Sprint 5 with the new evaluation work). 2. C-1 multilingual knowledge base (after ingestion; the strongest demonstration still unbuilt). 3. F-16 calibration stability (larger set, intervals). 4. F-19 faithfulness judge on planted unfaithful drafts. 5. F-22 judge consistency across runs. 6. F-20 rerankers (needs a Voyage payment method). 7. F-10 narrow windows (before the Sprint 6 screenshots). 8. F-8 leaked-password protection (hosted project only; before publishing). 9. F-2 generated database types. 10. F-3 invite screen. 11. F-14 and F-15 reviewed Japanese and near-miss items (need a native reader and a second reviewer). 12. F-4 Tailwind 4.

## Candidate stories (not yet placed in a sprint)

| ID | Story | Acceptance criteria (summary) | Notes |
|---|---|---|---|
| C-1 | Multilingual knowledge base (added 22 Oct; Sprint 1 measures Japanese-to-English retrieval as a first step) | Knowledge captured in any supported language is available in all of them: a question in one language retrieves answers held in another; drafts are written in the language of the incoming RFI; each entry keeps its original language, and translated answers are marked as such and need human review before being learned; retrieval and drafting quality are evaluated per language pair | Depends on Sprint 1's embedding model being multilingual (criterion added to the S0-9 spike) and Sprint 2's drafting. Likely sits with Sprint 3's learning loop or after it. A strong demonstration for organisations working across languages, such as Cookpad. Languages: English and Japanese to start (agreed 22 Oct); others later |

## Follow-ups (F-1 to F-12 from Sprint 0, F-13 to F-15 from Sprint 1, F-16 to F-23 from Sprint 2, F-24 onwards from Sprint 3; ranked at each review; see "Where every review item now lives")

| ID | Item | Why |
|---|---|---|
| F-1 | End-to-end browser test of the main path (sign in, upload, review, assign, export) | Done at the Sprint 0 review, on Rory's PC |
| F-2 | Generate database types (`npm run types`) and use them in the app | Needs the local Supabase stack |
| F-3 | In-app "invite user" screen, via a server-side function with the service key | Invites go through the Supabase dashboard for now |
| F-4 | Move to Tailwind 4 | Clears the remaining dev-only audit findings (decision 0002) |
| F-5 | Split `RFIWorkspace.tsx` (870 lines) | Done, Sprint 2. Planned with Sprint 2's drafting rewrite |
| F-6 | Validate `kb_entries.origin_ref` server-side | Done, Sprint 3. Free text until Sprint 3's learning at export sets it |
| F-7 | Make questions within a session editable only by the owner, assignees and admins | Done, Sprint 3. Team-editable until Sprint 3's readiness workflow |
| F-8 | Turn on leaked-password protection in the hosted project | The Bolt migration claiming to do this was a no-op (decision 0003) |
| F-9 | Single accept, edit and skip save without checking for errors, and the session's question inserts too | Found in the end-to-end run; a failed save is silent |
| F-10 | Layout does not fit narrower windows (1,180 px wide in a 786 px pane) | Found in the end-to-end run |
| F-11 | Near-duplicate knowledge-base entries make drafts repeat sentences (seed and import overlap) | Done, Sprint 3. Found in the end-to-end run; Sprint 3, with supersession |
| F-13 | Right Japanese matches score about 77% (similarity around 0.52), so a Japanese RFI can never be bulk-approved: calibration is pooled across languages | Done, Sprint 2. From the Sprint 1 review; check per-language calibration once confidence combines similarity with the answerability check |
| F-14 | Japanese evaluation items are machine translations of the original questions, unreviewed | From the Sprint 1 review; reworded items checked by a native reader would test Japanese rewording, not just crossing languages |
| F-15 | The near-miss set is 34 items written by Claude | From the Sprint 1 review; small and unreviewed, so the abstention figures have wide error bars |
| F-16 | Calibration moved noticeably when one item was removed (near misses at the bulk line, similarity alone: 1 of 34, then 9 of 33) | From the Sprint 2 review; about 180 items per split. A larger set, cross-validated fitting, and an interval rather than a single figure |
| F-17 | High confidence is shown as "100%" | Done, Sprint 3. From the Sprint 2 review; the top calibration bin is all-correct on a small sample, which is not certainty |
| F-18 | The judge says "no" to some answerable questions (DSAR, MFA in Japanese); calibration then shows 63% beside a refusal | From the Sprint 2 review; judge prompt, and showing the verdict on the card |
| F-19 | The faithfulness judge has only been checked on faithful drafts (9 of 9 agreed) | From the Sprint 2 review; plant unfaithful drafts to test that it catches them |
| F-20 | Voyage rerank-2.5 and rerank-3 not yet compared with the Claude judge | Returned from S2-1; needs a Voyage payment method for the rate limit. Cheaper and faster if as good |
| F-21 | No per-user rate limit or cost cap on processing | From the Sprint 2 security review; folded into Sprint 4 |
| F-22 | How consistent is the judge across repeated runs (the API no longer accepts a temperature setting)? | From the Sprint 2 review; accepted residual of S2-5 (r028) |
| F-23 | The review screen has no way to start a new upload | Done, Sprint 3. Found in the Sprint 2 end-to-end run |
| F-24 | The transaction settings `app.bulk_threshold` and `app.deleting_response` can be set by anyone with a direct SQL connection | From the Sprint 3 security review; members reach the database only through the API, which cannot set them. Sprint 4: Rory chose to fix it rather than accept it |
| F-25 | Learning at export confirms every matched entry, not only the ones the draft cited | From the Sprint 3 review; `last_reviewed_at` then overstates review for entries that were matched but not used. Sprint 4, with the stale-entry report |
| F-26 | Assignments stay open after a response is exported or archived | From the Sprint 3 end-to-end run; close them at export, or show them as closed |
| F-12 | Keyword confidence is generous: 33 of 40 sample questions scored 80% or more, and one draft cited an unrelated entry | Folded into S1-6 |

## Parked

- Rory to pause or delete the original Bolt-hosted Supabase project (agreed 22 Oct).
- Edit and delete individual KB entries in the UI; admin review of member-added KB entries (consider at Sprint 4 governance).
- Ingest PDF and questions pasted from an email.
- Use won or lost outcome as a signal when ranking knowledge-base answers.
- `JOB_STORIES.md` still says "what the AI is drawing on" (3.2); revisit wording once Sprint 2 lands.
