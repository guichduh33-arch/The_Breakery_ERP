-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_product_sales_lines_v4(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 100, p_cursor text DEFAULT NULL::text)
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
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
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
      COALESCE(o.recognized_at, o.created_at)  AS sold_at
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
    FROM reporting_private.closed_order_items_v1 oi
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
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT oi.order_id, oi.quantity, oi.line_total,
           COALESCE(oi.discount_amount, 0) AS discount_amount, s.is_b2b
    FROM reporting_private.closed_order_items_v1 oi
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
REVOKE ALL ON FUNCTION public.get_product_sales_lines_v4(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_sales_lines_v4(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text) TO authenticated,service_role;
DROP FUNCTION public.get_product_sales_lines_v2(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text);
DROP FUNCTION public.get_product_sales_lines_v3(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer, p_cursor text);

CREATE OR REPLACE FUNCTION public.get_production_suggestions_v3(p_lookback_days integer DEFAULT 7, p_priority_high integer DEFAULT 3, p_priority_medium integer DEFAULT 7)
 RETURNS TABLE(product_id uuid, product_name text, product_sku text, avg_daily_sales numeric, current_stock numeric, days_of_stock numeric, suggested_quantity numeric, priority text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  PERFORM public.assert_stock_owner_v1();
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2((now()-p_lookback_days*interval '1 day')::date,current_date);


  IF p_lookback_days IS NULL OR p_lookback_days < 1 THEN
    RAISE EXCEPTION 'lookback_days_must_be_positive' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    WITH sales AS (
      SELECT oi.product_id,
             SUM(oi.quantity)::NUMERIC / p_lookback_days AS avg_daily
      FROM reporting_private.closed_order_items_v1 oi
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oi.order_id
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
REVOKE ALL ON FUNCTION public.get_production_suggestions_v3(p_lookback_days integer, p_priority_high integer, p_priority_medium integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_production_suggestions_v3(p_lookback_days integer, p_priority_high integer, p_priority_medium integer) TO authenticated,service_role;
DROP FUNCTION public.get_production_suggestions_v2(p_lookback_days integer, p_priority_high integer, p_priority_medium integer);

CREATE OR REPLACE FUNCTION public.get_pos_voids_refunds_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_result JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
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

  WITH
  rev AS (
    SELECT r.id, r.is_full_void, r.total, r.tax_refunded, r.reason,
           r.refunded_by, r.authorized_by,
           (o.sent_to_kitchen_at IS NOT NULL) AS after_kitchen
    FROM reporting_private.closed_refunds_v1 r
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = r.order_id
    WHERE o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((r.created_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  cancels AS (
    SELECT oi.id, oi.cancelled_reason AS reason, oi.cancelled_by,
           (oi.sent_to_kitchen_at IS NOT NULL) AS after_kitchen
    FROM reporting_private.closed_order_items_v1 oi
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oi.order_id
    WHERE oi.is_cancelled = true
      AND oi.cancelled_at IS NOT NULL
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi2 JOIN products p ON p.id = oi2.product_id
        WHERE oi2.order_id = o.id AND p.is_test = true
      )
      AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN p_start_date AND p_end_date
  ),
  disc AS (
    SELECT o.id, o.discount_type, o.discount_value, o.discount_amount,
           o.discount_authorized_by,
           (o.discount_type = 'percentage' AND o.discount_value >= 100) AS is_comp
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND COALESCE(o.discount_amount, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'reversals', jsonb_build_object(
      'voids', (
        SELECT jsonb_build_object(
          'count',                COUNT(*),
          'amount',               COALESCE(SUM(total), 0),
          'tax_refunded',         COALESCE(SUM(tax_refunded), 0),
          'after_kitchen_count',  COUNT(*) FILTER (WHERE after_kitchen),
          'before_kitchen_count', COUNT(*) FILTER (WHERE NOT after_kitchen)
        ) FROM rev WHERE is_full_void
      ),
      'refunds', (
        SELECT jsonb_build_object(
          'count',        COUNT(*),
          'amount',       COALESCE(SUM(total), 0),
          'tax_refunded', COALESCE(SUM(tax_refunded), 0)
        ) FROM rev WHERE NOT is_full_void
      ),
      'item_cancellations', (
        SELECT jsonb_build_object(
          'count',                COUNT(*),
          'after_kitchen_count',  COUNT(*) FILTER (WHERE after_kitchen),
          'before_kitchen_count', COUNT(*) FILTER (WHERE NOT after_kitchen)
        ) FROM cancels
      ),
      'by_reason', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC, x.reason) FROM (
          SELECT COALESCE(NULLIF(TRIM(reason), ''), '(no reason)') AS reason,
                 COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount
          FROM rev GROUP BY 1
        ) x
      ), '[]'::jsonb),
      'by_operator', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT rev.refunded_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(rev.total), 0) AS amount
          FROM rev LEFT JOIN user_profiles up ON up.id = rev.refunded_by
          GROUP BY rev.refunded_by, up.full_name
        ) x
      ), '[]'::jsonb),
      'by_authorizer', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT rev.authorized_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(rev.total), 0) AS amount
          FROM rev LEFT JOIN user_profiles up ON up.id = rev.authorized_by
          GROUP BY rev.authorized_by, up.full_name
        ) x
      ), '[]'::jsonb)
    ),
    'discounts', jsonb_build_object(
      'total_amount', (SELECT COALESCE(SUM(discount_amount), 0) FROM disc),
      'order_count',  (SELECT COUNT(*) FROM disc),
      'comp_count',   (SELECT COUNT(*) FILTER (WHERE is_comp) FROM disc),
      'by_type', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT discount_type AS type, COUNT(*) AS count,
                 COALESCE(SUM(discount_amount), 0) AS amount
          FROM disc GROUP BY discount_type
        ) x
      ), '[]'::jsonb),
      'by_operator', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.amount DESC) FROM (
          SELECT disc.discount_authorized_by AS operator_id, up.full_name AS operator_name,
                 COUNT(*) AS count, COALESCE(SUM(disc.discount_amount), 0) AS amount
          FROM disc LEFT JOIN user_profiles up ON up.id = disc.discount_authorized_by
          GROUP BY disc.discount_authorized_by, up.full_name
        ) x
      ), '[]'::jsonb)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_voids_refunds_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_voids_refunds_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_voids_refunds_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_voids_refunds_v2(p_start_date date, p_end_date date);
