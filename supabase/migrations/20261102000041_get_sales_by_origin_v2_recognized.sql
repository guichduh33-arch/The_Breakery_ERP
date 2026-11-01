-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_sales_by_origin_v2(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         text;
  v_start      date;
  v_end        date;
  v_prev_start date;
  v_prev_end   date;
  v_result     jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id, o.total,
      COALESCE(o.discount_amount, 0) + COALESCE(o.promotion_total, 0)
        + COALESCE(o.loyalty_redemption_amount, 0) AS discount_total,
      (regexp_match(o.order_number, '^(BO|P|T[0-9])'))[1] AS origin,
      ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND o.order_number ~ '^(BO|P|T[0-9])[0-9]{11,}$'
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  prev AS (SELECT * FROM scoped WHERE bd <  v_start)
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'total_revenue',      COALESCE((SELECT SUM(total)  FROM cur), 0),
      'total_orders',       (SELECT COUNT(*) FROM cur),
      'total_revenue_prev', COALESCE((SELECT SUM(total)  FROM prev), 0),
      'total_orders_prev',  (SELECT COUNT(*) FROM prev)
    ),
    'by_origin', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'origin',         bo.origin,
        'orders',         bo.orders,
        'revenue',        bo.revenue,
        'avg_ticket',     bo.avg_ticket,
        'discount_total', bo.discount_total,
        'revenue_prev',   COALESCE(pv.revenue, 0),
        'orders_prev',    COALESCE(pv.orders, 0)
      ) ORDER BY bo.revenue DESC)
      FROM (
        SELECT origin, COUNT(*) AS orders, SUM(total) AS revenue,
               ROUND(AVG(total), 0) AS avg_ticket,
               SUM(discount_total) AS discount_total
        FROM cur GROUP BY origin
      ) bo
      LEFT JOIN (
        SELECT origin, COUNT(*) AS orders, SUM(total) AS revenue
        FROM prev GROUP BY origin
      ) pv ON pv.origin = bo.origin
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',    d.bd,
        'origin',  d.origin,
        'revenue', d.revenue,
        'orders',  d.orders
      ) ORDER BY d.bd ASC, d.origin ASC)
      FROM (
        SELECT bd, origin, SUM(total) AS revenue, COUNT(*) AS orders
        FROM cur GROUP BY bd, origin
      ) d
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_origin_v2(p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_origin_v2(p_start_date date, p_end_date date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
