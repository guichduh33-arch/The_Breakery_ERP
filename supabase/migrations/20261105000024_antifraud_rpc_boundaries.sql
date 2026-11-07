-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_wastage_report_v4(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_tz         TEXT;
  v_start      TIMESTAMPTZ;
  v_end        TIMESTAMPTZ;
  v_summary    JSONB;
  v_by_product JSONB;
  v_lines      JSONB;
  v_line_cap   CONSTANT INT := 500;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);

  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  v_start := (p_date_start::date + TIME '00:00')     AT TIME ZONE v_tz;
  v_end   := ((p_date_end::date + 1) + TIME '00:00') AT TIME ZONE v_tz;

  WITH waste_rows AS (
    SELECT
      'manual_waste'::text AS type,
      ABS(sm.quantity) AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at >= v_start AND sm.created_at < v_end
  ),
  spoilage_rows AS (
    SELECT
      'spoilage'::text AS type,
      sl.quantity      AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at >= v_start AND sl.expires_at < v_end
  ),
  all_rows AS (SELECT * FROM waste_rows UNION ALL SELECT * FROM spoilage_rows)
  SELECT jsonb_build_object(
    'total_manual_waste_qty',   COALESCE(SUM(qty)   FILTER (WHERE type = 'manual_waste'), 0),
    'total_manual_waste_value', COALESCE(SUM(value) FILTER (WHERE type = 'manual_waste'), 0),
    'total_spoilage_qty',       COALESCE(SUM(qty)   FILTER (WHERE type = 'spoilage'), 0),
    'total_spoilage_value',     COALESCE(SUM(value) FILTER (WHERE type = 'spoilage'), 0),
    'total_qty',                COALESCE(SUM(qty), 0),
    'total_value',              COALESCE(SUM(value), 0),
    'line_count',               COUNT(*)
  )
  INTO v_summary
  FROM all_rows;

  WITH waste_rows AS (
    SELECT sm.product_id,
      ABS(sm.quantity) AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value,
      'manual_waste'::text AS type
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at >= v_start AND sm.created_at < v_end
  ),
  spoilage_rows AS (
    SELECT sl.product_id,
      sl.quantity AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value,
      'spoilage'::text AS type
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at >= v_start AND sl.expires_at < v_end
  ),
  all_rows AS (SELECT * FROM waste_rows UNION ALL SELECT * FROM spoilage_rows)
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY (row_to_json(t)->>'total_value')::numeric DESC), '[]'::jsonb)
  INTO v_by_product
  FROM (
    SELECT
      ar.product_id,
      (SELECT p.name FROM products p WHERE p.id = ar.product_id) AS product_name,
      COALESCE(SUM(ar.qty)   FILTER (WHERE ar.type = 'manual_waste'), 0) AS manual_waste_qty,
      COALESCE(SUM(ar.value) FILTER (WHERE ar.type = 'manual_waste'), 0) AS manual_waste_value,
      COALESCE(SUM(ar.qty)   FILTER (WHERE ar.type = 'spoilage'), 0)     AS spoilage_qty,
      COALESCE(SUM(ar.value) FILTER (WHERE ar.type = 'spoilage'), 0)     AS spoilage_value,
      SUM(ar.qty)   AS total_qty,
      SUM(ar.value) AS total_value
    FROM all_rows ar
    GROUP BY ar.product_id
  ) t;

  WITH waste_lines AS (
    SELECT
      sm.id::text        AS id,
      sm.product_id,
      p.name             AS product_name,
      'manual_waste'::text AS type,
      ABS(sm.quantity)   AS qty,
      ABS(sm.quantity) * COALESCE(sm.unit_cost, p.cost_price, 0) AS value,
      sm.lot_id::text    AS lot_id,
      NULL::text         AS lot_batch_number,
      sm.reason          AS reason,
      sm.created_by      AS created_by,
      sm.created_at      AS created_at
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.movement_type = 'waste'
      AND sm.created_at >= v_start AND sm.created_at < v_end
  ),
  spoilage_lines AS (
    SELECT
      sl.id::text        AS id,
      sl.product_id,
      p.name             AS product_name,
      'spoilage'::text   AS type,
      sl.quantity        AS qty,
      sl.quantity * COALESCE(p.cost_price, 0) AS value,
      sl.id::text        AS lot_id,
      sl.batch_number    AS lot_batch_number,
      'expired'::text    AS reason,
      NULL::uuid         AS created_by,
      sl.expires_at      AS created_at
    FROM stock_lots sl
    JOIN products p ON p.id = sl.product_id
    WHERE sl.status = 'expired'
      AND sl.expires_at >= v_start AND sl.expires_at < v_end
  ),
  all_lines AS (SELECT * FROM waste_lines UNION ALL SELECT * FROM spoilage_lines)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',               al.id,
    'product_id',       al.product_id,
    'product_name',     al.product_name,
    'type',             al.type,
    'qty',              al.qty,
    'value',            al.value,
    'lot_id',           al.lot_id,
    'lot_batch_number', al.lot_batch_number,
    'reason',           al.reason,
    'created_by_name',  up.full_name,
    'created_at',       al.created_at
  ) ORDER BY al.created_at DESC), '[]'::jsonb)
  INTO v_lines
  FROM (SELECT * FROM all_lines ORDER BY created_at DESC LIMIT v_line_cap) al
  LEFT JOIN user_profiles up ON up.id = al.created_by;

  RETURN jsonb_build_object(
    'period',     jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'summary',    v_summary,
    'by_product', v_by_product,
    'lines',      v_lines,
    'truncated',  COALESCE((v_summary->>'line_count')::int, 0) > v_line_cap
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_wastage_report_v4(p_date_start text, p_date_end text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_wastage_report_v4(p_date_start text, p_date_end text) TO authenticated,service_role;
DROP FUNCTION public.get_wastage_report_v3(p_date_start text, p_date_end text);

CREATE OR REPLACE FUNCTION public.get_sales_by_customer_v3(p_start_date date, p_end_date date, p_customer_type text DEFAULT NULL::text, p_churn_min_orders integer DEFAULT 2)
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
  IF p_customer_type IS NOT NULL AND p_customer_type NOT IN ('retail', 'b2b') THEN
    RAISE EXCEPTION 'invalid_customer_type' USING ERRCODE = 'P0001';
  END IF;
  IF p_churn_min_orders IS NULL OR p_churn_min_orders < 1 THEN
    RAISE EXCEPTION 'invalid_churn_min_orders' USING ERRCODE = 'P0001';
  END IF;

  v_end        := p_end_date;
  v_start      := GREATEST(p_start_date, p_end_date - 366);
  v_prev_end   := v_start - 1;
  v_prev_start := v_prev_end - (v_end - v_start);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id, o.total, o.customer_id,
      ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_prev_start AND v_end
  ),
  ident AS (
    SELECT s.*, c.name, c.customer_type::text AS customer_type, c.loyalty_points
    FROM scoped s
    JOIN customers c ON c.id = s.customer_id
    WHERE (p_customer_type IS NULL OR c.customer_type::text = p_customer_type)
  ),
  ident_cur  AS (SELECT * FROM ident WHERE bd BETWEEN v_start AND v_end),
  ident_prev AS (SELECT * FROM ident WHERE bd < v_start),
  anon AS (
    SELECT * FROM scoped WHERE customer_id IS NULL
  ),
  per_customer_prev AS (
    SELECT customer_id, name, customer_type,
           COUNT(*) AS order_count, SUM(total) AS revenue, MAX(bd) AS last_order_date
    FROM ident_prev
    GROUP BY customer_id, name, customer_type
  ),
  per_customer AS (
    SELECT
      ic.customer_id,
      ic.name,
      ic.customer_type,
      ic.loyalty_points,
      COUNT(*)     AS order_count,
      SUM(ic.total) AS revenue,
      MAX(ic.bd)    AS last_order_date,
      NOT EXISTS (
        SELECT 1 FROM reporting_private.recognized_sales_v2 o2
        WHERE o2.customer_id = ic.customer_id
          AND TRUE
          AND o2.voided_at IS NULL
          AND o2.is_historical_import = false
          AND ((COALESCE(o2.recognized_at, o2.created_at) AT TIME ZONE v_tz))::date < v_start
      ) AS is_new
    FROM ident_cur ic
    GROUP BY ic.customer_id, ic.name, ic.customer_type, ic.loyalty_points
  ),
  churned AS (
    SELECT pp.*
    FROM per_customer_prev pp
    WHERE pp.order_count >= p_churn_min_orders
      AND NOT EXISTS (SELECT 1 FROM ident_cur ic WHERE ic.customer_id = pp.customer_id)
  ),
  by_day AS (
    SELECT bd,
           COALESCE(SUM(total) FILTER (WHERE customer_id IS NOT NULL
             AND (p_customer_type IS NULL OR EXISTS (
               SELECT 1 FROM customers c WHERE c.id = customer_id
                 AND c.customer_type::text = p_customer_type))), 0) AS identified,
           COALESCE(SUM(total) FILTER (WHERE customer_id IS NULL), 0) AS anonymous
    FROM scoped
    WHERE bd BETWEEN v_start AND v_end
    GROUP BY bd
  ),
  tot AS (
    SELECT
      COALESCE((SELECT SUM(revenue) FROM per_customer), 0)                     AS identified_revenue,
      COALESCE((SELECT SUM(order_count) FROM per_customer), 0)                 AS identified_orders,
      COALESCE((SELECT COUNT(*) FROM per_customer), 0)                         AS customer_count,
      COALESCE((SELECT COUNT(*) FROM per_customer WHERE is_new), 0)            AS new_customer_count,
      COALESCE((SELECT SUM(revenue) FROM per_customer_prev), 0)                AS identified_revenue_prev,
      COALESCE((SELECT SUM(total) FROM anon WHERE bd BETWEEN v_start AND v_end), 0)           AS anonymous_revenue,
      COALESCE((SELECT COUNT(*)   FROM anon WHERE bd BETWEEN v_start AND v_end), 0)           AS anonymous_orders,
      COALESCE((SELECT SUM(total) FROM anon WHERE bd BETWEEN v_prev_start AND v_prev_end), 0) AS anonymous_revenue_prev
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'identified_revenue',      t.identified_revenue,
      'identified_revenue_prev', t.identified_revenue_prev,
      'identified_orders',       t.identified_orders,
      'anonymous_revenue',       t.anonymous_revenue,
      'anonymous_revenue_prev',  t.anonymous_revenue_prev,
      'anonymous_orders',        t.anonymous_orders,
      'customer_count',          t.customer_count,
      'new_customer_count',      t.new_customer_count
    ),
    'by_customer', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'customer_id',      pc.customer_id,
          'name',             pc.name,
          'customer_type',    pc.customer_type,
          'loyalty_points',   pc.loyalty_points,
          'order_count',      pc.order_count,
          'revenue',          pc.revenue,
          'last_order_date',  pc.last_order_date,
          'is_new',           pc.is_new,
          'revenue_prev',     pp.revenue,
          'order_count_prev', pp.order_count
        ) ORDER BY pc.revenue DESC, pc.name ASC
      )
      FROM per_customer pc
      LEFT JOIN per_customer_prev pp ON pp.customer_id = pc.customer_id
    ), '[]'::jsonb),
    'churned', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'customer_id',      ch.customer_id,
          'name',             ch.name,
          'customer_type',    ch.customer_type,
          'order_count_prev', ch.order_count,
          'revenue_prev',     ch.revenue,
          'last_order_date',  ch.last_order_date
        ) ORDER BY ch.revenue DESC, ch.name ASC
      ) FROM churned ch
    ), '[]'::jsonb),
    'by_day', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'date',       d.bd,
          'identified', d.identified,
          'anonymous',  d.anonymous
        ) ORDER BY d.bd ASC
      ) FROM by_day d
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_customer_v3(p_start_date date, p_end_date date, p_customer_type text, p_churn_min_orders integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_customer_v3(p_start_date date, p_end_date date, p_customer_type text, p_churn_min_orders integer) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_customer_v1(p_start_date date, p_end_date date, p_customer_type text, p_churn_min_orders integer);
DROP FUNCTION public.get_sales_by_customer_v2(p_start_date date, p_end_date date, p_customer_type text, p_churn_min_orders integer);

CREATE OR REPLACE FUNCTION public.get_off_hours_sales_v2(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_tz        TEXT;
  v_hours     JSONB;
  v_start     TIMESTAMPTZ;
  v_end       TIMESTAMPTZ;
  v_rows      JSONB;
  v_summary   JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.audit.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.audit.read' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  SELECT business_hours INTO v_hours
    FROM business_config WHERE id = 1;
  v_hours := COALESCE(v_hours, '{}'::jsonb);

  -- Bornes calendaires locales → plage d'instants absolus (index paid_at).
  v_start := (p_date_start || ' 00:00:00')::timestamp AT TIME ZONE v_tz;
  v_end   := ((p_date_end::date + 1) || ' 00:00:00')::timestamp AT TIME ZONE v_tz;

  WITH sale_payments AS (
    SELECT op.order_id, op.method, op.amount, op.paid_at,
           (op.paid_at AT TIME ZONE v_tz) AS local_ts
    FROM reporting_private.closed_order_payments_v1 op
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = op.order_id
    WHERE op.paid_at >= v_start AND op.paid_at < v_end
      AND o.status NOT IN ('voided')
  ),
  keyed AS (
    SELECT sp.*,
           (ARRAY['mon','tue','wed','thu','fri','sat','sun'])
             [EXTRACT(ISODOW FROM sp.local_ts)::int] AS day_key,
           to_char(sp.local_ts, 'HH24:MI') AS local_hhmm
    FROM sale_payments sp
  ),
  off_hours AS (
    SELECT k.*, v_hours -> k.day_key AS day_cfg
    FROM keyed k
    WHERE v_hours ? k.day_key
      AND (
        jsonb_typeof(v_hours -> k.day_key) = 'null'
        OR k.local_hhmm <  (v_hours -> k.day_key ->> 'open')
        OR k.local_hhmm >= (v_hours -> k.day_key ->> 'close')
      )
  )
  SELECT
    jsonb_build_object(
      'payment_count', COUNT(*),
      'order_count',   COUNT(DISTINCT oh.order_id),
      'total_amount',  COALESCE(SUM(oh.amount), 0)
    ),
    COALESCE(jsonb_agg(jsonb_build_object(
      'order_id',     oh.order_id,
      'order_number', o.order_number,
      'method',       oh.method,
      'amount',       oh.amount,
      'paid_at',      oh.paid_at,
      'local_time',   to_char(oh.local_ts, 'YYYY-MM-DD HH24:MI'),
      'day_key',      oh.day_key,
      'window_open',  oh.day_cfg ->> 'open',
      'window_close', oh.day_cfg ->> 'close',
      'cashier',      up.full_name
    ) ORDER BY oh.paid_at), '[]'::jsonb)
  INTO v_summary, v_rows
  FROM off_hours oh
  JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oh.order_id
  LEFT JOIN user_profiles up ON up.id = o.served_by;

  RETURN jsonb_build_object('summary', v_summary, 'rows', v_rows);
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_off_hours_sales_v2(p_date_start text, p_date_end text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_off_hours_sales_v2(p_date_start text, p_date_end text) TO authenticated,service_role;
DROP FUNCTION public.get_off_hours_sales_v1(p_date_start text, p_date_end text);
