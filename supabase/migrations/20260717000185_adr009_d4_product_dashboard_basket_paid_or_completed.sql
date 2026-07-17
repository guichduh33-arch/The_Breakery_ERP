-- 20260717000185_adr009_d4_product_dashboard_basket_paid_or_completed.sql
-- ADR-009 déc. 4 — lot 2/3 des lecteurs `status = 'paid'` : dashboard produit
-- (volet top_customers) + analyse de panier. Corps copiés du LIVE
-- (pg_get_functiondef, 2026-07-17), seul changement = filtre de statut.
-- ACLs répliquées (authenticated + service_role).

-- ─── get_product_dashboard_v2 (ex v1) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_dashboard_v2(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days  INT;
  v_since TIMESTAMPTZ;
  v_summary JSONB;
  v_stock_by_section JSONB;
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

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.section_name), '[]'::JSONB)
    INTO v_stock_by_section
  FROM (
    SELECT
      s.id           AS section_id,
      s.code         AS section_code,
      s.name         AS section_name,
      ss.quantity    AS quantity,
      ss.unit        AS unit,
      (ss.quantity * (SELECT cost_price FROM products WHERE id = p_product_id)) AS value_at_cost
    FROM section_stock ss
    JOIN sections s ON s.id = ss.section_id
    WHERE ss.product_id = p_product_id
      AND s.deleted_at IS NULL
  ) t;

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
    'stock_by_section',  v_stock_by_section,
    'recent_movements',  v_recent_movements,
    'sales_velocity_daily', v_velocity_daily,
    'expiring_lots',     v_expiring_lots,
    'top_customers',     v_top_customers
  );
END $function$;

DROP FUNCTION public.get_product_dashboard_v1(uuid, integer);

REVOKE EXECUTE ON FUNCTION public.get_product_dashboard_v2(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_product_dashboard_v2(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_dashboard_v2(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_product_dashboard_v2(uuid, integer) IS
  'Dashboard produit (S13 2.D). v2 = v1 + top_customers sur statuts paid|completed (ADR-009 déc. 4).';

-- ─── get_basket_analysis_v2 (ex v1) ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_basket_analysis_v2(p_date_start date, p_date_end date, p_top_n integer DEFAULT 10)
 RETURNS TABLE(product_id_a uuid, product_a_name text, product_id_b uuid, product_b_name text, co_occurrence_count integer, support_a numeric, support_b numeric, support_pair numeric, confidence numeric, lift numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

DROP FUNCTION public.get_basket_analysis_v1(date, date, integer);

REVOKE EXECUTE ON FUNCTION public.get_basket_analysis_v2(date, date, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_basket_analysis_v2(date, date, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_basket_analysis_v2(date, date, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_basket_analysis_v2(date, date, integer) IS
  'Analyse de panier (co-occurrences). v2 = v1 + statuts paid|completed (ADR-009 déc. 4).';
