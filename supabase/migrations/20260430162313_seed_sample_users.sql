/*
  # Seed sample users (retired 22 October 2026)

  This migration originally inserted eight sample users into auth.users, all
  sharing one password. Seed data does not belong in migrations: every real
  deployment would have been created with those accounts.

  The users now live in supabase/seed.sql, which only `supabase db reset`
  loads in local development. This file is kept, empty, so that migration
  history stays in sequence. See docs/decisions/0003-access-control.md.
*/

SELECT 1;
