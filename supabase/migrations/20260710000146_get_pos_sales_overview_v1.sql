-- Reports POS refonte (Lot A) — server-side Overview KPIs, shared with the BO.
-- Replaces the client-side JS aggregation in usePOSReportsOverview:
--   * timezone-correct (WITA / business_config.timezone) date + hour bucketing,
--     fixing the "Sales by Hour empty / KPIs 0" bug on non-WITA terminals;
--   * excludes B2B, historical imports, and any order touching a test product;
--   * includes both paid and completed retail orders (owner decision 2026-07-11);
--   * returns per-hour revenue AND ticket count over a full 0..23 axis.
-- Revenue is TTC (tax-inclusive), tax reported separately. Read-only, no writes.
-- Gated reports.sales.read (mirrors the POS route gate). Money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_sales_overview_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz      TEXT;
  v_revenue NUMERIC;
  v_tax     NUMERIC;
  v_orders  INTEGER;
  v_by_hour JSONB;
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

  -- Grand totals. Business timestamp = paid_at when present else created_at
  -- (completed orders may lack paid_at). Local date via AT TIME ZONE v_tz.
  WITH sale_orders AS (
    SELECT o.total, o.tax_amount
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

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'start_date',    p_start_date,
    'end_date',      p_end_date,
    'timezone',      v_tz,
    'revenue',       v_revenue,
    'tax',           v_tax,
    'orders',        v_orders,
    'avg_basket',    COALESCE(ROUND(v_revenue / NULLIF(v_orders, 0), 2), 0),
    'sales_by_hour', COALESCE(v_by_hour, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_sales_overview_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_sales_overview_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_sales_overview_v1(date, date) IS
  'POS reports Overview KPIs (revenue TTC, tax, orders, avg basket, sales-by-hour w/ tickets) over a WITA date range; excludes B2B, historical imports, and test-product orders; includes paid+completed; gated reports.sales.read. Read-only.';
