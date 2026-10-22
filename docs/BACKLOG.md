# RFI Respond: upgrade backlog

Started 22 October 2026. Goal: take the Bolt prototype to an acceptable standard (sound code, real and proportionate use of AI, safety and governance built in, full documentation), then make the repo public as a portfolio piece.

Way of working: Claude writes the code, Rory reads and questions it. Each sprint is refined before it starts (`docs/refinement/sprint-N.md`) and closed with a review; anything not delivered goes back here and the backlog is re-ranked. The repo stays private until Sprint 4.

## Project rules (checked against every story)

1. **Honesty.** Nothing in the code, UI, docs or demo claims more than the code does. No invented customers, testimonials or performance figures. Claims elsewhere (CV, website) follow `_context\shared\positioning.md`.
2. **Synthetic data only.** No real company's questionnaire, policy or customer data in the repo, the database or any demo.
3. **Secrets stay server-side.** No API keys in the browser bundle or the repo. Only the Supabase anon key is public, and the database rules must hold with it in an attacker's hands.
4. **Human in the loop.** The AI drafts; a person approves. Nothing leaves the tool as a final answer without a named approver (enforced from Sprint 3).
5. **Least privilege.** Every table has row-level security matched to a written role matrix.
6. **Untrusted input.** Uploaded spreadsheets and questions are treated as hostile (malformed files, formula injection, prompt injection from Sprint 2).

## Sprint 0: baseline and clean-up

Refinement: `docs/refinement/sprint-0.md`

| ID | Story | Acceptance criteria (summary) | Size | Status |
|---|---|---|---|---|
| S0-1 | Remove misleading content | Factsheet deleted; random confidence removed; UI and docs describe what the code does | S | Refined |
| S0-2 | Clean build | Zero type errors, zero lint errors, no high-severity audit findings | S | Refined |
| S0-3 | Safe spreadsheet handling | Vulnerable library replaced; upload limits; export escapes formula injection | M | Refined |
| S0-4 | Persist the knowledge base | Entries stored in the database with source; survive reload; imports and add-back write to it | M | Refined |
| S0-5 | Fix access control | Users cannot make themselves admin; written role matrix; policies match it; no shared-password users in migrations; sign-up policy settled | M | Refined |
| S0-6 | Reproducible local environment | One documented command sequence brings up database, seed data and app from a clean clone | M | Refined |
| S0-7 | Tests and CI | Unit tests for pure logic; database access tests; GitHub Actions runs typecheck, lint, tests, audit on every push | M | Refined |
| S0-8 | Documentation baseline | README rewritten; decisions log started; agent context file | S | Refined |
| S0-9 | Spike: where the AI runs | Time-boxed note settling embedding and drafting model route and its hosting consequences | S | Refined |

## Later sprints (one line each; refined at the previous sprint's close)

**Sprint 1: real retrieval.** Embeddings stored with pgvector alongside keyword search (hybrid); evaluation set built from the 100 security Q&As with paraphrased questions; recall@k and MRR reported; confidence derived from real match scores and labelled as such.

**Sprint 2: grounded drafting.** LLM drafts server-side from retrieved sources only, with citations to KB entries; says "insufficient evidence" rather than guessing; prompt and model versioned; faithfulness evaluated against hand-labelled answers; red-team set for prompt injection hidden in uploaded questions.

**Sprint 3: safety and governance.** Approval enforced before export (or drafts clearly marked); audit trail of who approved what with which model and prompt version; model card, risk register, data-handling and retention rules; provider terms checked (no training on customer data); cost caps and rate limits; light mapping to NIST AI RMF and the EU AI Act transparency duties.

**Sprint 4: documentation and publish.** Architecture diagram, evaluation reports, governance pack, synthetic demo data, screenshots or short demo video, licence decision, repo made public, CV and website wording updated to match.

## Parked

- Retire or reuse the original Bolt-hosted Supabase project (see S0-6 questions).
- `JOB_STORIES.md` still says "what the AI is drawing on" (3.2); revisit wording once Sprint 2 lands.
