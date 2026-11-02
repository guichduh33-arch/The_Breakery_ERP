-- Corps production relevé par pg_get_functiondef ; version précédente conservée pour la transition.
CREATE OR REPLACE FUNCTION public.get_gross_margin_by_product_v3(p_start_date text, p_end_date text, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_summary  JSONB;
  v_by_prod  JSONB;
  v_by_cat   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_start_date::DATE;
  v_end   := p_end_date::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30/S40 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH valid_lines AS (
    SELECT
      oi.product_id,
      p.name                              AS product_name,
      COALESCE(p.category_id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
      COALESCE(c.name, 'Uncategorized')   AS category_name,
      oi.quantity                         AS qty,
      oi.line_total                       AS revenue,
      (oi.quantity * p.cost_price)::NUMERIC(14,2) AS cogs
    FROM order_items oi
    JOIN reporting_private.recognized_sales_v1 o    ON o.id = oi.order_id
    JOIN products p  ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE TRUE
      AND o.voided_at IS NULL
      AND oi.is_cancelled = false
      AND o.recognized_at IS NOT NULL
      AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  by_product AS (
    SELECT
      product_id,
      MAX(product_name)   AS name,
      MAX(category_name)  AS category_name,
      SUM(qty)            AS qty,
      SUM(revenue)::NUMERIC(14,2) AS revenue,
      SUM(cogs)::NUMERIC(14,2)    AS cogs
    FROM valid_lines
    GROUP BY product_id
  ),
  by_category AS (
    SELECT
      category_id,
      MAX(category_name)  AS category_name,
      SUM(qty)            AS qty,
      SUM(revenue)::NUMERIC(14,2) AS revenue,
      SUM(cogs)::NUMERIC(14,2)    AS cogs
    FROM valid_lines
    GROUP BY category_id
  )
  SELECT
    jsonb_build_object(
      'revenue',    COALESCE((SELECT SUM(revenue) FROM valid_lines), 0),
      'cogs',       COALESCE((SELECT SUM(cogs)    FROM valid_lines), 0),
      'margin',     COALESCE((SELECT SUM(revenue) - SUM(cogs) FROM valid_lines), 0),
      'margin_pct', CASE WHEN COALESCE((SELECT SUM(revenue) FROM valid_lines), 0) = 0 THEN 0
                         ELSE ROUND(
                           ((SELECT SUM(revenue) - SUM(cogs) FROM valid_lines)
                             / (SELECT SUM(revenue) FROM valid_lines)) * 100, 2)
                    END
    ),
    (SELECT COALESCE(jsonb_agg(
       jsonb_build_object(
         'product_id',  bp.product_id,
         'name',        bp.name,
         'category_name', bp.category_name,
         'qty',         bp.qty,
         'revenue',     bp.revenue,
         'cogs',        bp.cogs,
         'margin',      bp.revenue - bp.cogs,
         'margin_pct',  CASE WHEN bp.revenue = 0 THEN 0
                              ELSE ROUND(((bp.revenue - bp.cogs) / bp.revenue) * 100, 2)
                         END
       ) ORDER BY (bp.revenue - bp.cogs) DESC
     ), '[]'::jsonb)
     FROM by_product bp),
    (SELECT COALESCE(jsonb_agg(
       jsonb_build_object(
         'category_id',   bc.category_id,
         'category_name', bc.category_name,
         'qty',           bc.qty,
         'revenue',       bc.revenue,
         'cogs',          bc.cogs,
         'margin',        bc.revenue - bc.cogs,
         'margin_pct',    CASE WHEN bc.revenue = 0 THEN 0
                                ELSE ROUND(((bc.revenue - bc.cogs) / bc.revenue) * 100, 2)
                           END
       ) ORDER BY (bc.revenue - bc.cogs) DESC
     ), '[]'::jsonb)
     FROM by_category bc)
  INTO v_summary, v_by_prod, v_by_cat;

  RETURN jsonb_build_object(
    'period',      jsonb_build_object('start', v_start, 'end', v_end),
    'summary',     v_summary,
    'by_product',  v_by_prod,
    'by_category', v_by_cat
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_gross_margin_by_product_v3(p_start_date text, p_end_date text, p_category_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gross_margin_by_product_v3(p_start_date text, p_end_date text, p_category_id uuid) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
