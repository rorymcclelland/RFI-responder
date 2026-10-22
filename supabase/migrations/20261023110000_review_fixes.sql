-- Sprint 2: fixes from the independent security review of 23 October 2026 (decision 0003).
--
-- 1. Questions scored in the browser before 20261023100000 have confidence a user could have
--    set and no gate: bulk approval now also requires processed_at (set only by the server).
-- 2. Reprocessing could reroll a classifier's gate: the function now processes only questions
--    never processed (enforced in the function, tested in process-core and here by the column
--    rights that keep processed_at server-only).
-- 3. Approved answers could be changed, or approvals undone, in bulk: any statement that changes
--    more than one question's status or answer must come from the owner or an admin; changing
--    an accepted answer sends that question back to pending, so it needs a fresh decision; and
--    accepted_count is computed by the database instead of written by members.
-- 6. Members held DELETE on questions and sessions (harmless without a policy, but one policy
--    away from letting questions be deleted and re-added to reset them); revoked. The bulk
--    check now decides by the database role in use, so it fails closed.

-- ─── 1 and 3: the statement-level check, replaced ───────────────────────────

CREATE OR REPLACE FUNCTION public.check_bulk_acceptance()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  moved     int;
  changed   int;
  blocked   int;
  sessions  int;
  opp       uuid;
BEGIN
  -- Only the server's own roles are exempt; every other role is checked (fails closed).
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NULL;
  END IF;

  SELECT count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'),
         count(*) FILTER (WHERE n.status IS DISTINCT FROM o.status OR n.final_answer IS DISTINCT FROM o.final_answer),
         count(*) FILTER (WHERE n.status = 'accepted' AND o.status IS DISTINCT FROM 'accepted'
                            AND (n.gate IS NOT NULL OR n.confidence IS NULL OR n.processed_at IS NULL)),
         count(DISTINCT n.session_id)
    INTO moved, changed, blocked, sessions
    FROM new_rows n
    JOIN old_rows o ON o.id = n.id;

  IF changed <= 1 THEN
    RETURN NULL; -- one question decided by a person: always allowed
  END IF;
  IF moved > 1 AND blocked > 0 THEN
    RAISE EXCEPTION 'Bulk approval cannot include pricing, legal, translated, unchecked, unprocessed or uncalibrated questions; accept those individually'
      USING ERRCODE = '42501';
  END IF;
  IF sessions > 1 THEN
    RAISE EXCEPTION 'Bulk changes work on one response session at a time' USING ERRCODE = '42501';
  END IF;

  SELECT s.opportunity_id INTO opp
    FROM public.rfi_sessions s
   WHERE s.id = (SELECT n.session_id FROM new_rows n LIMIT 1);
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can change several questions at once' USING ERRCODE = '42501';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.check_bulk_acceptance() FROM PUBLIC, anon, authenticated;

-- ─── 3: an accepted answer that changes needs a fresh decision ──────────────

CREATE OR REPLACE FUNCTION public.reopen_changed_answer()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  -- Changing the answer of an accepted question reopens it: the approval was for the old text.
  -- A person then accepts the revised answer individually (the app's "Revise answer" does both).
  IF OLD.status = 'accepted' AND NEW.status = 'accepted'
     AND NEW.final_answer IS DISTINCT FROM OLD.final_answer
     AND current_user NOT IN ('service_role', 'postgres', 'supabase_admin') THEN
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rfi_questions_reopen_changed_answer
  BEFORE UPDATE OF final_answer ON public.rfi_questions
  FOR EACH ROW EXECUTE FUNCTION public.reopen_changed_answer();

-- ─── 3: accepted_count is the database's own count ──────────────────────────

REVOKE UPDATE ON public.rfi_sessions FROM authenticated;
GRANT UPDATE (status) ON public.rfi_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_accepted_count()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.rfi_sessions s
     SET accepted_count = (SELECT count(*) FROM public.rfi_questions q WHERE q.session_id = s.id AND q.status = 'accepted')
   WHERE s.id IN (SELECT DISTINCT session_id FROM new_rows);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_accepted_count() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER rfi_questions_accepted_count
  AFTER UPDATE ON public.rfi_questions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_accepted_count();

-- ─── 1: bulk_accept also requires processing by the server ──────────────────

CREATE OR REPLACE FUNCTION public.bulk_accept(p_session uuid, p_min_confidence numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  opp               uuid;
  accepted          int;
  held_gated        int;
  held_uncalibrated int;
  below             int;
BEGIN
  IF p_min_confidence IS NULL OR p_min_confidence < 0 OR p_min_confidence > 1 THEN
    RAISE EXCEPTION 'The confidence threshold must be between 0 and 1' USING ERRCODE = '22023';
  END IF;
  SELECT s.opportunity_id INTO opp FROM public.rfi_sessions s WHERE s.id = p_session;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such session' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (public.is_admin() OR (opp IS NOT NULL AND public.is_response_owner(opp))) THEN
    RAISE EXCEPTION 'Only the response owner or an admin can approve questions in bulk' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) FILTER (WHERE q.gate IS NOT NULL),
         count(*) FILTER (WHERE q.gate IS NULL AND (q.confidence IS NULL OR q.processed_at IS NULL)),
         count(*) FILTER (WHERE q.gate IS NULL AND q.processed_at IS NOT NULL AND q.confidence < p_min_confidence)
    INTO held_gated, held_uncalibrated, below
    FROM public.rfi_questions q
   WHERE q.session_id = p_session AND q.status = 'pending';

  UPDATE public.rfi_questions q
     SET status = 'accepted'
   WHERE q.session_id = p_session
     AND q.status = 'pending'
     AND q.gate IS NULL
     AND q.processed_at IS NOT NULL
     AND q.confidence IS NOT NULL
     AND q.confidence >= p_min_confidence;
  GET DIAGNOSTICS accepted = ROW_COUNT;

  RETURN jsonb_build_object(
    'accepted', accepted,
    'heldGated', held_gated,
    'heldUncalibrated', held_uncalibrated,
    'belowThreshold', below
  );
END;
$$;

-- ─── 6: no deletes by members ───────────────────────────────────────────────

REVOKE DELETE ON public.rfi_questions FROM authenticated;
REVOKE DELETE ON public.rfi_sessions FROM authenticated;
