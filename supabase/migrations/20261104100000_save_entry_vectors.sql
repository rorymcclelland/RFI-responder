-- Sprint 16 (S16-2, BUG-40): embed-entries saves a batch's vectors in one call.
--
-- It used to write each entry's vector with its own request: on the live project, the run that
-- re-indexed the demo's 128 entries after a reset took 11.3 seconds, writing one request per entry.
-- This saves a whole batch (embed-entries sends 64; at most 128) in one call. The batch is refused,
-- saving nothing, if any element lacks an id, a vector (a JSON array) or a model name, repeats an
-- entry, or has a vector of the wrong length. An entry deleted since it was read (by an admin, or a
-- demo reset) is skipped rather than refusing the rest, which have already been paid for (security
-- review, finding 5); the count saved is returned. Service role only, as the vector columns are
-- (20261022150000_kb_vectors.sql).
CREATE FUNCTION public.save_entry_vectors(p_rows jsonb)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_saved int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send an array of {id, embedding, model}' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 128 THEN
    RAISE EXCEPTION 'At most 128 vectors per call' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) e
     WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
        OR jsonb_typeof(e->'id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(e->'embedding') IS DISTINCT FROM 'array'
        OR jsonb_typeof(e->'model') IS DISTINCT FROM 'string'
        OR btrim(e->>'model') = ''
  ) THEN
    RAISE EXCEPTION 'Every vector needs an id, an embedding array and a model name; nothing was saved' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT e->>'id') FROM jsonb_array_elements(p_rows) e) THEN
    RAISE EXCEPTION 'An entry appears twice in the batch; nothing was saved' USING ERRCODE = '22023';
  END IF;
  UPDATE public.kb_entries k
     SET embedding = (r.embedding)::text::extensions.vector,
         embedding_model = r.model,
         embedded_at = now()
    FROM jsonb_to_recordset(p_rows) AS r(id uuid, embedding jsonb, model text)
   WHERE k.id = r.id;
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_entry_vectors(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_entry_vectors(jsonb) TO service_role;
