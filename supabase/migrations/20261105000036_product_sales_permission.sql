-- Restaurer la permission dédiée sans modifier le périmètre des journées clôturées.
-- Corps capturés sur DEV le 5 novembre 2026 via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.get_product_sales_lines_v5(p_product_id uuid, p_start_date date, p_end_date date, p_limit integer DEFAULT 100, p_cursor text DEFAULT NULL::text)
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
  IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(), 'reports.sales.read')
    OR has_permission(auth.uid(), 'reports.product_sales.read')) THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read or reports.product_sales.read required' USING ERRCODE = '42501';
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
REVOKE EXECUTE ON FUNCTION public.get_product_sales_lines_v5(uuid, date, date, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_product_sales_lines_v5(uuid, date, date, integer, text) TO authenticated, service_role;
DROP FUNCTION public.get_product_sales_lines_v4(uuid, date, date, integer, text);

CREATE OR REPLACE FUNCTION public.get_sales_by_product_v5(p_start_date date, p_end_date date, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz      text;
  v_start   date;
  v_end     date;
  v_result  jsonb;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(), 'reports.sales.read')
    OR has_permission(auth.uid(), 'reports.product_sales.read')) THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read or reports.product_sales.read required' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b')          AS is_b2b,
      COALESCE(o.discount_amount, 0)  AS order_discount,
      COALESCE(o.promotion_total, 0)  AS promotion_total
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
      oi.order_id,
      oi.product_id,
      p.name                             AS product_name,
      p.category_id                      AS category_id,
      COALESCE(c.name, 'Uncategorized')  AS category_name,
      s.is_b2b,
      oi.quantity,
      oi.line_total,
      COALESCE(oi.discount_amount, 0)    AS discount_amount
    FROM reporting_private.closed_order_items_v1 oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  tot AS (
    SELECT
      COALESCE(SUM(line_total), 0)      AS revenue,
      COALESCE(SUM(quantity), 0)        AS qty,
      COALESCE(SUM(discount_amount), 0) AS discount,
      COUNT(*)                          AS line_count,
      COUNT(DISTINCT order_id)          AS order_count,
      COUNT(DISTINCT product_id)        AS product_count,
      COALESCE(SUM(line_total) FILTER (WHERE NOT is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE NOT is_b2b), 0) AS counter_qty,
      COALESCE(SUM(line_total) FILTER (WHERE is_b2b), 0)     AS b2b_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE is_b2b), 0)     AS b2b_qty
    FROM lines
  ),
  unattributed AS (
    SELECT
      COALESCE(SUM(s.order_discount), 0)  AS order_discount,
      COALESCE(SUM(s.promotion_total), 0) AS promotion_total
    FROM scoped s
    WHERE EXISTS (SELECT 1 FROM lines l WHERE l.order_id = s.id)
  ),
  per_product AS (
    SELECT
      l.product_id,
      l.product_name                                             AS name,
      l.category_id                                              AS category_id,
      l.category_name                                            AS category_name,
      SUM(l.quantity)                                            AS qty,
      SUM(l.line_total)                                          AS revenue,
      SUM(l.discount_amount)                                     AS discount,
      COUNT(DISTINCT l.order_id)                                 AS order_count,
      COALESCE(SUM(l.quantity)   FILTER (WHERE NOT l.is_b2b), 0) AS counter_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE NOT l.is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(l.quantity)   FILTER (WHERE l.is_b2b), 0)     AS b2b_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE l.is_b2b), 0)     AS b2b_revenue
    FROM lines l
    GROUP BY l.product_id, l.product_name, l.category_id, l.category_name
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       t.revenue,
      'qty',           t.qty,
      'discount',      t.discount,
      'lines',         t.line_count,
      'orders',        t.order_count,
      'products',      t.product_count,
      'avg_price',     COALESCE(ROUND(t.revenue / NULLIF(t.qty, 0), 2), 0),
      'counter', jsonb_build_object('qty', t.counter_qty, 'revenue', t.counter_revenue),
      'b2b',     jsonb_build_object('qty', t.b2b_qty,     'revenue', t.b2b_revenue),
      'unattributed', jsonb_build_object(
        'order_discount',  u.order_discount,
        'promotion_total', u.promotion_total
      )
    ),
    'by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',    pp.product_id,
          'name',          pp.name,
          'category_id',   pp.category_id,
          'category_name', pp.category_name,
          'qty',           pp.qty,
          'revenue',       pp.revenue,
          'discount',      pp.discount,
          'order_count',   pp.order_count,
          'avg_price',     COALESCE(ROUND(pp.revenue / NULLIF(pp.qty, 0), 2), 0),
          'share_pct',     COALESCE(ROUND(100 * pp.revenue / NULLIF(t.revenue, 0), 2), 0),
          'counter',       jsonb_build_object('qty', pp.counter_qty, 'revenue', pp.counter_revenue),
          'b2b',           jsonb_build_object('qty', pp.b2b_qty,     'revenue', pp.b2b_revenue)
        ) ORDER BY pp.revenue DESC, pp.name ASC
      ) FROM per_product pp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, unattributed u;

  RETURN v_result;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.get_sales_by_product_v5(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_product_v5(date, date, uuid) TO authenticated, service_role;
DROP FUNCTION public.get_sales_by_product_v4(date, date, uuid);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
