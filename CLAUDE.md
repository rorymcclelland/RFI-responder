# Agent context: RFI Respond

Read `docs/PRODUCT.md` (what and why), `docs/BACKLOG.md` (project rules and sprints) and the current sprint's `docs/refinement/sprint-N.md` before changing anything.

## How Rory works on this

- Claude writes the code; Rory reads and questions it. Explain each new concept as it is introduced.
- Sprints are refined before building (agreed test cases first), and closed with a review. Undelivered items go back to the backlog.
- Work on a `sprint-N` branch; commit per story with a message that says what changed and why.
- British spelling, no em dashes, in docs and UI copy.

## Rules that are easy to break

- Never claim in code, UI or docs more than the code does (project rule 1). No invented figures or testimonials.
- Synthetic data only, in `sample-data/` and `supabase/seed.sql`. Migrations hold no sample or customer data; the only rows they may insert are the configuration every install needs (the `ai_settings` row, `ai_prices`, `learning_thresholds`), dated and sourced (Sprint 11, Q3; `supabase/tests/migrations.test.ts` checks it).
- Never ship an API key to the browser. AI calls go through Supabase Edge Functions (decision 0005).
- Access rules live in migrations and are tested in `supabase/tests/db/`. A new table needs RLS, column grants and a test for every row of the role matrix (decision 0003).
- Treat uploads as hostile; go through `src/lib/spreadsheet.ts`.

## Commands

```bash
npm install -g npm@11      # npm 10 fails on this dependency tree
npm ci
npm run typecheck && npm run lint -- --max-warnings 0 && npm test
DB_TEST_URL=postgres://postgres@localhost:5432/postgres npm run test:db
```

In a workspace without Docker, run the database tests against any Postgres 16 superuser connection; the shim in `supabase/tests/shim/` stands in for Supabase.
