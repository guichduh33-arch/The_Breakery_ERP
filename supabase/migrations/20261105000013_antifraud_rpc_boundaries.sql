-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_pos_top_products_v4(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz        TEXT;
  v_total_rev NUMERIC;
  v_products  JSONB;
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

  WITH scoped AS (
    SELECT o.id
    FROM reporting_private.recognized_sales_v2 o
    WHERE TRUE
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN p_start_date AND p_end_date
  ),
  lines AS (
    SELECT oi.product_id, oi.name_snapshot, oi.line_total, oi.quantity
    FROM reporting_private.closed_order_items_v1 oi
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
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_top_products_v4(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_top_products_v4(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_top_products_v2(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_top_products_v3(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_pos_payment_breakdown_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_tz     text;
  v_result jsonb;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
  IF v_uid IS NULL OR NOT has_permission(v_uid, 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_date_range: start date is after end date' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(timezone, 'Asia/Makassar') INTO v_tz FROM business_config WHERE id = 1;
  v_tz := COALESCE(v_tz, 'Asia/Makassar');

  WITH scoped_orders AS (
    SELECT o.id, o.total
    FROM reporting_private.closed_pos_orders_v1 o
    WHERE (o.status <> 'voided' OR o.outstanding_at IS NOT NULL)
      AND o.order_type <> 'b2b'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test
      )
  ),
  tenders AS (
    SELECT op.order_id, op.method::text AS method, op.amount
    FROM reporting_private.closed_order_payments_v1 op
    JOIN scoped_orders so ON so.id = op.order_id
    WHERE (op.paid_at AT TIME ZONE v_tz)::date BETWEEN p_start_date AND p_end_date
  ),
  grp AS (
    SELECT method, SUM(amount) AS amount, COUNT(*)::int AS tenders
    FROM tenders
    GROUP BY method
  ),
  tot AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_amount,
           COALESCE(SUM(tenders), 0)::int    AS total_tenders
    FROM grp
  ),
  ords AS (SELECT COUNT(DISTINCT order_id)::int AS c FROM tenders)
  SELECT jsonb_build_object(
    'timezone',       v_tz,
    'total_amount',   (SELECT total_amount  FROM tot),
    'total_orders',   (SELECT c             FROM ords),
    'total_tenders',  (SELECT total_tenders FROM tot),
    'by_method', COALESCE((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.amount DESC)
      FROM (
        SELECT
          g.method,
          g.amount,
          g.tenders,
          CASE WHEN (SELECT total_amount FROM tot) = 0 THEN 0
               ELSE ROUND(g.amount / (SELECT total_amount FROM tot) * 100, 2)
          END AS share_pct
        FROM grp g
      ) x
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_payment_breakdown_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_payment_breakdown_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_payment_breakdown_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_payment_breakdown_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_product_analytics_v4(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_days  INT;
  v_since TIMESTAMPTZ;
  v_cost  NUMERIC;
  v_stock NUMERIC;
  v_unit  TEXT;
  v_min   NUMERIC;
  v_consumption        NUMERIC;
  v_avg_daily          NUMERIC;
  v_days_remaining     NUMERIC;
  v_status             TEXT;
  v_product            JSONB;
  v_kpis               JSONB;
  v_timeline           JSONB;
  v_breakdown          JSONB;
  v_weekly             JSONB;
  v_trend              TEXT;
  v_price_trend        JSONB;
  v_purchase_pattern   JSONB;
  v_recipe_usage       JSONB;
  v_incoming           JSONB;
  v_production         JSONB;
  v_wastage            JSONB;
  v_opname             JSONB;
  v_recent             JSONB;
  v_total_recipe_qty   NUMERIC;
BEGIN
  PERFORM public.assert_stock_owner_v1();

  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  v_days  := GREATEST(COALESCE(p_days, 30), 1);
  v_since := now() - (v_days * INTERVAL '1 day');
  PERFORM public.assert_business_days_visible_v2(date_trunc('week',v_since)::date,current_date);

  SELECT p.cost_price, p.current_stock, p.unit, COALESCE(p.min_stock_threshold, 0),
         jsonb_build_object(
           'id', p.id, 'sku', p.sku, 'name', p.name, 'unit', p.unit,
           'product_type', p.product_type, 'is_semi_finished', p.is_semi_finished,
           'cost_price', p.cost_price, 'retail_price', p.retail_price,
           'current_stock', p.current_stock, 'min_stock_threshold', p.min_stock_threshold,
           'value_at_cost', (p.current_stock * p.cost_price)
         )
    INTO v_cost, v_stock, v_unit, v_min, v_product
    FROM products p WHERE p.id = p_product_id;

  IF v_product IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  SELECT COALESCE(SUM(ABS(sm.quantity)), 0) INTO v_consumption
    FROM stock_movements sm
   WHERE sm.product_id = p_product_id AND sm.created_at >= v_since
     AND sm.movement_type IN ('sale', 'production_out');

  v_avg_daily := v_consumption / v_days::NUMERIC;
  v_days_remaining := CASE WHEN v_avg_daily > 0 THEN v_stock / v_avg_daily ELSE NULL END;
  v_status := CASE WHEN v_stock <= 0 THEN 'out'
                   WHEN v_min > 0 AND v_stock <= v_min THEN 'low' ELSE 'ok' END;

  v_kpis := jsonb_build_object(
    'current_stock', v_stock, 'unit', v_unit, 'stock_value', (v_stock * v_cost),
    'unit_cost', v_cost, 'consumption_window', v_consumption,
    'avg_daily_consumption', v_avg_daily, 'days_remaining', v_days_remaining,
    'min_stock_threshold', v_min, 'stock_status', v_status
  );

  SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.day), '[]'::JSONB) INTO v_timeline
  FROM (
    SELECT cal.day::DATE AS day,
      v_stock - COALESCE((
        SELECT SUM(sm.quantity) FROM stock_movements sm
        WHERE sm.product_id = p_product_id AND sm.created_at::DATE > cal.day
      ), 0) AS balance
    FROM generate_series(v_since::DATE, now()::DATE, '1 day'::INTERVAL) AS cal(day)
  ) d;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.movement_type), '[]'::JSONB) INTO v_breakdown
  FROM (
    SELECT sm.movement_type::TEXT AS movement_type, COUNT(*)::BIGINT AS count,
      SUM(ABS(sm.quantity)) AS qty_total,
      SUM(ABS(sm.quantity) * COALESCE(sm.unit_cost, v_cost)) AS value_total
    FROM stock_movements sm
    WHERE sm.product_id = p_product_id AND sm.created_at >= v_since
    GROUP BY sm.movement_type
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.week_start), '[]'::JSONB) INTO v_weekly
  FROM (
    SELECT date_trunc('week', cal.wk)::DATE AS week_start,
      COALESCE((
        SELECT SUM(ABS(sm.quantity)) FROM stock_movements sm
        WHERE sm.product_id = p_product_id AND sm.movement_type IN ('sale', 'production_out')
          AND date_trunc('week', sm.created_at) = date_trunc('week', cal.wk)
      ), 0) AS units
    FROM generate_series(date_trunc('week', v_since), date_trunc('week', now()), '1 week'::INTERVAL) AS cal(wk)
  ) w;

  SELECT CASE WHEN cnt < 2 THEN 'stable'
              WHEN last_units > avg_rest * 1.15 THEN 'up'
              WHEN last_units < avg_rest * 0.85 THEN 'down' ELSE 'stable' END
    INTO v_trend
  FROM (
    SELECT COUNT(*) AS cnt,
      (array_agg(units ORDER BY week_start))[COUNT(*)] AS last_units,
      AVG(units) FILTER (WHERE rn < total) AS avg_rest
    FROM (
      SELECT (e->>'units')::NUMERIC AS units, e->>'week_start' AS week_start,
        row_number() OVER (ORDER BY e->>'week_start') AS rn, count(*) OVER () AS total
      FROM jsonb_array_elements(v_weekly) e
    ) z
  ) agg;
  v_trend := COALESCE(v_trend, 'stable');

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.date), '[]'::JSONB) INTO v_price_trend
  FROM (
    SELECT COALESCE(po.received_date, po.order_date) AS date, poi.unit_cost AS unit_cost, po.po_number AS po_number
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
    WHERE poi.product_id = p_product_id AND po.deleted_at IS NULL AND poi.unit_cost IS NOT NULL
    ORDER BY COALESCE(po.received_date, po.order_date) DESC LIMIT 24
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.month), '[]'::JSONB) INTO v_purchase_pattern
  FROM (
    SELECT date_trunc('month', COALESCE(po.received_date, po.order_date))::DATE AS month,
      SUM(poi.quantity) AS qty, COUNT(DISTINCT po.id)::BIGINT AS order_count
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
    WHERE poi.product_id = p_product_id AND po.deleted_at IS NULL
      AND COALESCE(po.received_date, po.order_date) >= (now() - INTERVAL '12 months')
    GROUP BY 1
  ) t;

  SELECT COALESCE(SUM(r.quantity), 0) INTO v_total_recipe_qty
    FROM recipes r WHERE r.material_id = p_product_id AND r.is_active AND r.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.demand_pct DESC, t.product_name), '[]'::JSONB) INTO v_recipe_usage
  FROM (
    SELECT cp.id AS product_id, cp.name AS product_name, cp.product_type AS product_type,
      cp.is_semi_finished AS is_semi_finished, r.quantity AS qty_per_batch, r.unit AS unit,
      CASE WHEN v_total_recipe_qty > 0 THEN ROUND(r.quantity / v_total_recipe_qty * 100, 1) ELSE 0 END AS demand_pct,
      (r.quantity * COALESCE((
         SELECT COUNT(*) FROM production_records pr
         WHERE pr.product_id = cp.id AND pr.production_date >= v_since AND pr.reverted_at IS NULL
       ), 0)) AS est_used
    FROM recipes r JOIN products cp ON cp.id = r.product_id
    WHERE r.material_id = p_product_id AND r.is_active AND r.deleted_at IS NULL AND cp.deleted_at IS NULL
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.order_date DESC NULLS LAST), '[]'::JSONB) INTO v_incoming
  FROM (
    SELECT po.id AS po_id, po.po_number AS po_number, po.status AS status, poi.quantity AS quantity,
      poi.received_quantity AS received_quantity, poi.unit AS unit, poi.unit_cost AS unit_cost,
      po.order_date AS order_date, po.expected_date AS expected_date, po.received_date AS received_date
    FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.po_id
    WHERE poi.product_id = p_product_id AND po.deleted_at IS NULL
    ORDER BY po.order_date DESC NULLS LAST LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.production_date DESC), '[]'::JSONB) INTO v_production
  FROM (
    SELECT pr.id AS id, pr.production_number AS production_number, pr.quantity_produced AS quantity_produced,
      pr.quantity_waste AS quantity_waste, pr.actual_yield_qty AS actual_yield_qty,
      pr.expected_yield_qty AS expected_yield_qty, pr.batch_number AS batch_number,
      pr.production_date AS production_date, (pr.reverted_at IS NOT NULL) AS reverted
    FROM production_records pr WHERE pr.product_id = p_product_id
    ORDER BY pr.production_date DESC LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB) INTO v_wastage
  FROM (
    SELECT sm.id AS id, ABS(sm.quantity) AS quantity, sm.unit AS unit, sm.reason AS reason,
      (ABS(sm.quantity) * COALESCE(sm.unit_cost, v_cost)) AS value, sm.created_at AS created_at
    FROM stock_movements sm WHERE sm.product_id = p_product_id AND sm.movement_type = 'waste'
    ORDER BY sm.created_at DESC LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB) INTO v_opname
  FROM (
    SELECT ic.id AS id, ic.count_number AS count_number, ic.status AS status, ici.expected_qty AS expected_qty,
      ici.counted_qty AS counted_qty, ici.variance AS variance, ici.unit AS unit,
      ic.finalized_at AS finalized_at, ic.created_at AS created_at
    FROM inventory_count_items ici JOIN inventory_counts ic ON ic.id = ici.count_id
    WHERE ici.product_id = p_product_id ORDER BY ic.created_at DESC LIMIT 20
  ) t;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::JSONB) INTO v_recent
  FROM (
    SELECT sm.id, sm.movement_type::TEXT AS movement_type, sm.quantity, sm.unit, sm.reason,
      fs.code AS from_section_code, ts.code AS to_section_code, sm.created_at
    FROM stock_movements sm
    LEFT JOIN sections fs ON fs.id = sm.from_section_id LEFT JOIN sections ts ON ts.id = sm.to_section_id
    WHERE sm.product_id = p_product_id ORDER BY sm.created_at DESC LIMIT 20
  ) t;

  RETURN jsonb_build_object(
    'product', v_product, 'window_days', v_days, 'kpis', v_kpis, 'stock_timeline', v_timeline,
    'movement_breakdown', v_breakdown, 'weekly_consumption', v_weekly, 'consumption_trend', v_trend,
    'purchase_price_trend', v_price_trend, 'purchase_pattern', v_purchase_pattern, 'recipe_usage', v_recipe_usage,
    'incoming_pos', v_incoming, 'production', v_production,
    'wastage', v_wastage, 'opname', v_opname, 'recent_movements', v_recent
  );
END $function$
;
REVOKE ALL ON FUNCTION public.get_product_analytics_v4(p_product_id uuid, p_days integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_analytics_v4(p_product_id uuid, p_days integer) TO authenticated,service_role;
DROP FUNCTION public.get_product_analytics_v3(p_product_id uuid, p_days integer);
