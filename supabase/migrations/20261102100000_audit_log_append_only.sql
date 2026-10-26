-- Sprint 14 (S14-1, F-57): the audit log is append-only for the service role too. The Edge Functions
-- hold the service-role key; with it, a leaked key could rewrite or erase the record of who did what.
-- Nothing in the functions changes audit rows (the database's own triggers and definer functions write
-- them, as their owner), so the service role keeps only reading and adding. The project owner
-- (`postgres`, used by the dashboard and migrations) is unaffected: direct connections stay limited
-- to administrators (decision 0003).
REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log FROM service_role;
