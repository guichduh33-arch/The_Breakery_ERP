-- 20260517000096_create_product_dashboard_rpc.sql
-- Session 13 / Phase 2.D — Product dashboard (Session 12 phase 7).
--
-- get_product_dashboard_v1 returns a JSON document combining several signals
-- for a single product over the last p_days days :
--   - summary : current stock, last movement, sales velocity (units/day),
--               value at cost.
--   - stock_by_section : list of {section, qty, value} from section_stock.
--   - recent_movements : last 20 rows from get_stock_movements_v1.
--   - sales_velocity_daily : last p_days rows {date, units_sold}.
--   - expiring_lots : list of active stock_lots ordered by expires_at ASC.
--   - top_customers : top 5 customers (by qty) over the window.

CREATE OR REPLACE FUNCTION get_product_dashboard_v1(
  p_product_id UUID,
  p_days       INT  DEFAULT 30
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
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

  -- 1. Product header.
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

  -- 2. Stock by section.
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.section_name), '[]'::JSONB)
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

  -- 3. Recent movements (top 20).
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB)
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

  -- 4. Daily sales velocity (last v_days days).
  SELECT COALESCE(jsonb_agg(row_to_jsonb(d) ORDER BY d.day), '[]'::JSONB)
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

  -- 5. Expiring lots (active, ASC).
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.expires_at ASC), '[]'::JSONB)
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

  -- 6. Top customers (last v_days, qty desc).
  SELECT COALESCE(jsonb_agg(row_to_jsonb(t) ORDER BY t.units_bought DESC), '[]'::JSONB)
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
      AND o.status = 'paid'
      AND o.paid_at >= v_since
      AND c.deleted_at IS NULL
    GROUP BY c.id, c.name
    ORDER BY SUM(oi.quantity) DESC
    LIMIT 5
  ) t;

  -- 7. Build summary block.
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
END $$;

REVOKE EXECUTE ON FUNCTION get_product_dashboard_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_product_dashboard_v1 TO authenticated;

COMMENT ON FUNCTION get_product_dashboard_v1 IS
  'Session 13 — Phase 2.D. inventory.read. Single-shot product dashboard data : '
  'header + summary + stock_by_section + recent_movements + sales_velocity_daily '
  '+ expiring_lots + top_customers. Window controlled by p_days.';
