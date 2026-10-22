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
| S0-1 | Remove misleading content | Factsheet deleted; random confidence removed; UI and docs describe what the code does | S | Ready, Sprint 0 |
| S0-2 | Clean build | Zero type errors, zero lint errors, no high-severity audit findings | S | Ready, Sprint 0 |
| S0-3 | Safe spreadsheet handling | Vulnerable library replaced; upload limits; export escapes formula injection | M | Ready, Sprint 0 |
| S0-4 | Persist the knowledge base | Entries stored in the database with source; survive reload; imports and add-back write to it | M | Ready, Sprint 0 |
| S0-5 | Fix access control | Users cannot make themselves admin; written role matrix; policies match it; no shared-password users in migrations; sign-up policy settled | M | Ready, Sprint 0 |
| S0-6 | Reproducible local environment | One documented command sequence brings up database, seed data and app from a clean clone | M | Ready, Sprint 0 |
| S0-7 | Tests and CI | Unit tests for pure logic; database access tests; GitHub Actions runs typecheck, lint, tests, audit on every push | M | Ready, Sprint 0 |
| S0-8 | Documentation baseline | README rewritten; decisions log started; agent context file | S | Ready, Sprint 0 |
| S0-9 | Spike: where the AI runs | Time-boxed note settling embedding and drafting model route and its hosting consequences | S | Ready, Sprint 0 |

## Later sprints (one line each; refined at the previous sprint's close; re-ranked 22 Oct after the product brief)

**Sprint 1: real retrieval and calibrated confidence.** Embeddings with pgvector alongside keyword search (hybrid); evaluation set from the 100 synthetic security Q&As with paraphrased questions; recall@k and MRR reported; confidence derived from match scores and calibrated so the bulk-approval threshold means what it says; near-duplicate detection (needed for learning in Sprint 3).

**Sprint 2: grounded drafting and safety gates.** LLM drafts server-side from retrieved sources only, citing KB entries; says "insufficient evidence" rather than guessing; pricing and legal or contractual questions detected and excluded from bulk approval; prompt and model versioned; faithfulness and calibration evaluated against hand-labelled answers; red-team set for prompt injection hidden in uploaded questions.

**Sprint 3: workflow and the learning loop.** Overview of responses in flight (owner, due date, progress, overdue and at-risk flags); per-response owner role; bulk approval recorded; readiness gate before export; archive with outcome (won or lost), admin-only hard delete for errors, logged; learning at export with provenance and supersession of near-duplicates, pricing never learned; expert recommendation from answer history as well as stated expertise; audit trail of every approval with model and prompt version.

**Sprint 4: ingestion and governance pack.** Word documents ingested with AI-assisted question extraction alongside spreadsheets (PDF and pasted text stay in the backlog); model card, risk register, data-handling and retention rules; provider terms checked (no training on customer data); cost caps and rate limits; KB review dates and a stale-entry report; light mapping to NIST AI RMF and the EU AI Act transparency duties.

**Sprint 5: documentation and publish.** Architecture diagram, evaluation reports, governance pack, synthetic demo data covering several responses at different stages, screenshots or short demo video, licence decision, repo made public, CV and website wording updated to match.

## Candidate stories (not yet placed in a sprint)

| ID | Story | Acceptance criteria (summary) | Notes |
|---|---|---|---|
| C-1 | Multilingual knowledge base (added 22 Oct) | Knowledge captured in any supported language is available in all of them: a question in one language retrieves answers held in another; drafts are written in the language of the incoming RFI; each entry keeps its original language, and translated answers are marked as such and need human review before being learned; retrieval and drafting quality are evaluated per language pair | Depends on Sprint 1's embedding model being multilingual (criterion added to the S0-9 spike) and Sprint 2's drafting. Likely sits with Sprint 3's learning loop or after it. A strong demonstration for organisations working across languages, such as Cookpad. Languages: English and Japanese to start (agreed 22 Oct); others later |

## Parked

- Rory to pause or delete the original Bolt-hosted Supabase project (agreed 22 Oct).
- Edit and delete individual KB entries in the UI; admin review of member-added KB entries (consider at Sprint 4 governance).
- Ingest PDF and questions pasted from an email.
- Use won or lost outcome as a signal when ranking knowledge-base answers.
- `JOB_STORIES.md` still says "what the AI is drawing on" (3.2); revisit wording once Sprint 2 lands.
