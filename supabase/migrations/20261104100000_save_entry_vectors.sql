-- Sprint 16 (S16-2, BUG-40): embed-entries saves a batch's vectors in one call.
--
-- It used to write each entry's vector with its own request, so re-indexing the demo's 128 entries
-- after a reset took 11.3 seconds on the live project. This saves up to 128 at once, all or nothing:
-- an entry that no longer exists, a repeated entry, or a vector of the wrong length saves nothing
-- from the batch. Service role only, as the vector columns are (20261022150000_kb_vectors.sql).
CREATE FUNCTION public.save_entry_vectors(p_rows jsonb)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_expected int;
  v_saved int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Send an array of {id, embedding, model}' USING ERRCODE = '22023';
  END IF;
  v_expected := jsonb_array_length(p_rows);
  IF v_expected > 128 THEN
    RAISE EXCEPTION 'At most 128 vectors per call' USING ERRCODE = '22023';
  END IF;
  UPDATE public.kb_entries k
     SET embedding = (r.embedding)::text::extensions.vector,
         embedding_model = r.model,
         embedded_at = now()
    FROM jsonb_to_recordset(p_rows) AS r(id uuid, embedding jsonb, model text)
   WHERE k.id = r.id;
  GET DIAGNOSTICS v_saved = ROW_COUNT;
  IF v_saved <> v_expected THEN
    RAISE EXCEPTION 'Some entries to index no longer exist or were repeated; nothing was saved' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.save_entry_vectors(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_entry_vectors(jsonb) TO service_role;
