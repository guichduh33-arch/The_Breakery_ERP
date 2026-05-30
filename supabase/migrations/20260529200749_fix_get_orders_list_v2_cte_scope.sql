-- Session 33 / Wave 4.1 corrective — fix CTE scope bug in get_orders_list_v2
--
-- The previous version (migration 20260529192143_bump_get_orders_list_v2_server_filters
-- in cloud / 20260618000011 local) referenced the CTE `filtered` in a SECOND,
-- separate SELECT statement to compute the next_cursor. PostgreSQL CTEs only
-- persist for the single statement they accompany, so the second SELECT raised
-- 42P01 "relation filtered does not exist".
--
-- This made the RPC unusable for ANY call (not edge-case-dependent). Discovered
-- by Wave 4.1 pgTAP T1-T10 (every test triggered the failure).
--
-- Fix : merge both projections into a single SELECT INTO statement so the CTE
-- remains in scope. Behavior preserved exactly (same lines aggregation, same
-- next_cursor semantics).

CREATE OR REPLACE FUNCTION public.get_orders_list_v2(
  p_start    TEXT,
  p_end      TEXT,
  p_filters  JSONB        DEFAULT '{}'::JSONB,
  p_limit    INT          DEFAULT 50,
  p_cursor   TIMESTAMPTZ  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  -- Single statement : CTE + two parallel aggregations selected together so
  -- the CTE remains in scope for both projections.
  WITH filtered AS (
    SELECT
      o.id, o.order_number, o.order_type, o.status, o.total, o.created_at,
      o.customer_id, o.served_by, ps.terminal_id,
      c.customer_type, c.name AS customer_name,
      up.full_name AS served_by_name,
      CASE
        WHEN COALESCE(rsum.total, 0) = 0      THEN 'none'
        WHEN COALESCE(rsum.total, 0) >= o.total THEN 'full'
        ELSE 'partial'
      END AS refund_status,
      EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      (
        SELECT CASE WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                    ELSE MIN(op.method)::text END
        FROM order_payments op WHERE op.order_id = o.id
      ) AS payment_method_primary,
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN pos_sessions  ps  ON ps.id = o.session_id
    LEFT JOIN LATERAL (
      SELECT SUM(r.total) AS total FROM refunds r WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_cursor IS NULL OR o.created_at < p_cursor)
      AND (p_filters->>'status'         IS NULL OR o.status::text       = p_filters->>'status')
      AND (p_filters->>'order_type'     IS NULL OR o.order_type::text   = p_filters->>'order_type')
      AND (p_filters->>'customer_id'    IS NULL OR o.customer_id        = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'      IS NULL OR o.served_by          = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'total_min'      IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'      IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type'  IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id AND op.method::text = p_filters->>'payment_method'
      ))
      AND (p_filters->>'terminal_id'    IS NULL OR ps.terminal_id       = (p_filters->>'terminal_id')::uuid)
      AND (p_filters->>'hour'           IS NULL OR EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'Asia/Makassar') = (p_filters->>'hour')::int)
      AND (
        p_filters->>'refund_status' IS NULL
        OR (
          p_filters->>'refund_status' = 'none'
            AND NOT EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
        )
        OR (
          p_filters->>'refund_status' = 'partial'
            AND EXISTS (SELECT 1 FROM refunds r WHERE r.order_id = o.id)
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) < o.total
        )
        OR (
          p_filters->>'refund_status' = 'full'
            AND COALESCE((SELECT SUM(r.total) FROM refunds r WHERE r.order_id = o.id), 0) >= o.total
        )
      )
    ORDER BY o.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
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
      'terminal_id',            f.terminal_id,
      'refund_status',          f.refund_status,
      'has_modifiers',          f.has_modifiers,
      'payment_method_primary', f.payment_method_primary,
      'items_count',            f.items_count
    ) ORDER BY f.created_at DESC) FILTER (WHERE f.rn <= v_clamp), '[]'::jsonb),
    MIN(f.created_at) FILTER (WHERE f.rn > v_clamp)
  INTO v_lines, v_next
  FROM filtered f;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next);
END;
$$;

COMMENT ON FUNCTION public.get_orders_list_v2 IS
  'S33 — Orders list cursor-paginated with server-side filters. p_filters keys: '
  'status, order_type, customer_id, served_by, total_min, total_max, customer_type, '
  'payment_method, terminal_id, hour (0-23 Asia/Makassar), refund_status (none|partial|full). '
  'Computed output cols: refund_status, has_modifiers, payment_method_primary (or ''mixed''), '
  'items_count, customer_name, customer_type, served_by_name, terminal_id. Gated orders.read. '
  'S33 Wave 4.1 corrective : CTE scope bug fix (lines+next_cursor in same SELECT INTO).';
