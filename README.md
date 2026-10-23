# RFI Respond

An internal tool that helps an organisation answer requests for information (RFIs) and requests for quotation (RFQs) faster and better, by turning its past answers into an **institutional knowledge base** that grows with every response.

Product brief: [`docs/PRODUCT.md`](docs/PRODUCT.md). Backlog: [`docs/BACKLOG.md`](docs/BACKLOG.md). Decisions: [`docs/decisions/`](docs/decisions/).

## Status

Being upgraded from a prototype generated with Bolt.new, sprint by sprint. **Sprints 0 to 5 are complete** (clean-up; retrieval and confidence; grounded drafting and safety gates; workflow and the learning loop; cost controls and governance; Word questionnaires). What the code does today, stated plainly:

- **Processing happens on the server.** Each uploaded question goes to a Supabase Edge Function, which matches it against the knowledge base by meaning (voyage-4, or a local model through Ollama), asks Claude whether the matched entries actually answer it, checks it for pricing and legal or contractual terms, and drafts an answer. Provider keys never reach the browser.
- **Drafts are grounded and checked.** Claude writes only from the matched entries and cites them; code then rejects a draft that cites an entry it was not given, or contains a figure or link not in its sources. When the entries do not answer the question, there is no draft. Pricing questions are never drafted. Japanese questions get Japanese drafts, labelled as translations.
- **Confidence is calibrated** on synthetic evaluation sets (`docs/evals/`): the measured chance that the knowledge base answers the question with the top entry. The sets are small, so the figures are estimates.
- **Bulk approval is limited by the database**, not the screen: only the response owner or an admin, and never for pricing, legal, translated, unprocessed or uncalibrated questions, or ones without a draft. A single question is decided only by the response owner, an admin, or someone it is assigned to, and every approval is recorded (who, how, at what threshold).
- **The knowledge base learns at export.** Recording an export is refused while any question is pending. It then turns edited and person-written answers into entries linked to the response they came from, replaces an entry only when the answer is a near-duplicate the checker confirmed (threshold measured per embedding model), and confirms entries that unedited drafts used. Pricing and Japanese answers, and anything the server did not process, are never learned.
- **Spend is recorded and capped.** Every AI call is recorded with the provider's token counts and priced from dated published prices. Work is reserved before any call against per-person daily limits and a monthly budget, which admins set and watch on the Governance page.
- **The knowledge base is reviewed.** Entries added by members, and answers learned from anyone but an admin, stay unreviewed until an admin approves them; entries fall due for review after 12 months. Drafts citing an unreviewed or overdue entry are never bulk-approved. The [governance pack](docs/governance/) (model card, risk register, data handling, provider terms) is tested against the code.
- **Word questionnaires are read safely.** A `.docx` is read in the browser with size and decompression limits; Claude finds the questions, and code keeps only whole paragraphs, sentences or lettered parts found word for word, with the document's own numbers. A person checks the list before anything is saved. On a synthetic set of 237 questions in six layouts, 100% were found with nothing extra, and planted instructions changed nothing (`docs/evals/extraction-2026-10-23.md`).
- **The checker's replies are complete and checked.** Sprint 6 found about a third of its replies were being cut off and counted as "no"; with that fixed it separates near misses from answerable questions with an AUROC of 0.997 on the synthetic set, and a reply that cannot be read leaves the question uncalibrated rather than scored. Run five times, its verdict still changed for 7.2% of test questions, mostly between "yes" and "partly" (`docs/evals/consistency-2026-10-23-sprint6.md`).
- **Responses are archived, not deleted.** An archived response keeps its outcome (won, lost, withdrawn) and can no longer be changed. An admin can delete a response created in error, with a reason, and the deletion is logged.

Features in the code, tested end to end in a browser against local Supabase: an overview of responses in flight with owner, due date, progress, overdue and at-risk flags; uploading questions from `.xlsx`, `.csv` or `.docx` (with a preview to correct the found questions); review lowest-confidence first, with accept, edit, skip and bulk approval; assigning questions to colleagues, with suggestions from stated expertise and who wrote or approved similar answers, and an inbox (assignments close when the export is recorded); export to Excel, CSV and Word; a shared knowledge base with import; invite-only accounts with admin, owner and member rights enforced in the database.

## Project rules

1. **Honesty.** Nothing claims more than the code does.
2. **Synthetic data only.** See [`sample-data/`](sample-data/).
3. **Secrets stay server-side.** Only the public Supabase anon key is in the browser; row-level security holds with it in an attacker's hands.
4. **Human in the loop.** Every answer that leaves has a named human decision behind it.
5. **Least privilege**, enforced by the database ([decision 0003](docs/decisions/0003-access-control.md)).
6. **Uploads are untrusted** ([decision 0002](docs/decisions/0002-spreadsheets-and-dependencies.md)).
7. **The knowledge base only learns with provenance.**

## Stack

React 18 and TypeScript, Vite, Tailwind; Supabase (Postgres with row-level security, Auth). ExcelJS and PapaParse for spreadsheets. Vitest for unit and database tests; GitHub Actions for CI.

## Running it locally

Needs Node 22, npm 11 (`npm install -g npm@11`) and Docker (for the local Supabase stack).

```bash
npm ci
npm run db:start          # starts Supabase locally; prints the API URL and anon key
cp .env.example .env      # paste the API URL and anon key into .env
npm run db:reset          # applies migrations and loads the synthetic seed
npm run dev               # http://127.0.0.1:5173
```

Sign in as any seeded user (for example `sarah.chen@example.com`, the admin) with the dev-only password `LocalDev2026pw`. To fill the knowledge base, use **Knowledge base > Bulk upload** with `sample-data/security-qa.csv`.

Accounts are invite-only. Invite users from the Supabase dashboard (local: http://127.0.0.1:54323) or the CLI.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run coverage` | Unit tests with coverage |
| `npm run test:db` | Database tests; needs `DB_TEST_URL` (a Postgres superuser connection) |
| `npm run db:start` / `db:stop` / `db:reset` | Local Supabase stack |
| `npm run types` | Regenerate database types from the local stack |

## Tests

- **Unit tests** (`src/**/*.test.ts`): drafting and scoring, spreadsheet parsing limits and hostile input, export escaping, configuration.
- **Database tests** (`supabase/tests/db/`): every row of the role matrix, run as real users against row-level security; knowledge-base import rules; the seed. They run on plain Postgres with a small Supabase shim ([decision 0004](docs/decisions/0004-local-first-and-testing.md)).
- **CI** runs both, audits production dependencies, builds, and applies every migration and the seed to the real Supabase stack to check the auth settings.

## Repository layout

```
docs/                 product brief, backlog, sprint refinements, decisions, job stories
sample-data/          synthetic CSVs for demos
src/                  the React app; pure logic in src/lib/
supabase/migrations/  database schema and access rules, in order
supabase/seed.sql     synthetic development data (never applied by migrations)
supabase/tests/       database tests and the Supabase shim
```
