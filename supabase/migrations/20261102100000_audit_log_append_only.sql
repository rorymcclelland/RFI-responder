-- Sprint 14 (S14-1, F-57): the audit log is append-only for the service role too. The Edge Functions
-- hold the service-role key; with it, a leaked key could rewrite or erase the record of who did what.
-- Nothing in the functions changes audit rows (the database's own triggers and definer functions write
-- them, as their owner), so the service role keeps only reading and adding. The project owner
-- (`postgres`, used by the dashboard and migrations) is unaffected: direct connections stay limited
-- to administrators (decision 0003).
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.audit_log FROM service_role;

-- Security review of Sprint 14 (M3): approvals are the other record that must not change. Members could
-- never change them; now the service role cannot either.
REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.approvals FROM service_role;

-- Security review (M3): an added row cannot be backdated, and who acted survives the deletion of their
-- profile. `actor` keeps its link to the profile (the audit screen shows names through it) and is set to
-- NULL when a profile is deleted; `actor_ref` keeps the same id, with no link, so the record still shows
-- that one person did these things, without naming them.
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS actor_ref uuid;
UPDATE public.audit_log SET actor_ref = actor WHERE actor_ref IS NULL;

CREATE OR REPLACE FUNCTION private.stamp_audit_row()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.at := now();
  NEW.actor_ref := NEW.actor;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_audit_row() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_log_stamp ON public.audit_log;
CREATE TRIGGER audit_log_stamp BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION private.stamp_audit_row();
