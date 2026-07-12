-- Reports POS refonte — Overview enrichment (additive, same signature).
-- Extends get_pos_sales_overview_v1 with two backward-compatible fields so the
-- Overview tab can be a real dashboard:
--   * items_sold — total units sold (line-level, excl. cancelled/promo-gift)
--     over the same order scope, mirroring the Mix/Products line filters.
--   * by_day    — contiguous per-day revenue + ticket series over the WITA range
--     (full axis via generate_series, gaps zero-filled) for a daily trend chart
--     when the selected range spans more than one day.
-- All existing fields are unchanged. CREATE OR REPLACE (signature date,date ->
-- jsonb is identical; only added JSON keys). Read-only, money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_sales_overview_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         TEXT;
  v_revenue    NUMERIC;
  v_tax        NUMERIC;
  v_orders     INTEGER;
  v_items_sold NUMERIC;
  v_by_hour    JSONB;
  v_by_day     JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  -- Grand totals + items sold, over the canonical in-scope orders.
  WITH sale_orders AS (
    SELECT o.id, o.total, o.tax_amount
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  )
  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(tax_amount), 0), COUNT(*)
    INTO v_revenue, v_tax, v_orders
    FROM sale_orders;

  WITH sale_orders AS (
    SELECT o.id
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  )
  SELECT COALESCE(SUM(oi.quantity), 0)
    INTO v_items_sold
    FROM order_items oi
    JOIN sale_orders s ON s.id = oi.order_id
    WHERE oi.is_cancelled = false
      AND oi.is_promo_gift = false;

  -- Sales-by-hour over a full 0..23 axis (WITA hour of the business timestamp).
  WITH sale_orders AS (
    SELECT o.total, COALESCE(o.paid_at, o.created_at) AS ts
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  hourly AS (
    SELECT EXTRACT(HOUR FROM (so.ts AT TIME ZONE v_tz))::int AS hour,
           COALESCE(SUM(so.total), 0) AS revenue,
           COUNT(*)                   AS tickets
    FROM sale_orders so
    GROUP BY 1
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'hour',    h.hour,
      'revenue', COALESCE(hr.revenue, 0),
      'tickets', COALESCE(hr.tickets, 0)
    ) ORDER BY h.hour
  )
  INTO v_by_hour
  FROM generate_series(0, 23) AS h(hour)
  LEFT JOIN hourly hr ON hr.hour = h.hour;

  -- Sales-by-day over a contiguous WITA date axis (gaps zero-filled).
  WITH sale_orders AS (
    SELECT o.total,
           ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS d
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  daily AS (
    SELECT d, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS tickets
    FROM sale_orders GROUP BY d
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date',    to_char(gs::date, 'YYYY-MM-DD'),
      'revenue', COALESCE(dd.revenue, 0),
      'tickets', COALESCE(dd.tickets, 0)
    ) ORDER BY gs
  )
  INTO v_by_day
  FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') gs
  LEFT JOIN daily dd ON dd.d = gs::date;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'start_date',    p_start_date,
    'end_date',      p_end_date,
    'timezone',      v_tz,
    'revenue',       v_revenue,
    'tax',           v_tax,
    'orders',        v_orders,
    'items_sold',    v_items_sold,
    'avg_basket',    COALESCE(ROUND(v_revenue / NULLIF(v_orders, 0), 2), 0),
    'sales_by_hour', COALESCE(v_by_hour, '[]'::jsonb),
    'by_day',        COALESCE(v_by_day, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_sales_overview_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_sales_overview_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_sales_overview_v1(date, date) IS
  'POS reports Overview KPIs (revenue TTC, tax, orders, items_sold, avg basket, sales-by-hour + by-day, all w/ tickets) over a WITA date range; excludes B2B, historical imports, and test-product orders; includes paid+completed; gated reports.sales.read. Read-only.';
