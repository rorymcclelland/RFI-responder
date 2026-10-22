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
| F-12: fewer than 33 of 40 sample questions at 80% or more without evidence | 33 of 40; the 7 below include mean time to detect and DSARs, which the knowledge base does not answer | Partly: the two known gaps now sit below the bulk line |

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
| S2-0 | Evaluation sets: gate set (pricing, legal, lookalikes), drafting labels, red-team set (injected questions and entries) | They judge the rest of the sprint; written first | S | Refined, awaiting Rory |
| S2-1 | Answerability check: compare Voyage rerank-2.5, rerank-3 and Claude Haiku 5.5 as judge on the Sprint 1 set; the chosen signal feeds calibrated confidence | The one Sprint 1 bar not met | M | Refined, awaiting Rory |
| S2-2a | Server-side processing and enforcement: an Edge Function scores, gates and drafts; members can no longer write confidence or gates; bulk accept becomes a database function that refuses gated questions | Refinement found the controls run in the browser, where a signed-in user could switch them off (rules 4 and 5) | M | Refined, awaiting Rory |
| S2-2b | Grounded drafting: Claude drafts from matched entries only, cites them, says "insufficient evidence"; citations and figures checked in code; no draft for pricing | The product's promise; decision 0005 | M | Refined, awaiting Rory |
| S2-3 | Pricing and legal gates: rules and a classifier, gated if either fires; rules still work when Claude is down | Project rule 4 | M | Refined, awaiting Rory |
| S2-4 | Drafting evaluation: citation accuracy, faithfulness, coverage, abstention; model and prompt version saved with every draft | Measure drafting as Sprint 1 measured retrieval | M | Refined, awaiting Rory |
| S2-5 | Red team: injected questions and knowledge-base entries change nothing | Rule 6; first sprint where an LLM reads untrusted text | S | Refined, awaiting Rory |
| F-5 | Split `RFIWorkspace.tsx` | S2-2a removes its scoring anyway | S | Refined, awaiting Rory |
| F-13 | Calibration per language | Same run as S2-1 | S | Refined, awaiting Rory |

Refinement: `docs/refinement/sprint-2.md`. Order: S2-0 first; S2-1 and S2-3 in parallel; S2-2a; S2-2b with F-5; then S2-4, S2-5 and F-13. No spike: S2-1 compares three known options by measurement, and the stories after it take a score whichever wins. The Anthropic key is in place. A little larger than Sprint 1; if it runs long, F-13 and then S2-5 return to the backlog (S2-5 must land before any hosted demo).

## Later sprints (one line each; refined at the previous sprint's close; re-ranked at the Sprint 0 review)

(Sprint 2 is proposed in full above.)

**Sprint 3: workflow and the learning loop.** Overview of responses in flight (owner, due date, progress, overdue and at-risk flags); per-response owner role; bulk approval recorded; readiness gate before export; archive with outcome (won or lost), admin-only hard delete for errors, logged; learning at export with provenance and supersession of near-duplicates (F-11), pricing never learned; session questions editable only by owner, assignees and admins (F-7); origin_ref set by the system (F-6); expert recommendation from answer history as well as stated expertise; audit trail of every approval with model and prompt version.

**Sprint 4: ingestion and governance pack.** Word documents ingested with AI-assisted question extraction alongside spreadsheets (PDF and pasted text stay in the backlog); model card, risk register, data-handling and retention rules; provider terms checked (no training on customer data); cost caps and rate limits; KB review dates and a stale-entry report; light mapping to NIST AI RMF and the EU AI Act transparency duties.

**Sprint 5: documentation and publish.** Architecture diagram, evaluation reports, governance pack, synthetic demo data covering several responses at different stages, screenshots or short demo video, licence decision, repo made public, CV and website wording updated to match.

## Candidate stories (not yet placed in a sprint)

| ID | Story | Acceptance criteria (summary) | Notes |
|---|---|---|---|
| C-1 | Multilingual knowledge base (added 22 Oct; Sprint 1 measures Japanese-to-English retrieval as a first step) | Knowledge captured in any supported language is available in all of them: a question in one language retrieves answers held in another; drafts are written in the language of the incoming RFI; each entry keeps its original language, and translated answers are marked as such and need human review before being learned; retrieval and drafting quality are evaluated per language pair | Depends on Sprint 1's embedding model being multilingual (criterion added to the S0-9 spike) and Sprint 2's drafting. Likely sits with Sprint 3's learning loop or after it. A strong demonstration for organisations working across languages, such as Cookpad. Languages: English and Japanese to start (agreed 22 Oct); others later |

## Follow-ups (F-1 to F-12 from Sprint 0, F-13 onwards from Sprint 1; ranked at each review; see "Where every review item now lives")

| ID | Item | Why |
|---|---|---|
| F-1 | End-to-end browser test of the main path (sign in, upload, review, assign, export) | Done at the Sprint 0 review, on Rory's PC |
| F-2 | Generate database types (`npm run types`) and use them in the app | Needs the local Supabase stack |
| F-3 | In-app "invite user" screen, via a server-side function with the service key | Invites go through the Supabase dashboard for now |
| F-4 | Move to Tailwind 4 | Clears the remaining dev-only audit findings (decision 0002) |
| F-5 | Split `RFIWorkspace.tsx` (870 lines) | Planned with Sprint 2's drafting rewrite |
| F-6 | Validate `kb_entries.origin_ref` server-side | Free text until Sprint 3's learning at export sets it |
| F-7 | Make questions within a session editable only by the owner, assignees and admins | Team-editable until Sprint 3's readiness workflow |
| F-8 | Turn on leaked-password protection in the hosted project | The Bolt migration claiming to do this was a no-op (decision 0003) |
| F-9 | Single accept, edit and skip save without checking for errors, and the session's question inserts too | Found in the end-to-end run; a failed save is silent |
| F-10 | Layout does not fit narrower windows (1,180 px wide in a 786 px pane) | Found in the end-to-end run |
| F-11 | Near-duplicate knowledge-base entries make drafts repeat sentences (seed and import overlap) | Found in the end-to-end run; Sprint 3, with supersession |
| F-13 | Right Japanese matches score about 77% (similarity around 0.52), so a Japanese RFI can never be bulk-approved: calibration is pooled across languages | From the Sprint 1 review; check per-language calibration once confidence combines similarity with the answerability check |
| F-14 | Japanese evaluation items are machine translations of the original questions, unreviewed | From the Sprint 1 review; reworded items checked by a native reader would test Japanese rewording, not just crossing languages |
| F-15 | The near-miss set is 34 items written by Claude | From the Sprint 1 review; small and unreviewed, so the abstention figures have wide error bars |
| F-12 | Keyword confidence is generous: 33 of 40 sample questions scored 80% or more, and one draft cited an unrelated entry | Folded into S1-6 |

## Parked

- Rory to pause or delete the original Bolt-hosted Supabase project (agreed 22 Oct).
- Edit and delete individual KB entries in the UI; admin review of member-added KB entries (consider at Sprint 4 governance).
- Ingest PDF and questions pasted from an email.
- Use won or lost outcome as a signal when ranking knowledge-base answers.
- `JOB_STORIES.md` still says "what the AI is drawing on" (3.2); revisit wording once Sprint 2 lands.
