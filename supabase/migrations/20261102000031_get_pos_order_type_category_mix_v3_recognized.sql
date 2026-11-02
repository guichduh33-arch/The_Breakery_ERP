-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_pos_order_type_category_mix_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz           TEXT;
  v_total_rev    NUMERIC;
  v_total_orders INTEGER;
  v_by_type      JSONB;
  v_by_category  JSONB;
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

  WITH scoped AS (
    SELECT o.order_type::text AS ot, o.total
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  tot AS (SELECT COALESCE(SUM(total), 0) AS rev, COUNT(*) AS n FROM scoped)
  SELECT
    (SELECT rev FROM tot),
    (SELECT n   FROM tot),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'order_type',  g.ot,
        'revenue',     g.rev,
        'order_count', g.n,
        'avg_basket',  COALESCE(ROUND(g.rev / NULLIF(g.n, 0), 2), 0),
        'share_pct',   COALESCE(ROUND(100 * g.rev / NULLIF((SELECT rev FROM tot), 0), 2), 0)
      ) ORDER BY g.rev DESC
    ), '[]'::jsonb)
  INTO v_total_rev, v_total_orders, v_by_type
  FROM (SELECT ot, SUM(total) AS rev, COUNT(*) AS n FROM scoped GROUP BY ot) g;

  WITH scoped AS (
    SELECT o.id
    FROM reporting_private.recognized_sales_v1 o
    WHERE TRUE
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  lines AS (
    SELECT c.id AS cid, c.name AS cname, oi.line_total, oi.quantity
    FROM order_items oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled = false
      AND oi.is_promo_gift = false
  ),
  cat_tot AS (SELECT COALESCE(SUM(line_total), 0) AS rev FROM lines)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'category_id',   g.cid,
      'category_name', COALESCE(g.cname, '(uncategorized)'),
      'revenue',       g.rev,
      'qty',           g.qty,
      'share_pct',     COALESCE(ROUND(100 * g.rev / NULLIF((SELECT rev FROM cat_tot), 0), 2), 0)
    ) ORDER BY g.rev DESC
  ), '[]'::jsonb)
  INTO v_by_category
  FROM (
    SELECT cid, cname, SUM(line_total) AS rev, SUM(quantity) AS qty
    FROM lines GROUP BY cid, cname
  ) g;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'start_date',    p_start_date,
    'end_date',      p_end_date,
    'timezone',      v_tz,
    'totals',        jsonb_build_object('revenue', v_total_rev, 'orders', v_total_orders),
    'by_order_type', v_by_type,
    'by_category',   v_by_category
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_order_type_category_mix_v3(p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_type_category_mix_v3(p_start_date date, p_end_date date) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
