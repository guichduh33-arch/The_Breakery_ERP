-- 20260817000004_adr027_lot3_product_dashboard_v3.sql
--
-- ADR-027 lot 3/3 (1/4) — get_product_dashboard_v3 : le bloc stock_by_section
-- disparaît (il lisait section_stock, droppée en 20260817000007). Corps repris
-- du live pg_get_functiondef de la v2 ; les codes de section des mouvements
-- récents restent (colonnes historiques du ledger + table sections conservée
-- comme registre de stations). NOTE ADR-004 : le bloc expiring_lots est l'infra
-- dormante péremption, repris verbatim.

CREATE OR REPLACE FUNCTION public.get_product_dashboard_v3(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
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
END $function$;

COMMENT ON FUNCTION public.get_product_dashboard_v3(uuid, integer) IS
  'ADR-027 : dashboard produit mono-section (stock_by_section retiré). inventory.read.';

DROP FUNCTION IF EXISTS public.get_product_dashboard_v2(uuid, integer);

REVOKE EXECUTE ON FUNCTION public.get_product_dashboard_v3(uuid, integer) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_product_dashboard_v3(uuid, integer) TO authenticated;
