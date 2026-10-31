-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_product_dashboard_v4(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days  INT;
  v_since TIMESTAMPTZ;
  v_summary JSONB;
  v_recent_movements JSONB;
  v_velocity_daily   JSONB;
  v_expiring_lots    JSONB;
  v_top_customers    JSONB;
  v_product_row      JSONB;
BEGIN

  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  v_days  := GREATEST(COALESCE(p_days, 30), 1);
  v_since := now() - (v_days * INTERVAL '1 day');
  PERFORM public.assert_business_days_visible_v1(v_since::date,current_date);

  SELECT jsonb_build_object(
           'id',                  p.id,
           'sku',                 p.sku,
           'name',                p.name,
           'unit',                p.unit,
           'cost_price',          p.cost_price,
           'retail_price',        p.retail_price,
           'current_stock',       p.current_stock,
           'min_stock_threshold', p.min_stock_threshold,
           'value_at_cost',       (p.current_stock * p.cost_price)
         )
    INTO v_product_row
    FROM products p
   WHERE p.id = p_product_id;

  IF v_product_row IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB)
    INTO v_recent_movements
  FROM (
    SELECT
      sm.id,
      sm.movement_type::TEXT AS movement_type,
      sm.quantity,
      sm.unit,
      sm.reason,
      sm.from_section_id,
      fs.code AS from_section_code,
      sm.to_section_id,
      ts.code AS to_section_code,
      sm.created_at
    FROM stock_movements sm
    LEFT JOIN sections fs ON fs.id = sm.from_section_id
    LEFT JOIN sections ts ON ts.id = sm.to_section_id
    WHERE sm.product_id = p_product_id
    ORDER BY sm.created_at DESC
    LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.day), '[]'::JSONB)
    INTO v_velocity_daily
  FROM (
    SELECT
      day::DATE                   AS day,
      COALESCE(SUM(units), 0)     AS units_sold
    FROM (
      SELECT generate_series(v_since::DATE, now()::DATE, '1 day'::INTERVAL) AS day
    ) cal
    LEFT JOIN LATERAL (
      SELECT ABS(sm.quantity) AS units
      FROM stock_movements sm
      WHERE sm.product_id = p_product_id
        AND sm.movement_type IN ('sale','production_out')
        AND sm.created_at::DATE = cal.day
    ) flat ON true
    GROUP BY day
  ) d;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.expires_at ASC), '[]'::JSONB)
    INTO v_expiring_lots
  FROM (
    SELECT
      sl.id,
      sl.quantity,
      sl.unit,
      sl.expires_at,
      sl.batch_number,
      sl.status,
      EXTRACT(EPOCH FROM (sl.expires_at - now())) / 3600 AS hours_until_expiry
    FROM stock_lots sl
    WHERE sl.product_id = p_product_id
      AND sl.status = 'active'
    ORDER BY sl.expires_at ASC
    LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.units_bought DESC), '[]'::JSONB)
    INTO v_top_customers
  FROM (
    SELECT
      c.id           AS customer_id,
      c.name         AS customer_name,
      SUM(oi.quantity) AS units_bought,
      SUM(oi.line_total) AS spend_total
    FROM order_items oi
    JOIN orders o     ON o.id = oi.order_id
    JOIN customers c  ON c.id = o.customer_id
    WHERE oi.product_id = p_product_id
      AND o.status IN ('paid', 'completed')
      AND o.paid_at >= v_since
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.name
    ORDER BY SUM(oi.quantity) DESC
    LIMIT 5
  ) t;

  SELECT jsonb_build_object(
           'window_days',     v_days,
           'units_sold',      COALESCE(SUM(ABS(sm.quantity)), 0),
           'avg_daily_units', (COALESCE(SUM(ABS(sm.quantity)), 0) / v_days::DECIMAL),
           'last_movement_at',MAX(sm.created_at)
         )
    INTO v_summary
    FROM stock_movements sm
   WHERE sm.product_id = p_product_id
     AND sm.created_at >= v_since
     AND sm.movement_type IN ('sale','production_out');

  RETURN jsonb_build_object(
    'product',           v_product_row,
    'summary',           COALESCE(v_summary, jsonb_build_object(
                            'window_days', v_days, 'units_sold', 0,
                            'avg_daily_units', 0, 'last_movement_at', NULL)),
    'recent_movements',  v_recent_movements,
    'sales_velocity_daily', v_velocity_daily,
    'expiring_lots',     v_expiring_lots,
    'top_customers',     v_top_customers
  );
END $function$
;
DROP FUNCTION public.get_product_dashboard_v3(p_product_id uuid, p_days integer);
REVOKE ALL ON FUNCTION public.get_product_dashboard_v4(p_product_id uuid, p_days integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_dashboard_v4(p_product_id uuid, p_days integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_product_performance_v2(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_days   integer;
  v_from   date;
  v_to     date;
  v_result jsonb;
BEGIN

  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = 'P0001';
  END IF;

  v_days := GREATEST(COALESCE(p_days, 30), 1);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  v_to   := (now() AT TIME ZONE v_tz)::date;
  v_from := v_to - (v_days - 1);
  PERFORM public.assert_business_days_visible_v1(v_from,v_to);

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b') AS is_b2b
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_from AND v_to
  ),
  lines AS (
    SELECT
      s.id AS order_id,
      s.is_b2b,
      oi.quantity,
      oi.line_total
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.product_id = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  per_channel AS (
    SELECT
      is_b2b,
      COALESCE(SUM(quantity), 0)   AS units,
      COALESCE(SUM(line_total), 0) AS revenue,
      COUNT(DISTINCT order_id)     AS orders_with
    FROM lines
    GROUP BY is_b2b
  ),
  denom AS (
    SELECT
      COUNT(*)                             AS orders_all,
      COUNT(*) FILTER (WHERE NOT is_b2b)   AS orders_counter,
      COUNT(*) FILTER (WHERE is_b2b)       AS orders_b2b
    FROM scoped
  ),
  agg AS (
    SELECT
      COALESCE((SELECT SUM(units)       FROM per_channel), 0)                    AS t_units,
      COALESCE((SELECT SUM(revenue)     FROM per_channel), 0)                    AS t_rev,
      COALESCE((SELECT SUM(orders_with) FROM per_channel), 0)                    AS t_orders,
      COALESCE((SELECT units       FROM per_channel WHERE NOT is_b2b), 0)        AS c_units,
      COALESCE((SELECT revenue     FROM per_channel WHERE NOT is_b2b), 0)        AS c_rev,
      COALESCE((SELECT orders_with FROM per_channel WHERE NOT is_b2b), 0)        AS c_orders,
      COALESCE((SELECT units       FROM per_channel WHERE is_b2b), 0)            AS b_units,
      COALESCE((SELECT revenue     FROM per_channel WHERE is_b2b), 0)            AS b_rev,
      COALESCE((SELECT orders_with FROM per_channel WHERE is_b2b), 0)            AS b_orders,
      d.orders_all, d.orders_counter, d.orders_b2b
    FROM denom d
  )
  SELECT jsonb_build_object(
    'product_id',   p_product_id,
    'window_days',  v_days,
    'from_date',    v_from,
    'to_date',      v_to,
    'timezone',     v_tz,
    'generated_at', now(),
    'total', jsonb_build_object(
      'units_sold',          a.t_units,
      'revenue',             a.t_rev,
      'orders_with_product', a.t_orders,
      'orders_total',        a.orders_all,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.t_orders / NULLIF(a.orders_all, 0), 2), 0)
    ),
    'counter', jsonb_build_object(
      'units_sold',          a.c_units,
      'revenue',             a.c_rev,
      'orders_with_product', a.c_orders,
      'orders_total',        a.orders_counter,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.c_orders / NULLIF(a.orders_counter, 0), 2), 0)
    ),
    'b2b', jsonb_build_object(
      'units_sold',          a.b_units,
      'revenue',             a.b_rev,
      'orders_with_product', a.b_orders,
      'orders_total',        a.orders_b2b,
      'conversion_pct',      COALESCE(ROUND(100.0 * a.b_orders / NULLIF(a.orders_b2b, 0), 2), 0)
    )
  )
  INTO v_result
  FROM agg a;

  RETURN v_result;
END;
$function$
;
DROP FUNCTION public.get_product_performance_v1(p_product_id uuid, p_days integer);
REVOKE ALL ON FUNCTION public.get_product_performance_v2(p_product_id uuid, p_days integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_performance_v2(p_product_id uuid, p_days integer) TO authenticated;


