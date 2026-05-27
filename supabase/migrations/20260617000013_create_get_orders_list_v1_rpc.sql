-- 20260617000013_create_get_orders_list_v1_rpc.sql
-- S32 Wave 1.E — New RPC: get_orders_list_v1
-- Cursor-paginated orders list with JSONB filters and derived columns.
-- Permission gate: orders.read (seeded S31).
-- Schema corrections applied:
--   DEV-S32-1.A-01: orders has no terminal_id — filter axis dropped V1
--   DEV-S32-1.A-02: customers.name (not full_name / display_name)
--   DEV-S32-1.A-03: refunds.total (not refunds.amount)
-- REVOKE pair comes in migration 20260617000014 (Task 1.F).

CREATE OR REPLACE FUNCTION public.get_orders_list_v1(
  p_start    TEXT,
  p_end      TEXT,
  p_filters  JSONB        DEFAULT '{}'::JSONB,
  p_limit    INT          DEFAULT 50,
  p_cursor   TIMESTAMPTZ  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_clamp     INT         := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
BEGIN
  -- Auth guard
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Permission gate
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  -- Fetch v_clamp + 1 rows to detect whether a next page exists.
  -- Computed columns:
  --   refund_status       : none | partial | full  (via LATERAL SUM on refunds.total)
  --   has_modifiers       : true if any order_item has a non-empty modifiers JSONB array
  --   payment_method_primary : single method text or 'mixed' if >1 distinct methods
  --   items_count         : COUNT of order_items rows
  -- No terminal_id filter — orders has no such column (DEV-S32-1.A-01).
  WITH filtered AS (
    SELECT
      o.id,
      o.order_number,
      o.order_type,
      o.status,
      o.total,
      o.created_at,
      o.customer_id,
      c.customer_type,
      c.name                    AS customer_name,
      o.served_by,
      up.full_name              AS served_by_name,
      -- refund_status: compare SUM(refunds.total) against order.total
      CASE
        WHEN COALESCE(rsum.total, 0) = 0              THEN 'none'
        WHEN COALESCE(rsum.total, 0) >= o.total       THEN 'full'
        ELSE                                               'partial'
      END                       AS refund_status,
      -- has_modifiers: true when any line item has a non-empty modifiers array
      EXISTS (
        SELECT 1
        FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      )                         AS has_modifiers,
      -- payment_method_primary: 'mixed' when multiple distinct methods, else the single method
      (
        SELECT CASE
                 WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                 ELSE MIN(op.method::text)
               END
        FROM order_payments op
        WHERE op.order_id = o.id
      )                         AS payment_method_primary,
      -- items_count
      (
        SELECT COUNT(*)::INT
        FROM order_items oi2
        WHERE oi2.order_id = o.id
      )                         AS items_count,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total
      FROM refunds r
      WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_cursor IS NULL OR o.created_at < p_cursor)
      -- JSONB filter axes (unknown keys silently ignored per architecture §2)
      AND (p_filters->>'status'         IS NULL OR o.status::text          = p_filters->>'status')
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text      = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id           = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by             = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total                >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total                <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text   = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
            SELECT 1
            FROM order_payments op2
            WHERE op2.order_id = o.id
              AND op2.method::text = p_filters->>'payment_method'
          ))
    ORDER BY o.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',                     f.id,
          'order_number',           f.order_number,
          'order_type',             f.order_type,
          'status',                 f.status,
          'total',                  f.total,
          'created_at',             f.created_at,
          'customer_id',            f.customer_id,
          'customer_name',          f.customer_name,
          'customer_type',          f.customer_type,
          'served_by',              f.served_by,
          'served_by_name',         f.served_by_name,
          'refund_status',          f.refund_status,
          'has_modifiers',          f.has_modifiers,
          'payment_method_primary', f.payment_method_primary,
          'items_count',            f.items_count
        )
        ORDER BY f.created_at DESC
      ) FILTER (WHERE f.rn <= v_clamp),
      '[]'::jsonb
    )
  INTO v_lines
  FROM filtered f;

  -- next_cursor: MIN(created_at) of rows beyond the page boundary (rn > v_clamp)
  -- Returns NULL when no further page exists.
  WITH filtered AS (
    SELECT
      o.created_at,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC) AS rn
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total
      FROM refunds r
      WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_cursor IS NULL OR o.created_at < p_cursor)
      AND (p_filters->>'status'         IS NULL OR o.status::text          = p_filters->>'status')
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text      = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id           = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by             = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total                >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total                <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text   = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
            SELECT 1
            FROM order_payments op2
            WHERE op2.order_id = o.id
              AND op2.method::text = p_filters->>'payment_method'
          ))
    ORDER BY o.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT MIN(created_at) INTO v_next
  FROM filtered
  WHERE rn > v_clamp;

  RETURN jsonb_build_object(
    'lines',       v_lines,
    'next_cursor', v_next
  );
END;
$$;

COMMENT ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) IS
  'S32 — Orders list, cursor-paginated (default 50, max 200). '
  'p_filters JSONB accepted keys: '
  'status (order_status enum text), '
  'order_type (order_type enum text), '
  'customer_id (UUID), '
  'served_by (UUID), '
  'total_min (numeric), '
  'total_max (numeric), '
  'customer_type (customer_type enum text e.g. retail|b2b), '
  'payment_method (payment_method enum text e.g. cash|card|qris|edc|transfer|store_credit). '
  'Note: terminal_id filter not available V1 — orders has no terminal_id column (DEV-S32-1.A-01). '
  'Computed output cols: refund_status (none|partial|full), has_modifiers (bool), '
  'payment_method_primary (method text or ''mixed''), items_count (int), '
  'customer_name (text|null), customer_type (text|null), served_by_name (text|null). '
  'Gated by orders.read permission. REVOKE pair in migration 20260617000014.';

GRANT EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) TO authenticated;
