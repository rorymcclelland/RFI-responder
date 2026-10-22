# 0004 Local-first environment and how the database is tested

Date: 22 October 2026. Status: agreed (Rory runs it on his own PC later; Claude works in a cloud workspace for now).

**Decision.**
- Development runs on the **local Supabase stack** (`npm run db:start`, Docker). `supabase/seed.sql` provides synthetic users, knowledge-base entries and responses; migrations contain no data. A hosted project is set up for the demo in the final sprint.
- **Database tests** run against plain Postgres with a small shim (`supabase/tests/shim/supabase-shim.sql`) that reproduces what the migrations rely on: the API roles, `auth.users`, `auth.uid()` and Supabase's default grants. Tests run each statement as a real user would (`SET ROLE authenticated` plus JWT claims), inside a transaction that is rolled back. This runs anywhere, including the cloud workspace, where the Supabase containers cannot be downloaded.
- Because a shim can drift from the real thing, **CI also applies every migration and the seed to the real Supabase stack**, and checks the auth settings (sign-up refused, seeded admin can sign in).

**Consequences.** Clicking through the app needs either Docker on Rory's PC or a hosted project. **Decided 22 October 2026: Docker on Rory's PC for now**; a hosted project for sharing demos is to be re-evaluated later (moving is mainly configuration, since the same migrations apply to both). Generated database types (`npm run types`) need the local stack and are deferred until it runs somewhere Claude can reach.
