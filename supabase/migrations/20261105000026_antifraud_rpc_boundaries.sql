-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_sales_by_origin_v3(p_start_date date, p_end_date date)
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
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
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
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND o.order_number ~ '^(BO|P|T[0-9])[0-9]{11,}$'
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
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
REVOKE ALL ON FUNCTION public.get_sales_by_origin_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_origin_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_origin_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_sales_by_origin_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.record_production_v10(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text DEFAULT NULL::text, p_quantity_waste numeric DEFAULT 0, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid, p_recurse_subrecipes boolean DEFAULT true, p_expected_yield_qty numeric DEFAULT NULL::numeric, p_actual_yield_qty numeric DEFAULT NULL::numeric, p_yield_variance_reason text DEFAULT NULL::text, p_force_negative boolean DEFAULT false, p_waste_reason waste_reason DEFAULT NULL::waste_reason)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.record_production_v8(p_product_id,p_quantity_produced,p_section_id,p_batch_number,p_quantity_waste,p_notes,p_idempotency_key,p_recurse_subrecipes,p_expected_yield_qty,p_actual_yield_qty,p_yield_variance_reason,p_force_negative,p_waste_reason));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.record_production_v10(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_production_v10(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason) TO authenticated;
DROP FUNCTION public.record_production_v9(p_product_id uuid, p_quantity_produced numeric, p_section_id uuid, p_batch_number text, p_quantity_waste numeric, p_notes text, p_idempotency_key uuid, p_recurse_subrecipes boolean, p_expected_yield_qty numeric, p_actual_yield_qty numeric, p_yield_variance_reason text, p_force_negative boolean, p_waste_reason waste_reason);

CREATE OR REPLACE FUNCTION public.get_sales_by_table_v3(p_start_date date, p_end_date date)
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
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
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
    SELECT o.id, o.total, o.table_number,
           ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND o.order_type = 'dine_in'
      AND NULLIF(o.table_number, '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE bd BETWEEN v_start AND v_end),
  prev AS (SELECT * FROM scoped WHERE bd <  v_start),
  active_tables AS (
    SELECT name, seats FROM restaurant_tables
    WHERE deleted_at IS NULL AND is_active
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       COALESCE((SELECT SUM(total) FROM cur), 0),
      'revenue_prev',  COALESCE((SELECT SUM(total) FROM prev), 0),
      'orders',        (SELECT COUNT(*) FROM cur),
      'orders_prev',   (SELECT COUNT(*) FROM prev),
      'tables_used',   (SELECT COUNT(DISTINCT table_number) FROM cur),
      'active_tables', (SELECT COUNT(*) FROM active_tables),
      'active_seats',  COALESCE((SELECT SUM(seats) FROM active_tables), 0)
    ),
    'by_table', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table_number', bt.table_number,
        'seats',        bt.seats,
        'orders',       bt.orders,
        'revenue',      bt.revenue,
        'avg_ticket',   bt.avg_ticket,
        'revenue_prev', COALESCE(pv.revenue, 0)
      ) ORDER BY bt.revenue DESC)
      FROM (
        SELECT c.table_number, at_.seats,
               COUNT(*)               AS orders,
               SUM(c.total)           AS revenue,
               ROUND(AVG(c.total), 0) AS avg_ticket
        FROM cur c
        LEFT JOIN active_tables at_ ON at_.name = c.table_number
        GROUP BY c.table_number, at_.seats
      ) bt
      LEFT JOIN (
        SELECT table_number, SUM(total) AS revenue
        FROM prev GROUP BY table_number
      ) pv ON pv.table_number = bt.table_number
    ), '[]'::jsonb),
    'by_table_dow', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'table_number', d.table_number,
        'dow',          d.dow,
        'orders',       d.orders,
        'revenue',      d.revenue
      ) ORDER BY d.table_number ASC, d.dow ASC)
      FROM (
        SELECT table_number,
               EXTRACT(ISODOW FROM bd)::int AS dow,
               COUNT(*)     AS orders,
               SUM(total)   AS revenue
        FROM cur
        GROUP BY table_number, EXTRACT(ISODOW FROM bd)
      ) d
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_table_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_table_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_table_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_sales_by_table_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_dashboard_open_orders_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_total NUMERIC;
  v_count INT;
  v_late  INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'orders.read') THEN
    RAISE EXCEPTION 'permission denied: orders.read required'
      USING ERRCODE = '42501';
  END IF;

  WITH open_orders AS (
    SELECT o.id, o.order_number, o.order_type, o.total,
           EXTRACT(EPOCH FROM (now() - o.created_at)) / 60 AS minutes_open,
           CASE o.order_type
             WHEN 'dine_in'  THEN COALESCE(NULLIF(btrim(o.table_number), ''), 'Dine-in')
             WHEN 'take_out' THEN 'Take-away'
             WHEN 'delivery' THEN 'Delivery'
             WHEN 'b2b'      THEN COALESCE(NULLIF(btrim(c.b2b_company_name), ''), c.name, 'B2B')
           END AS destination
      FROM reporting_private.closed_pos_orders_v1 o
      LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.status IN ('draft', 'pending_payment')
       AND o.voided_at IS NULL
       AND o.is_held IS NOT TRUE
       AND o.financial_import_document_id IS NULL
       AND o.is_historical_import IS NOT TRUE
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           oo.id,
           'order_number', oo.order_number,
           'order_type',   oo.order_type,
           'destination',  oo.destination,
           'total',        oo.total,
           'minutes_open', ROUND(oo.minutes_open)
         ) ORDER BY oo.minutes_open DESC), '[]'::jsonb),
         COALESCE(SUM(oo.total), 0),
         COUNT(*)::INT,
         COUNT(*) FILTER (WHERE oo.minutes_open > 45)::INT
    INTO v_rows, v_total, v_count, v_late
    FROM open_orders oo;

  RETURN jsonb_build_object(
    'orders',        v_rows,
    'open_count',    v_count,
    'open_total',    v_total,
    'over_45_count', v_late,
    'generated_at',  now()
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_dashboard_open_orders_v3() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_open_orders_v3() TO authenticated,service_role;
DROP FUNCTION public.get_dashboard_open_orders_v2();

CREATE OR REPLACE FUNCTION public._dashboard_hourly_v2(p_tz text, p_today date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_series JSONB;
  v_peak   JSONB;
BEGIN
  WITH hours AS (SELECT generate_series(6, 17) AS hour),
  sales AS (
    SELECT EXTRACT(HOUR FROM (o.recognized_at AT TIME ZONE p_tz))::INT AS hour,
           ((o.recognized_at AT TIME ZONE p_tz))::date                 AS day,
           o.total
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE p_tz))::date IN (p_today, p_today - 7)
  ),
  buckets AS (
    SELECT h.hour,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today), 0)::NUMERIC(14,2)     AS today,
           COALESCE(SUM(s.total) FILTER (WHERE s.day = p_today - 7), 0)::NUMERIC(14,2) AS last_week
      FROM hours h
      LEFT JOIN sales s ON s.hour = h.hour
     GROUP BY h.hour
  ),
  windows AS (
    SELECT hour,
           SUM(today) OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_total,
           COUNT(*)   OVER (ORDER BY hour ROWS BETWEEN CURRENT ROW AND 2 FOLLOWING) AS win_size,
           SUM(today) OVER ()                                                       AS day_total
      FROM buckets
  )
  SELECT (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'hour', b.hour, 'today', b.today, 'last_week', b.last_week
                 ) ORDER BY b.hour), '[]'::jsonb) FROM buckets b),
         (SELECT jsonb_build_object(
                   'from_hour', w.hour,
                   'to_hour',   w.hour + 3,
                   'share_pct', ROUND((w.win_total / w.day_total) * 100, 1))
            FROM windows w
           WHERE w.win_size = 3 AND w.day_total > 0
           ORDER BY w.win_total DESC, w.hour
           LIMIT 1)
    INTO v_series, v_peak;

  RETURN jsonb_build_object('series', v_series, 'peak', v_peak);
END;
$function$
;
REVOKE ALL ON FUNCTION public._dashboard_hourly_v2(p_tz text, p_today date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._dashboard_hourly_v2(p_tz text, p_today date) TO service_role;
DROP FUNCTION public._dashboard_hourly_v1(p_tz text, p_today date);
