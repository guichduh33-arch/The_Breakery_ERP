-- Reports POS refonte (Lot F) — top products by revenue (server-side).
-- Line-level aggregation over the SAME order scope as the Overview (Lot A) and
-- the Mix category half (Lot E):
--   status IN (paid,completed), non-B2B, non-historical, no test-product line,
--   WITA business date (paid_at ?? created_at). Line filters mirror the Mix
--   category breakdown: exclude cancelled + promo-gift lines. This guarantees
--   sum(products.revenue) == sum(Mix.by_category.revenue) exactly (same lines,
--   grouped by product instead of category).
-- Products are returned ALL, sorted by revenue DESC (the caller slices the
-- top-N it wants) — the same "return everything, sort desc" shape as the Mix
-- category list. Gated reports.sales.read. Read-only, money-path untouched.

CREATE OR REPLACE FUNCTION public.get_pos_top_products_v1(
  p_start_date date,
  p_end_date   date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz        TEXT;
  v_total_rev NUMERIC;
  v_products  JSONB;
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
    SELECT o.id
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
  lines AS (
    SELECT oi.product_id, oi.name_snapshot, oi.line_total, oi.quantity
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.is_cancelled = false
      AND oi.is_promo_gift = false
  ),
  tot AS (SELECT COALESCE(SUM(line_total), 0) AS rev FROM lines)
  SELECT
    (SELECT rev FROM tot),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'product_id',   g.pid,
        'product_name', g.pname,
        'qty',          g.qty,
        'revenue',      g.rev,
        'share_pct',    COALESCE(ROUND(100 * g.rev / NULLIF((SELECT rev FROM tot), 0), 2), 0)
      ) ORDER BY g.rev DESC, g.pname ASC
    ), '[]'::jsonb)
  INTO v_total_rev, v_products
  FROM (
    SELECT
      product_id AS pid,
      -- Latest non-null snapshot name for the product across the scope.
      (array_agg(name_snapshot ORDER BY name_snapshot))[1] AS pname,
      SUM(line_total) AS rev,
      SUM(quantity)   AS qty
    FROM lines
    GROUP BY product_id
  ) g;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'start_date',    p_start_date,
    'end_date',      p_end_date,
    'timezone',      v_tz,
    'total_revenue', v_total_rev,
    'products',      v_products
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pos_top_products_v1(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_top_products_v1(date, date) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMENT ON FUNCTION public.get_pos_top_products_v1(date, date) IS
  'POS reports top products by revenue (line-level, excl. cancelled/promo-gift) over a WITA range; same order scope as the Overview so sum(products.revenue) reconciles with Mix by_category revenue; returns all products sorted revenue DESC; gated reports.sales.read. Read-only.';
