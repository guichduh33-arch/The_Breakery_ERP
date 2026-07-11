-- S72 Lot 1 — batch, idempotent ingest for the POS operational audit journal.
-- The client flushes its IndexedDB outbox as one array; each element is one
-- event. Resolves (auto-provisions) the device from its opaque token, then
-- inserts all events with ON CONFLICT DO NOTHING on (client_event_id,
-- occurred_at) so replays (flaky network, double flush, restart) never double
-- count. Any authenticated POS operator may write their own events; the read
-- side stays gated (reports.audit.read). Non-blocking to the money-path.

CREATE OR REPLACE FUNCTION public.record_pos_events_v1(
  p_device_token text,
  p_events       jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_device_id uuid;
  v_total     int;
  v_inserted  int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_device_token IS NULL OR length(p_device_token) < 8 THEN
    RAISE EXCEPTION 'device_token required (>= 8 chars)' USING ERRCODE = 'P0001';
  END IF;
  IF p_events IS NULL OR jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'events must be a jsonb array' USING ERRCODE = 'P0001';
  END IF;

  v_total := jsonb_array_length(p_events);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('device_id', NULL, 'received', 0, 'inserted', 0, 'duplicates', 0);
  END IF;

  -- Resolve or auto-provision the device; refresh last_seen.
  INSERT INTO public.pos_devices (device_token, label, kind)
    VALUES (p_device_token, 'Unregistered ' || left(p_device_token, 8), 'unknown')
    ON CONFLICT (device_token) DO UPDATE SET last_seen_at = now()
    RETURNING id INTO v_device_id;

  WITH ins AS (
    INSERT INTO public.pos_events (
      client_event_id, event_type, occurred_at, device_id, device_seq,
      actor_id, synced_by, session_id, order_id, order_number_snap,
      order_item_id, amount, reason, payload
    )
    SELECT
      (e->>'client_event_id')::uuid,
      (e->>'event_type')::public.pos_event_type,
      (e->>'occurred_at')::timestamptz,
      v_device_id,
      NULLIF(e->>'device_seq', '')::bigint,
      NULLIF(e->>'actor_id', '')::uuid,
      auth.uid(),
      NULLIF(e->>'session_id', '')::uuid,
      NULLIF(e->>'order_id', '')::uuid,
      e->>'order_number_snap',
      NULLIF(e->>'order_item_id', '')::uuid,
      NULLIF(e->>'amount', '')::numeric,
      e->>'reason',
      COALESCE(e->'payload', '{}'::jsonb)
    FROM jsonb_array_elements(p_events) e
    ON CONFLICT (client_event_id, occurred_at) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'device_id',  v_device_id,
    'received',   v_total,
    'inserted',   v_inserted,
    'duplicates', v_total - v_inserted
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_pos_events_v1(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_pos_events_v1(text, jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.record_pos_events_v1(text, jsonb) IS
  'S72 batch idempotent ingest for pos_events; auto-provisions the device from its token; ON CONFLICT DO NOTHING on (client_event_id, occurred_at). Authenticated write, read gated reports.audit.read.';
