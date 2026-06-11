-- 20260624000016_create_get_staff_performance_v1_rpc.sql
-- S40 — Staff Performance report. Gate reports.sales.read.
-- Schema verified: orders.served_by/voided_by/voided_at/discount_amount,
-- refunds.refunded_by, order_items.is_cancelled/cancelled_by/cancelled_at,
-- user_profiles.full_name. orders discount column is discount_amount
-- (plan said "discount" — DEV-S40-A2-01).
-- Staff dimensions combined via UNION of staff ids + LEFT JOINs (cleaner than
-- chained FULL OUTER JOINs).

CREATE OR REPLACE FUNCTION public.get_staff_performance_v1(
  p_date_start TEXT,
  p_date_end   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_by_staff JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH served AS (
    SELECT o.served_by                   AS staff_id,
           COUNT(*)::INT                 AS orders_served,
           SUM(o.total)::NUMERIC(14,2)   AS revenue
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  items AS (
    SELECT o.served_by AS staff_id,
           COUNT(oi.id)::INT AS item_count
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id AND oi.is_cancelled = false
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  voids AS (
    SELECT o.voided_by                  AS staff_id,
           COUNT(*)::INT                AS voids_count,
           SUM(o.total)::NUMERIC(14,2)  AS voids_value
      FROM orders o
     WHERE o.voided_at IS NOT NULL
       AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.voided_by IS NOT NULL
     GROUP BY o.voided_by
  ),
  refunds_agg AS (
    SELECT r.refunded_by                AS staff_id,
           COUNT(*)::INT                AS refunds_count,
           SUM(r.total)::NUMERIC(14,2)  AS refunds_value
      FROM refunds r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND r.refunded_by IS NOT NULL
     GROUP BY r.refunded_by
  ),
  discounts AS (
    SELECT o.served_by                            AS staff_id,
           COUNT(*)::INT                          AS discount_orders_count,
           SUM(o.discount_amount)::NUMERIC(14,2)  AS discount_value
      FROM orders o
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND o.discount_amount > 0
       AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  cancelled AS (
    SELECT oi.cancelled_by AS staff_id,
           COUNT(*)::INT   AS items_cancelled
      FROM order_items oi
     WHERE oi.is_cancelled = true
       AND oi.cancelled_by IS NOT NULL
       AND oi.cancelled_at IS NOT NULL
       AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY oi.cancelled_by
  ),
  all_staff AS (
    SELECT staff_id FROM served
    UNION SELECT staff_id FROM voids
    UNION SELECT staff_id FROM refunds_agg
    UNION SELECT staff_id FROM discounts
    UNION SELECT staff_id FROM cancelled
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'staff_id',              a.staff_id,
      'staff_name',            COALESCE(up.full_name, '(unknown)'),
      'orders_served',         COALESCE(s.orders_served, 0),
      'revenue',               COALESCE(s.revenue, 0),
      'aov',                   CASE WHEN COALESCE(s.orders_served, 0) = 0 THEN 0
                                    ELSE ROUND(s.revenue / s.orders_served, 2) END,
      'items_per_order',       CASE WHEN COALESCE(s.orders_served, 0) = 0 THEN 0
                                    ELSE ROUND(COALESCE(i.item_count, 0)::numeric / s.orders_served, 2) END,
      'voids_count',           COALESCE(v.voids_count, 0),
      'voids_value',           COALESCE(v.voids_value, 0),
      'refunds_count',         COALESCE(r.refunds_count, 0),
      'refunds_value',         COALESCE(r.refunds_value, 0),
      'discount_orders_count', COALESCE(d.discount_orders_count, 0),
      'discount_value',        COALESCE(d.discount_value, 0),
      'items_cancelled',       COALESCE(c.items_cancelled, 0)
    ) ORDER BY COALESCE(s.revenue, 0) DESC
  ), '[]'::jsonb)
  INTO v_by_staff
  FROM all_staff a
  LEFT JOIN served      s ON s.staff_id = a.staff_id
  LEFT JOIN items       i ON i.staff_id = a.staff_id
  LEFT JOIN voids       v ON v.staff_id = a.staff_id
  LEFT JOIN refunds_agg r ON r.staff_id = a.staff_id
  LEFT JOIN discounts   d ON d.staff_id = a.staff_id
  LEFT JOIN cancelled   c ON c.staff_id = a.staff_id
  LEFT JOIN user_profiles up ON up.id = a.staff_id;

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'by_staff', v_by_staff
  );
END;
$$;

COMMENT ON FUNCTION public.get_staff_performance_v1(TEXT, TEXT) IS
  'S40 — per-staff orders/revenue/AOV/items + voids/refunds/discounts/cancelled items. '
  'Gate reports.sales.read.';

REVOKE ALL ON FUNCTION public.get_staff_performance_v1(TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_staff_performance_v1(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_staff_performance_v1(TEXT, TEXT) TO authenticated;
