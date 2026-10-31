-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_product_sales_lines_v2(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 100, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz        text;
  v_start     date;
  v_end       date;
  v_limit     integer;
  v_cur_ts    timestamptz := NULL;
  v_cur_id    uuid        := NULL;
  v_sep       integer;
  v_rows      jsonb;
  v_totals    jsonb;
  v_count     integer;
  v_next      text        := NULL;
  v_result    jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(), 'reports.sales.read') OR has_permission(auth.uid(), 'reports.product_sales.read')) THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start_date::text,''),current_date::text)::date,COALESCE(NULLIF(p_end_date::text,''),current_date::text)::date);

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);

  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_sep := position('|' IN p_cursor);
    IF v_sep < 2 THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      v_cur_ts := substring(p_cursor FROM 1 FOR v_sep - 1)::timestamptz;
      v_cur_id := substring(p_cursor FROM v_sep + 1)::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_cursor' USING ERRCODE = 'P0001';
    END;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      o.order_number,
      o.customer_id,
      o.served_by,
      (o.order_type = 'b2b')             AS is_b2b,
      COALESCE(o.paid_at, o.created_at)  AS sold_at
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.id,
      s.sold_at,
      s.id            AS order_id,
      s.order_number,
      s.customer_id,
      cu.name         AS customer_name,
      s.is_b2b,
      up.full_name    AS served_by_name,
      oi.name_snapshot,
      oi.quantity,
      oi.unit_price,
      COALESCE(oi.modifiers_total, 0)  AS modifiers_total,
      COALESCE(oi.discount_amount, 0)  AS discount_amount,
      oi.discount_reason,
      oi.line_total
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    LEFT JOIN customers     cu ON cu.id = s.customer_id
    LEFT JOIN user_profiles up ON up.id = s.served_by
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  page AS (
    SELECT *
    FROM lines
    WHERE v_cur_ts IS NULL
       OR (sold_at, id) < (v_cur_ts, v_cur_id)
    ORDER BY sold_at DESC, id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',              pg.id,
        'sold_at',         pg.sold_at,
        'order_id',        pg.order_id,
        'order_number',    pg.order_number,
        'customer_id',     pg.customer_id,
        'customer_name',   pg.customer_name,
        'channel',         CASE WHEN pg.is_b2b THEN 'b2b' ELSE 'counter' END,
        'served_by_name',  pg.served_by_name,
        'name_snapshot',   pg.name_snapshot,
        'quantity',        pg.quantity,
        'unit_price',      pg.unit_price,
        'modifiers_total', pg.modifiers_total,
        'discount_amount', pg.discount_amount,
        'discount_reason', pg.discount_reason,
        'line_total',      pg.line_total
      ) ORDER BY pg.sold_at DESC, pg.id DESC
    ), '[]'::jsonb),
    COUNT(*)::int
  INTO v_rows, v_count
  FROM page pg;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b') AS is_b2b
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT oi.order_id, oi.quantity, oi.line_total,
           COALESCE(oi.discount_amount, 0) AS discount_amount, s.is_b2b
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.product_id    = p_product_id
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  )
  SELECT jsonb_build_object(
    'lines',         COUNT(*),
    'orders',        COUNT(DISTINCT order_id),
    'qty',           COALESCE(SUM(quantity), 0),
    'revenue',       COALESCE(SUM(line_total), 0),
    'discount',      COALESCE(SUM(discount_amount), 0),
    'counter_qty',   COALESCE(SUM(quantity) FILTER (WHERE NOT is_b2b), 0),
    'b2b_qty',       COALESCE(SUM(quantity) FILTER (WHERE is_b2b), 0)
  )
  INTO v_totals
  FROM lines;

  IF v_count = v_limit THEN
    SELECT (r->>'sold_at') || '|' || (r->>'id')
      INTO v_next
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(r, ord)
     WHERE ord = v_count;
  END IF;

  v_result := jsonb_build_object(
    'product_id',   p_product_id,
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'lines',        v_rows,
    'totals',       v_totals,
    'next_cursor',  v_next,
    'has_more',     v_next IS NOT NULL
  );

  RETURN v_result;
END;
$function$
;
DROP FUNCTION public.get_product_sales_lines_v1(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text);
REVOKE ALL ON FUNCTION public.get_product_sales_lines_v2(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_product_sales_lines_v2(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_production_suggestions_v2(p_lookback_days integer DEFAULT 7, p_priority_high integer DEFAULT 3, p_priority_medium integer DEFAULT 7)
 RETURNS TABLE(product_id uuid, product_name text, product_sku text, avg_daily_sales numeric, current_stock numeric, days_of_stock numeric, suggested_quantity numeric, priority text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v1((now()-p_lookback_days*interval '1 day')::date,current_date);


  IF p_lookback_days IS NULL OR p_lookback_days < 1 THEN
    RAISE EXCEPTION 'lookback_days_must_be_positive' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    WITH sales AS (
      SELECT oi.product_id,
             SUM(oi.quantity)::NUMERIC / p_lookback_days AS avg_daily
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.created_at >= now() - (p_lookback_days * INTERVAL '1 day')
        AND COALESCE(oi.is_cancelled, false) = false
      GROUP BY oi.product_id
      HAVING SUM(oi.quantity) > 0
    ),
    eligible AS (
      SELECT DISTINCT p.id, p.name, p.sku, p.current_stock, s.avg_daily
      FROM products p
      JOIN sales s ON s.product_id = p.id
      WHERE p.product_type = 'finished'
        AND p.deleted_at IS NULL
        AND p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM recipes r
          WHERE r.product_id = p.id
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
        )
    )
    SELECT
      e.id           AS product_id,
      e.name         AS product_name,
      e.sku          AS product_sku,
      e.avg_daily    AS avg_daily_sales,
      e.current_stock,
      CASE WHEN e.avg_daily > 0 THEN e.current_stock / e.avg_daily ELSE NULL END AS days_of_stock,
      GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock)::NUMERIC AS suggested_quantity,
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 'high'
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM eligible e
    WHERE GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock) > 0
    ORDER BY
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 0
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 1
        ELSE 2
      END,
      e.avg_daily DESC;
END $function$
;
DROP FUNCTION public.get_production_suggestions_v1(p_lookback_days integer, p_priority_high integer, p_priority_medium integer);
REVOKE ALL ON FUNCTION public.get_production_suggestions_v2(p_lookback_days integer, p_priority_high integer, p_priority_medium integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_production_suggestions_v2(p_lookback_days integer, p_priority_high integer, p_priority_medium integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_reorder_suggestions_v2(p_lookback_days integer DEFAULT 30, p_buffer_days integer DEFAULT 14)
 RETURNS TABLE(product_id uuid, product_sku text, product_name text, unit text, current_stock numeric, min_stock_threshold numeric, avg_daily_usage numeric, days_of_stock numeric, suggested_order_qty numeric, supplier_id uuid, supplier_name text, last_purchase_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback INT;
  v_buffer   INT;
  v_since    TIMESTAMPTZ;
BEGIN

  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_lookback := GREATEST(COALESCE(p_lookback_days, 30), 1);
  v_buffer   := GREATEST(COALESCE(p_buffer_days, 14), 1);
  v_since    := now() - (v_lookback * INTERVAL '1 day');
  PERFORM public.assert_business_days_visible_v1(v_since::date,current_date);

  RETURN QUERY
  WITH usage AS (
    SELECT
      sm.product_id,
      SUM(ABS(sm.quantity)) / v_lookback::DECIMAL AS avg_daily
    FROM stock_movements sm
    WHERE sm.created_at >= v_since
      AND sm.movement_type IN ('sale','production_out','waste','transfer_out')
    GROUP BY sm.product_id
  ), latest_supplier AS (
    SELECT DISTINCT ON (sm.product_id)
      sm.product_id, sm.supplier_id, sm.created_at
    FROM stock_movements sm
    WHERE sm.supplier_id IS NOT NULL
      AND sm.movement_type IN ('purchase','incoming')
    ORDER BY sm.product_id, sm.created_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.unit,
    p.current_stock,
    p.min_stock_threshold,
    COALESCE(u.avg_daily, 0)::DECIMAL(10,3),
    CASE
      WHEN COALESCE(u.avg_daily, 0) = 0 THEN NULL
      ELSE (p.current_stock / u.avg_daily)::DECIMAL(10,3)
    END,
    GREATEST(0, COALESCE(u.avg_daily, 0) * v_buffer - p.current_stock)::DECIMAL(10,3),
    ls.supplier_id,
    sup.name,
    ls.created_at
  FROM products p
  LEFT JOIN usage u ON u.product_id = p.id
  LEFT JOIN latest_supplier ls ON ls.product_id = p.id
  LEFT JOIN suppliers sup ON sup.id = ls.supplier_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND (
      (COALESCE(u.avg_daily, 0) > 0 AND (p.current_stock / u.avg_daily) < v_buffer)
      OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold)
    )
  ORDER BY
    CASE WHEN COALESCE(u.avg_daily, 0) > 0
         THEN (p.current_stock / u.avg_daily)
         ELSE 0 END ASC,
    p.name;
END $function$
;
DROP FUNCTION public.get_reorder_suggestions_v1(p_lookback_days integer, p_buffer_days integer);
REVOKE ALL ON FUNCTION public.get_reorder_suggestions_v2(p_lookback_days integer, p_buffer_days integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_reorder_suggestions_v2(p_lookback_days integer, p_buffer_days integer) TO authenticated;


