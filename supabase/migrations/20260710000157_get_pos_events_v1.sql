-- S72 Lot 4 — read RPC for the POS operational audit journal (pos_events).
-- Keyset-paginated (occurred_at DESC, id DESC) so the Activity journal can
-- infinite-scroll a month of events without OFFSET degradation on the
-- partitioned table. Filters: event types (text[] vs enum), device, actor,
-- order. WITA business-date window from business_config (id=1), same
-- convention as the get_pos_*_v1 reports family. Facets (devices/actors seen
-- in range) + total_count are computed on the FIRST page only (p_cursor IS
-- NULL) — cursor pages return empty facets / -1 total and the client keeps
-- page-1's. Gated reports.audit.read (same permission as the pos_events RLS
-- SELECT policy). Read-only; money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_events_v1(
  p_start_date  date,
  p_end_date    date,
  p_event_types text[] DEFAULT NULL,
  p_device_id   uuid   DEFAULT NULL,
  p_actor_id    uuid   DEFAULT NULL,
  p_order_id    uuid   DEFAULT NULL,
  p_limit       integer DEFAULT 100,
  p_cursor      text   DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz          TEXT;
  v_limit       INTEGER;
  v_cur_at      TIMESTAMPTZ;
  v_cur_id      UUID;
  v_total       INTEGER := -1;
  v_events      JSONB;
  v_next_cursor TEXT;
  v_devices     JSONB := '[]'::jsonb;
  v_actors      JSONB := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.audit.read') THEN
    RAISE EXCEPTION 'permission denied: reports.audit.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);

  -- Keyset cursor: '<occurred_at ISO-UTC>|<id uuid>' from the previous page's
  -- last row. Malformed input is a client bug — reject it explicitly.
  IF p_cursor IS NOT NULL THEN
    BEGIN
      v_cur_at := split_part(p_cursor, '|', 1)::timestamptz;
      v_cur_id := split_part(p_cursor, '|', 2)::uuid;
      IF v_cur_at IS NULL OR v_cur_id IS NULL THEN
        RAISE EXCEPTION 'invalid_cursor';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Page-1-only aggregates: true total + filter facets. Cursor pages skip
  -- these scans entirely (total = -1 sentinel, empty facets).
  IF p_cursor IS NULL THEN
    SELECT COUNT(*)::int INTO v_total
    FROM pos_events e
    WHERE ((e.occurred_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
      AND (p_event_types IS NULL OR e.event_type::text = ANY(p_event_types))
      AND (p_device_id IS NULL OR e.device_id = p_device_id)
      AND (p_actor_id  IS NULL OR e.actor_id  = p_actor_id)
      AND (p_order_id  IS NULL OR e.order_id  = p_order_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', d.id, 'label', d.label, 'kind', d.kind, 'is_registered', d.is_registered
           ) ORDER BY d.label), '[]'::jsonb)
      INTO v_devices
    FROM pos_devices d
    WHERE EXISTS (
      SELECT 1 FROM pos_events e
      WHERE e.device_id = d.id
        AND ((e.occurred_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
    );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', a.actor_id, 'name', a.actor_name
           ) ORDER BY a.actor_name), '[]'::jsonb)
      INTO v_actors
    FROM (
      SELECT DISTINCT e.actor_id, COALESCE(up.full_name, 'Unknown') AS actor_name
      FROM pos_events e
      LEFT JOIN user_profiles up ON up.id = e.actor_id
      WHERE e.actor_id IS NOT NULL
        AND ((e.occurred_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
    ) a;
  END IF;

  WITH page AS (
    SELECT
      e.id, e.event_type, e.occurred_at, e.device_id, e.device_seq,
      e.actor_id, e.session_id, e.order_id, e.order_number_snap,
      e.order_item_id, e.amount, e.reason, e.payload
    FROM pos_events e
    WHERE ((e.occurred_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
      AND (p_event_types IS NULL OR e.event_type::text = ANY(p_event_types))
      AND (p_device_id IS NULL OR e.device_id = p_device_id)
      AND (p_actor_id  IS NULL OR e.actor_id  = p_actor_id)
      AND (p_order_id  IS NULL OR e.order_id  = p_order_id)
      AND (v_cur_at IS NULL OR (e.occurred_at, e.id) < (v_cur_at, v_cur_id))
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT v_limit + 1
  ),
  trimmed AS (
    SELECT * FROM page ORDER BY occurred_at DESC, id DESC LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',            t.id,
        'event_type',    t.event_type,
        'occurred_at',   t.occurred_at,
        'device_id',     t.device_id,
        'device_label',  COALESCE(pd.label, 'Unknown device'),
        'device_kind',   COALESCE(pd.kind, 'unknown'),
        'device_seq',    t.device_seq,
        'actor_id',      t.actor_id,
        'actor_name',    up.full_name,
        'session_id',    t.session_id,
        'order_id',      t.order_id,
        'order_number',  t.order_number_snap,
        'order_item_id', t.order_item_id,
        'amount',        t.amount,
        'reason',        t.reason,
        'payload',       t.payload
      ) ORDER BY t.occurred_at DESC, t.id DESC
    ), '[]'::jsonb),
    CASE WHEN (SELECT COUNT(*) FROM page) > v_limit
      THEN (SELECT to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' || id::text
              FROM trimmed ORDER BY occurred_at ASC, id ASC LIMIT 1)
      ELSE NULL
    END
  INTO v_events, v_next_cursor
  FROM trimmed t
  LEFT JOIN pos_devices  pd ON pd.id = t.device_id
  LEFT JOIN user_profiles up ON up.id = t.actor_id;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'total_count',  v_total,
    'next_cursor',  v_next_cursor,
    'devices',      v_devices,
    'actors',       v_actors,
    'events',       v_events
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_events_v1(date, date, text[], uuid, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_events_v1(date, date, text[], uuid, uuid, uuid, integer, text) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_events_v1(date, date, text[], uuid, uuid, uuid, integer, text) IS
  'S72 audit-journal reader: keyset-paginated pos_events over a WITA range with type/device/actor/order filters + page-1 facets; gated reports.audit.read. Read-only.';
