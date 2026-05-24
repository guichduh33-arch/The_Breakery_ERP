CREATE OR REPLACE FUNCTION get_payments_by_method_v1(p_date_start TEXT, p_date_end TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id     UUID := auth.uid();
  v_start         TIMESTAMPTZ := (p_date_start || 'T00:00:00Z')::timestamptz;
  v_end           TIMESTAMPTZ := (p_date_end   || 'T23:59:59Z')::timestamptz;
  v_total_amount  NUMERIC(15,2);
  v_total_count   INT;
  v_total_orders  INT;
  v_by_method     JSONB;
  v_by_day        JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  -- Aggregate totals
  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at BETWEEN v_start AND v_end
      AND o.status NOT IN ('voided')
  )
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COUNT(DISTINCT order_id)
  INTO v_total_amount, v_total_count, v_total_orders
  FROM valid_payments;

  -- Aggregate by method
  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at BETWEEN v_start AND v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.amount DESC), '[]'::jsonb)
  INTO v_by_method
  FROM (
    SELECT
      method::text AS method,
      SUM(amount)  AS amount,
      COUNT(*)     AS count,
      CASE WHEN v_total_amount = 0 THEN 0
           ELSE ROUND((SUM(amount) / v_total_amount) * 100, 2)
      END AS share_pct
    FROM valid_payments
    GROUP BY method
  ) t;

  -- Aggregate by day (pivoted per method)
  WITH valid_payments AS (
    SELECT op.id, op.order_id, op.method, op.amount, op.paid_at
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE op.paid_at BETWEEN v_start AND v_end
      AND o.status NOT IN ('voided')
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      DATE(paid_at) AS day,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'cash'),         0) AS cash,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'card'),         0) AS card,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'qris'),         0) AS qris,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'edc'),          0) AS edc,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'transfer'),     0) AS transfer,
      COALESCE(SUM(amount) FILTER (WHERE method::text = 'store_credit'), 0) AS store_credit,
      SUM(amount) AS total
    FROM valid_payments
    GROUP BY DATE(paid_at)
  ) t;

  RETURN jsonb_build_object(
    'period',  jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary', jsonb_build_object(
      'total_amount', v_total_amount,
      'total_count',  v_total_count,
      'total_orders', v_total_orders
    ),
    'by_method', v_by_method,
    'by_day',    v_by_day
  );
END;
$$;

COMMENT ON FUNCTION get_payments_by_method_v1(TEXT, TEXT) IS
  'S30 : Payment by Method — summary + by_method (with share_pct) + by_day pivoted for chart. Excludes voided orders.';
