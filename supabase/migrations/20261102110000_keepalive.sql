-- Sprint 14 (S14-7): a ping that keeps the hosted demo awake. Supabase pauses a Free project after a week
-- without database activity; a scheduled GitHub workflow (.github/workflows/keepalive.yml) calls this once
-- a day through the API with the public anon key. It takes nothing, reads no table and returns 1, so it
-- tells a caller nothing and costs nothing; anonymous callers still reach no table (decision 0003).
CREATE OR REPLACE FUNCTION public.keepalive()
RETURNS int LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
SELECT 1
$$;
REVOKE ALL ON FUNCTION public.keepalive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keepalive() TO anon, authenticated, service_role;
