-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_sales_by_product_v3(p_start_date date, p_end_date date, p_category_id uuid DEFAULT NULL::uuid)
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
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
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
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
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
    FROM order_items oi
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
REVOKE ALL ON FUNCTION public.get_sales_by_product_v3(p_start_date date, p_end_date date, p_category_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_product_v3(p_start_date date, p_end_date date, p_category_id uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
