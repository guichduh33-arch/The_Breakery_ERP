-- S72 Lot 5 — "source unique": the audit journal becomes ONE unified stream.
-- Same signature as _157 (CREATE OR REPLACE, additive) — the reader now merges,
-- AT READ TIME:
--   * client GESTURES  — pos_events rows (best-effort, device-attributed), and
--   * server OUTCOMES  — authoritative events derived from the money-path
--     tables, so the journal is complete even when a terminal never synced:
--       sale_completed   ← orders (paid/completed, canonical reports scope:
--                          non-B2B, non-historical, no test-product line) —
--                          reconciles 1:1 with the Overview order count.
--       order_voided     ← orders.voided_at (synthetic type, not in the enum:
--                          it exists only in this reader; actor = voided_by).
--       refund_issued    ← refunds (partial only — full voids surface as
--                          order_voided, not twice).
--       session_opened   ← pos_sessions (DEDUPED: skipped when the terminal's
--                          client event for the same session_id already exists).
--       session_closed   ← pos_sessions.closed_at.
-- Derived rows carry payload.source='server', a NULL device (device filter
-- naturally excludes them), a stable synthetic uuid (md5 of kind+row id) so
-- keyset pagination stays deterministic, and the drawer owner / voider /
-- refunder as actor. The financial tabs keep deriving from the money tables —
-- this reader shares their exact scope, so the numbers reconcile by
-- construction. Read-only; zero writes; money-path untouched.

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

  -- Devices facet (page 1): terminals seen in range — client stream only
  -- (server-derived rows are deviceless by definition).
  IF p_cursor IS NULL THEN
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
  END IF;

  WITH unified AS (
    -- ── Client gestures (pos_events) ─────────────────────────────────────
    SELECT
      e.id, e.event_type::text AS event_type, e.occurred_at, e.device_id,
      e.device_seq, e.actor_id, e.session_id, e.order_id,
      e.order_number_snap AS order_number, e.order_item_id, e.amount, e.reason,
      e.payload, 'client'::text AS source
    FROM pos_events e
    WHERE ((e.occurred_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date

    UNION ALL
    -- ── Server outcome: sale completed (canonical reports scope) ─────────
    SELECT
      md5('srv-sale:' || o.id::text)::uuid, 'sale_completed',
      COALESCE(o.paid_at, o.created_at), NULL, NULL,
      ps.opened_by, o.session_id, o.id, o.order_number, NULL, o.total, NULL,
      jsonb_build_object('source', 'server', 'order_type', o.order_type), 'server'
    FROM orders o
    LEFT JOIN pos_sessions ps ON ps.id = o.session_id
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date

    UNION ALL
    -- ── Server outcome: full order void ──────────────────────────────────
    SELECT
      md5('srv-void:' || o.id::text)::uuid, 'order_voided',
      o.voided_at, NULL, NULL,
      o.voided_by, o.session_id, o.id, o.order_number, NULL, o.total, o.void_reason,
      jsonb_build_object('source', 'server'), 'server'
    FROM orders o
    WHERE o.voided_at IS NOT NULL
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date

    UNION ALL
    -- ── Server outcome: partial refund (full voids already surfaced) ─────
    SELECT
      md5('srv-refund:' || r.id::text)::uuid, 'refund_issued',
      r.created_at, NULL, NULL,
      r.refunded_by, r.session_id, r.order_id, o.order_number, NULL, r.total, r.reason,
      jsonb_build_object('source', 'server', 'refund_number', r.refund_number,
                         'authorized_by', r.authorized_by), 'server'
    FROM refunds r
    LEFT JOIN orders o ON o.id = r.order_id
    WHERE r.is_full_void = false
      AND ((r.created_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date

    UNION ALL
    -- ── Server truth: session opened (deduped vs the client's own event) ─
    SELECT
      md5('srv-sess-open:' || s.id::text)::uuid, 'session_opened',
      s.opened_at, NULL, NULL,
      s.opened_by, s.id, NULL, NULL, NULL, s.opening_cash, NULL,
      jsonb_build_object('source', 'server'), 'server'
    FROM pos_sessions s
    WHERE ((s.opened_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
      AND NOT EXISTS (
        SELECT 1 FROM pos_events e2
        WHERE e2.event_type = 'session_opened' AND e2.session_id = s.id
      )

    UNION ALL
    -- ── Server truth: session closed ─────────────────────────────────────
    SELECT
      md5('srv-sess-close:' || s.id::text)::uuid, 'session_closed',
      s.closed_at, NULL, NULL,
      s.closed_by, s.id, NULL, NULL, NULL, s.closing_cash, NULL,
      jsonb_build_object('source', 'server'), 'server'
    FROM pos_sessions s
    WHERE s.closed_at IS NOT NULL
      AND ((s.closed_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  filtered AS (
    SELECT * FROM unified u
    WHERE (p_event_types IS NULL OR u.event_type = ANY(p_event_types))
      AND (p_device_id IS NULL OR u.device_id = p_device_id)
      AND (p_actor_id  IS NULL OR u.actor_id  = p_actor_id)
      AND (p_order_id  IS NULL OR u.order_id  = p_order_id)
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    WHERE v_cur_at IS NULL OR (f.occurred_at, f.id) < (v_cur_at, v_cur_id)
    ORDER BY f.occurred_at DESC, f.id DESC
    LIMIT v_limit + 1
  ),
  trimmed AS (
    SELECT * FROM page ORDER BY occurred_at DESC, id DESC LIMIT v_limit
  )
  SELECT
    CASE WHEN v_cur_at IS NULL THEN (SELECT COUNT(*)::int FROM filtered) ELSE -1 END,
    CASE WHEN v_cur_at IS NULL THEN
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', a.actor_id, 'name', a.actor_name)
                         ORDER BY a.actor_name)
        FROM (
          SELECT DISTINCT f.actor_id, COALESCE(up2.full_name, 'Unknown') AS actor_name
          FROM filtered f LEFT JOIN user_profiles up2 ON up2.id = f.actor_id
          WHERE f.actor_id IS NOT NULL
        ) a
      ), '[]'::jsonb)
    ELSE '[]'::jsonb END,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',            t.id,
        'event_type',    t.event_type,
        'occurred_at',   t.occurred_at,
        'device_id',     t.device_id,
        'device_label',  CASE WHEN t.source = 'server' THEN 'Server (money-path)'
                              ELSE COALESCE(pd.label, 'Unknown device') END,
        'device_kind',   CASE WHEN t.source = 'server' THEN 'server'
                              ELSE COALESCE(pd.kind, 'unknown') END,
        'device_seq',    t.device_seq,
        'actor_id',      t.actor_id,
        'actor_name',    up.full_name,
        'session_id',    t.session_id,
        'order_id',      t.order_id,
        'order_number',  t.order_number,
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
  INTO v_total, v_actors, v_events, v_next_cursor
  FROM trimmed t
  LEFT JOIN pos_devices  pd ON pd.id = t.device_id
  LEFT JOIN user_profiles up ON up.id = t.actor_id;

  -- jsonb_agg over an empty trimmed set yields a NULL row for the scalar
  -- CASE columns too — normalise.
  IF v_total IS NULL THEN
    v_total := CASE WHEN v_cur_at IS NULL THEN 0 ELSE -1 END;
  END IF;
  v_actors := COALESCE(v_actors, '[]'::jsonb);
  v_events := COALESCE(v_events, '[]'::jsonb);

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
  'S72 unified audit-journal stream: client gestures (pos_events) + server outcomes derived at read time (sale_completed/order_voided/refund_issued/session_opened+closed from the money tables, canonical reports scope). Keyset-paginated, gated reports.audit.read. Read-only.';
