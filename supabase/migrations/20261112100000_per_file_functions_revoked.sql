-- Sprint 25 (S25-2, F-74): a response is sent, and bulk-approved, only as a whole (Sprint 24, Q3).
-- The per-file functions stay, because record_response_export and bulk_accept_response call them
-- (definer functions, so they run as the owner of the functions), and so do the demo loaders
-- (seed.sql, demo-hosted.sql, run as the database owner). No API role may call them directly any
-- more, so the rule cannot be got round by sending or bulk-approving one file of a response.
-- The app stopped calling them in Sprint 24.
REVOKE ALL ON FUNCTION public.record_export(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.bulk_accept(uuid, numeric) FROM PUBLIC, anon, authenticated, service_role;
