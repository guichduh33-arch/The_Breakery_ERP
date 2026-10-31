INSERT INTO public.permissions(code,module,action,description)
VALUES('reports.product_sales.read','reports','product_sales.read','Read product sales after owner releases the business day')
ON CONFLICT(code) DO NOTHING;
INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
SELECT r.code,'reports.product_sales.read',true FROM public.roles r
WHERE r.code IN ('SUPER_ADMIN','ADMIN','CASHIER')
ON CONFLICT(role_code,permission_code) DO NOTHING;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_basket_analysis_v4(p_date_start date, p_date_end date, p_top_n integer DEFAULT 10)
 RETURNS TABLE(product_id_a uuid, product_a_name text, product_id_b uuid, product_b_name text, co_occurrence_count integer, support_a numeric, support_b numeric, support_pair numeric, confidence numeric, lift numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_date_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_date_end::text,''),current_date::text)::date);


  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  ),
  filtered_orders AS (
    SELECT o.id
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.paid_at IS NOT NULL
      AND o.voided_at IS NULL
      AND ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg))::date
            BETWEEN p_date_start AND p_date_end)
  ),
  total_orders AS (
    SELECT GREATEST(COUNT(*), 1)::DECIMAL AS n FROM filtered_orders
  ),
  order_products AS (
    SELECT DISTINCT
      oi.order_id,
      oi.product_id
    FROM order_items oi
    JOIN filtered_orders fo ON fo.id = oi.order_id
    WHERE oi.product_id IS NOT NULL
      AND oi.is_cancelled IS NOT TRUE
      AND oi.is_promo_gift IS NOT TRUE
  ),
  product_support AS (
    SELECT
      op.product_id,
      COUNT(DISTINCT op.order_id)::INT AS order_count
    FROM order_products op
    GROUP BY op.product_id
  ),
  pairs AS (
    SELECT
      a.product_id AS product_id_a,
      b.product_id AS product_id_b,
      COUNT(DISTINCT a.order_id)::INT AS co_count
    FROM order_products a
    JOIN order_products b
      ON a.order_id = b.order_id
     AND a.product_id < b.product_id
    GROUP BY a.product_id, b.product_id
  )
  SELECT
    p.product_id_a,
    pa.name AS product_a_name,
    p.product_id_b,
    pb.name AS product_b_name,
    p.co_count AS co_occurrence_count,
    (sa.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_a,
    (sb.order_count / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_b,
    (p.co_count    / (SELECT n FROM total_orders))::DECIMAL(8,6) AS support_pair,
    CASE
      WHEN sa.order_count = 0 THEN 0::DECIMAL(8,6)
      ELSE (p.co_count::DECIMAL / sa.order_count)::DECIMAL(8,6)
    END AS confidence,
    CASE
      WHEN sa.order_count = 0 OR sb.order_count = 0 THEN 0::DECIMAL(10,4)
      ELSE (
        (p.co_count::DECIMAL * (SELECT n FROM total_orders))
        / NULLIF(sa.order_count::DECIMAL * sb.order_count, 0)
      )::DECIMAL(10,4)
    END AS lift
  FROM pairs p
  JOIN product_support sa ON sa.product_id = p.product_id_a
  JOIN product_support sb ON sb.product_id = p.product_id_b
  JOIN products pa
    ON pa.id = p.product_id_a
   AND pa.deleted_at IS NULL
  JOIN products pb
    ON pb.id = p.product_id_b
   AND pb.deleted_at IS NULL
  ORDER BY lift DESC NULLS LAST, co_occurrence_count DESC
  LIMIT GREATEST(p_top_n, 1);
END;
$function$
;
DROP FUNCTION public.get_basket_analysis_v3(p_date_start date, p_date_end date, p_top_n integer);
REVOKE ALL ON FUNCTION public.get_basket_analysis_v4(p_date_start date, p_date_end date, p_top_n integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_basket_analysis_v4(p_date_start date, p_date_end date, p_top_n integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_combo_sales_v2(p_start_date date, p_end_date date)
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
  PERFORM public.assert_business_days_visible_v1(v_prev_start,v_end);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT o.id, o.total,
           ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
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
          BETWEEN v_prev_start AND v_end
  ),
  combo_lines AS (
    SELECT oi.id, oi.order_id, oi.product_id, oi.name_snapshot, oi.quantity,
           oi.line_total, oi.combo_components, oi.created_at, s.bd
    FROM order_items oi
    JOIN scoped s ON s.id = oi.order_id
    WHERE oi.combo_components IS NOT NULL
      AND oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  cur_orders  AS (SELECT * FROM scoped      WHERE bd BETWEEN v_start AND v_end),
  cur_lines   AS (SELECT * FROM combo_lines WHERE bd BETWEEN v_start AND v_end),
  prev_lines  AS (SELECT * FROM combo_lines WHERE bd <  v_start),
  with_combo  AS (SELECT DISTINCT order_id FROM cur_lines),
  tickets AS (
    SELECT
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NOT NULL), 0) AS avg_with,
      ROUND(AVG(o.total) FILTER (WHERE w.order_id IS NULL), 0)     AS avg_without
    FROM cur_orders o
    LEFT JOIN with_combo w ON w.order_id = o.id
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'combo_revenue',      COALESCE((SELECT SUM(line_total) FROM cur_lines), 0),
      'combo_revenue_prev', COALESCE((SELECT SUM(line_total) FROM prev_lines), 0),
      'combo_qty',          COALESCE((SELECT SUM(quantity) FROM cur_lines), 0),
      'combo_qty_prev',     COALESCE((SELECT SUM(quantity) FROM prev_lines), 0),
      'combo_orders',       (SELECT COUNT(*) FROM with_combo),
      'gross_sales',        COALESCE((SELECT SUM(total) FROM cur_orders), 0),
      'avg_ticket_with',    (SELECT avg_with FROM tickets),
      'avg_ticket_without', (SELECT avg_without FROM tickets)
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', d.bd, 'revenue', d.revenue, 'qty', d.qty
      ) ORDER BY d.bd ASC)
      FROM (
        SELECT bd, SUM(line_total) AS revenue, SUM(quantity) AS qty
        FROM cur_lines GROUP BY bd
      ) d
    ), '[]'::jsonb),
    'by_combo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', bc.product_id,
        'name',       bc.name,
        'qty',        bc.qty,
        'revenue',    bc.revenue,
        'avg_price',  bc.avg_price
      ) ORDER BY bc.revenue DESC)
      FROM (
        SELECT product_id,
               (ARRAY_AGG(name_snapshot ORDER BY created_at DESC))[1] AS name,
               SUM(quantity)   AS qty,
               SUM(line_total) AS revenue,
               ROUND(SUM(line_total) / NULLIF(SUM(quantity), 0), 0) AS avg_price
        FROM cur_lines
        GROUP BY product_id
      ) bc
    ), '[]'::jsonb),
    'component_picks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id', cp.product_id,
        'name',       cp.name,
        'qty',        cp.qty
      ) ORDER BY cp.qty DESC)
      FROM (
        SELECT (comp->>'product_id')::uuid AS product_id,
               COALESCE(MAX(p.name), 'deleted') AS name,
               SUM(COALESCE((comp->>'quantity')::numeric, 1) * cl.quantity) AS qty
        FROM cur_lines cl
        CROSS JOIN LATERAL jsonb_array_elements(cl.combo_components) comp
        LEFT JOIN products p ON p.id = (comp->>'product_id')::uuid
        GROUP BY (comp->>'product_id')::uuid
      ) cp
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
DROP FUNCTION public.get_combo_sales_v1(p_start_date date, p_end_date date);
REVOKE ALL ON FUNCTION public.get_combo_sales_v2(p_start_date date, p_end_date date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_combo_sales_v2(p_start_date date, p_end_date date) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_display_stock_activity_v2()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_empty INT;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'display.read') THEN
    RAISE EXCEPTION 'permission denied: display.read required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1((now()-interval '7 days')::date,current_date);


  WITH last_sale AS (
    SELECT oi.product_id, MAX(o.paid_at) AS last_sold_at
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN ('paid', 'completed')
       AND o.voided_at IS NULL
       AND o.paid_at IS NOT NULL
       AND NOT oi.is_cancelled
       AND o.paid_at > now() - interval '7 days'
     GROUP BY oi.product_id
  ),
  shelf AS (
    SELECT p.id, p.name, p.sku, p.unit, ds.quantity, p.min_stock_threshold,
           ls.last_sold_at
      FROM display_stock ds
      JOIN products p ON p.id = ds.product_id
      LEFT JOIN last_sale ls ON ls.product_id = ds.product_id
     WHERE p.deleted_at IS NULL
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'product_id',    s.id,
           'product_name',  s.name,
           'sku',           s.sku,
           'unit',          s.unit,
           'quantity',      s.quantity,
           'min_threshold', s.min_stock_threshold,
           'last_sold_at',  s.last_sold_at,
           'minutes_since_sale',
             CASE WHEN s.last_sold_at IS NULL THEN NULL
                  ELSE ROUND(EXTRACT(EPOCH FROM (now() - s.last_sold_at)) / 60) END
         ) ORDER BY s.last_sold_at DESC NULLS LAST), '[]'::jsonb),
         COUNT(*) FILTER (WHERE s.quantity <= 0)::INT
    INTO v_rows, v_empty
    FROM shelf s;

  RETURN jsonb_build_object(
    'rows',         v_rows,
    'empty_count',  v_empty,
    'generated_at', now()
  );
END;
$function$
;
DROP FUNCTION public.get_display_stock_activity_v1();
REVOKE ALL ON FUNCTION public.get_display_stock_activity_v2() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_display_stock_activity_v2() TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_gross_margin_by_product_v2(p_start_date text, p_end_date text, p_category_id uuid DEFAULT NULL::uuid)
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
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start_date::text,''),current_date::text)::date,COALESCE(NULLIF(p_end_date::text,''),current_date::text)::date);


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
    JOIN orders o    ON o.id = oi.order_id
    JOIN products p  ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND oi.is_cancelled = false
      AND o.paid_at IS NOT NULL
      AND ((o.paid_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
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
DROP FUNCTION public.get_gross_margin_by_product_v1(p_start_date text, p_end_date text, p_category_id uuid);
REVOKE ALL ON FUNCTION public.get_gross_margin_by_product_v2(p_start_date text, p_end_date text, p_category_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_gross_margin_by_product_v2(p_start_date text, p_end_date text, p_category_id uuid) TO authenticated;


