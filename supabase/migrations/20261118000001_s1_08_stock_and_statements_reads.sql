-- S1-08, paquets 2 et 3 — les lectures du stock et des états financiers passent
-- du rôle propriétaire à la permission (ADR-039).
--
-- Paquet 2 (stock) : les lectures qui appelaient `assert_stock_owner_v1`, ou qui
-- masquaient le stock par `can_view_business_day_v2` / `can_view_stock_v1`,
-- exigent désormais `reports.inventory.read`, via `assert_stock_visible_v1` ou
-- `can_view_stock_v2` (paquet 1). Le grand livre ne garde ce verrou que pour les
-- comptes de stock (114x), comme avant.
-- Paquet 3 (états financiers) : bilan, résultat, flux de trésorerie, balance,
-- journal des coffres, marge par produit et PB1 exigent `reports.statements.read`,
-- via `assert_statements_visible_v1`. Le journal des coffres est traité comme un
-- grand livre de comptes de trésorerie.
--
-- Chaque corps est repris de `pg_get_functiondef` du dev le 2026-11-18 (md5 du
-- corps vérifié égal au vivant avant génération). Seules changent la garde et
-- les auto-références de nom ; contrat de sortie identique.
--
-- Restent volontairement en place, hors de ce paquet :
--   - la confidentialité de la journée en cours (`is_business_owner_v1` dans les
--     fonctions de journée, du tableau de bord, des paiements par méthode et de
--     l'historique de caisse) : ADR-039, « Ce qui ne change pas » ;
--   - les gestes réservés au propriétaire (inventaire, déclarations, période,
--     journée) et le comptage à l'aveugle ;
--   - les fonctions d'écriture qui masquent le stock dans leurs messages
--     d'erreur via `can_view_business_day_v2`, dont celles du paiement ;
--   - `get_operational_products`, lue par la caisse.
--
-- Effet en production : aucun. Seul le rôle SUPER_ADMIN y détient
-- `reports.inventory.read` et `reports.statements.read` (relevé du 2026-11-17).
--
-- Additif : les anciennes versions restent tant que le back-office publié les
-- appelle. Leur retrait est la migration suivante.

CREATE FUNCTION public.assert_stock_visible_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_view_stock_v2() THEN
  RAISE EXCEPTION 'stock_visibility_required' USING ERRCODE='P0003';
 END IF;
END $$;
COMMENT ON FUNCTION public.assert_stock_visible_v1() IS
  'ADR-039 : refuse la lecture du stock sans reports.inventory.read.';

CREATE FUNCTION public.assert_statements_visible_v1() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public.can_view_statements_v1() THEN
  RAISE EXCEPTION 'financial_statements_required' USING ERRCODE='42501';
 END IF;
END $$;
COMMENT ON FUNCTION public.assert_statements_visible_v1() IS
  'ADR-039 : refuse la lecture des états financiers sans reports.statements.read.';

REVOKE ALL ON FUNCTION public.assert_stock_visible_v1() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_statements_visible_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_stock_visible_v1() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_statements_visible_v1() TO authenticated, service_role;

-- ── Vue du stock : reports.inventory.read ─────────────────────────────

-- get_display_stock_activity_v3 → get_display_stock_activity_v4
CREATE OR REPLACE FUNCTION public.get_display_stock_activity_v4()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows  JSONB;
  v_empty INT;
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'display.read') THEN
    RAISE EXCEPTION 'permission denied: display.read required'
      USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2((now()-interval '7 days')::date,current_date);


  WITH last_sale AS (
    SELECT oi.product_id, MAX(o.paid_at) AS last_sold_at
      FROM reporting_private.closed_order_items_v1 oi
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oi.order_id
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

-- get_low_stock_v4 → get_low_stock_v5
CREATE OR REPLACE FUNCTION public.get_low_stock_v5()
 RETURNS TABLE(product_id uuid, product_sku text, product_name text, current_qty numeric, min_stock_threshold numeric, unit text, shortfall numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2(current_date,current_date);


  RETURN QUERY
  SELECT
    p.id, p.sku, p.name,
    p.current_stock, p.min_stock_threshold, p.unit,
    (p.min_stock_threshold - p.current_stock) AS shortfall
  FROM products p
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND p.min_stock_threshold > 0
    AND p.current_stock < p.min_stock_threshold
  ORDER BY (p.min_stock_threshold - p.current_stock) DESC, p.name;
END $function$
;

-- get_movement_aggregates_v5 → get_movement_aggregates_v6
CREATE OR REPLACE FUNCTION public.get_movement_aggregates_v6(p_section_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_movement_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2(COALESCE(p_date_start::date,(SELECT activated_on FROM public.business_day_visibility_config WHERE id)),COALESCE((p_date_end-interval '1 microsecond')::date,current_date));


  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::JSONB) INTO v_result
  FROM (
    SELECT
      sm.movement_type::TEXT AS movement_type,
      sm.unit AS unit,
      sign(sm.quantity)::integer AS direction,
      COUNT(*)::BIGINT       AS count,
      SUM(ABS(sm.quantity))  AS qty_total,
      SUM(sm.quantity * COALESCE(p.cost_price, 0)) AS value_total
    FROM stock_movements sm
    LEFT JOIN products p ON p.id = sm.product_id
    WHERE (p_section_id IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
      AND (p_product_id IS NULL OR sm.product_id = p_product_id)
      AND (p_date_start IS NULL OR sm.created_at >= p_date_start)
      AND (p_date_end   IS NULL OR sm.created_at < p_date_end)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
    GROUP BY sm.movement_type, sm.unit, sign(sm.quantity)
    ORDER BY sm.movement_type::TEXT, sm.unit, sign(sm.quantity)
  ) t;

  RETURN v_result;
END $function$
;

-- get_product_analytics_v4 → get_product_analytics_v5
CREATE OR REPLACE FUNCTION public.get_product_analytics_v5(p_product_id uuid, p_days integer DEFAULT 30)
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
  PERFORM public.assert_stock_visible_v1();

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

-- get_product_dashboard_v7 → get_product_dashboard_v8
CREATE OR REPLACE FUNCTION public.get_product_dashboard_v8(p_product_id uuid, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_required';
  END IF;

  v_days  := GREATEST(COALESCE(p_days, 30), 1);
  v_since := now() - (v_days * INTERVAL '1 day');
  -- Compatibilité prod : la visibilité par journée n'y est pas encore installée.
  IF to_regprocedure('public.assert_business_days_visible_v2(date,date)') IS NOT NULL THEN
    PERFORM public.assert_business_days_visible_v2(v_since::date,current_date);
  END IF;

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
    FROM reporting_private.closed_order_items_v1 oi
    JOIN reporting_private.recognized_sales_v2 o     ON o.id = oi.order_id
    JOIN customers c  ON c.id = o.customer_id
    WHERE oi.product_id = p_product_id
      AND TRUE
      AND o.recognized_at >= v_since
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
END $function$
;

-- get_production_suggestions_v3 → get_production_suggestions_v4
CREATE OR REPLACE FUNCTION public.get_production_suggestions_v4(p_lookback_days integer DEFAULT 7, p_priority_high integer DEFAULT 3, p_priority_medium integer DEFAULT 7)
 RETURNS TABLE(product_id uuid, product_name text, product_sku text, avg_daily_sales numeric, current_stock numeric, days_of_stock numeric, suggested_quantity numeric, priority text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2((now()-p_lookback_days*interval '1 day')::date,current_date);


  IF p_lookback_days IS NULL OR p_lookback_days < 1 THEN
    RAISE EXCEPTION 'lookback_days_must_be_positive' USING ERRCODE='P0001';
  END IF;

  RETURN QUERY
    WITH sales AS (
      SELECT oi.product_id,
             SUM(oi.quantity)::NUMERIC / p_lookback_days AS avg_daily
      FROM reporting_private.closed_order_items_v1 oi
      JOIN reporting_private.closed_pos_orders_v1 o ON o.id = oi.order_id
      WHERE o.created_at >= now() - (p_lookback_days * INTERVAL '1 day')
        AND COALESCE(oi.is_cancelled, false) = false
      GROUP BY oi.product_id
      HAVING SUM(oi.quantity) > 0
    ),
    eligible AS (
      SELECT DISTINCT p.id, p.name, p.sku, p.current_stock, s.avg_daily
      FROM products p
      JOIN sales s ON s.product_id = p.id
      WHERE p.product_type = 'finished'
        AND p.deleted_at IS NULL
        AND p.is_active = TRUE
        AND EXISTS (
          SELECT 1 FROM recipes r
          WHERE r.product_id = p.id
            AND r.is_active = TRUE
            AND r.deleted_at IS NULL
        )
    )
    SELECT
      e.id           AS product_id,
      e.name         AS product_name,
      e.sku          AS product_sku,
      e.avg_daily    AS avg_daily_sales,
      e.current_stock,
      CASE WHEN e.avg_daily > 0 THEN e.current_stock / e.avg_daily ELSE NULL END AS days_of_stock,
      GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock)::NUMERIC AS suggested_quantity,
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 'high'
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 'medium'
        ELSE 'low'
      END AS priority
    FROM eligible e
    WHERE GREATEST(0, ROUND(e.avg_daily * 3) - e.current_stock) > 0
    ORDER BY
      CASE
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_high THEN 0
        WHEN e.avg_daily > 0 AND e.current_stock / e.avg_daily < p_priority_medium THEN 1
        ELSE 2
      END,
      e.avg_daily DESC;
END $function$
;

-- get_production_vs_sales_v4 → get_production_vs_sales_v5
CREATE FUNCTION public.get_production_vs_sales_v5(
  p_start_date  date,
  p_end_date    date,
  p_category_id uuid DEFAULT NULL,
  p_product_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_start  date;
  v_end    date;
  v_result jsonb;
  -- Décision 4 : le périmètre est une liste fermée de slugs de catégories.
  v_scope  CONSTANT text[] := ARRAY[
    'classic-breads', 'sourdough-breads', 'classic-viennoiserie',
    'others-viennoiserie', 'savouries', 'individual-pastries', 'buns', 'bagel'
  ];
BEGIN
  -- Garde : même enchaînement que l'état de stock réservé au propriétaire.
  PERFORM public.assert_stock_visible_v1();

  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 91);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  PERFORM public.assert_business_days_visible_v2(v_start, v_end);

  WITH scope AS (
    -- Les mêmes filtres pour toutes les sources : tout passe par ce périmètre.
    SELECT p.id AS product_id, p.name AS product_name,
           c.id AS category_id, c.name AS category_name
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE c.slug = ANY (v_scope)
      AND c.deleted_at IS NULL
      AND p.is_test = false
      AND (p_category_id IS NULL OR c.id = p_category_id)
      AND (p_product_id  IS NULL OR p.id = p_product_id)
  ),
  produced AS (
    SELECT ((pr.production_date AT TIME ZONE v_tz))::date AS day,
           pr.product_id,
           SUM(pr.quantity_produced) AS produced
    FROM production_records pr
    JOIN scope s ON s.product_id = pr.product_id
    WHERE pr.reverted_at IS NULL
      AND ((pr.production_date AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
    GROUP BY 1, 2
  ),
  sales_orders AS (
    -- Comptoir : même définition que le rapport des ventes par produit, jour
    -- de reconnaissance. Le B2B en est écarté : il a sa propre branche.
    SELECT o.id,
           false AS is_b2b,
           ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS day
    FROM reporting_private.recognized_sales_v2 o
    WHERE o.order_type <> 'b2b'
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
    UNION ALL
    -- B2B : toute commande LIVRÉE, payée ou non, au jour de sa livraison.
    SELECT o.id,
           true AS is_b2b,
           ((o.b2b_delivered_at AT TIME ZONE v_tz))::date AS day
    FROM reporting_private.closed_pos_orders_v1 o
    WHERE o.order_type = 'b2b'
      AND o.b2b_delivered_at IS NOT NULL
      AND o.voided_at IS NULL
      AND o.status <> 'voided'
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((o.b2b_delivered_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  sold_units AS (
    -- La ligne propre de l'article.
    SELECT so.day, so.is_b2b, s.product_id, oi.quantity AS qty, false AS in_combo
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sales_orders so ON so.id = oi.order_id
    JOIN scope s ON s.product_id = oi.product_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
    UNION ALL
    -- L'article servi comme composant d'un combo (décision de Mamat,
    -- 2026-11-11) : il a quitté la vitrine, il compte comme vendu. Quantité =
    -- quantité de la ligne du combo × quantité du composant. Le rapprochement
    -- se fait sur le texte de l'identifiant : un composant mal formé ne casse
    -- pas le rapport, il n'est simplement pas compté.
    SELECT so.day, so.is_b2b, s.product_id,
           oi.quantity * COALESCE(NULLIF(e.value->>'quantity', '')::numeric, 1) AS qty,
           true AS in_combo
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sales_orders so ON so.id = oi.order_id
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(oi.combo_components) = 'array'
           THEN oi.combo_components ELSE '[]'::jsonb END
    ) AS e(value)
    JOIN scope s ON s.product_id::text = e.value->>'product_id'
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
  ),
  sold AS (
    SELECT u.day,
           u.product_id,
           COALESCE(SUM(u.qty) FILTER (WHERE NOT u.is_b2b), 0) AS sold_counter,
           COALESCE(SUM(u.qty) FILTER (WHERE u.is_b2b), 0)     AS sold_b2b,
           -- Information : la part des deux colonnes ci-dessus servie en combo.
           COALESCE(SUM(u.qty) FILTER (WHERE u.in_combo), 0)   AS sold_in_combo
    FROM sold_units u
    GROUP BY 1, 2
  ),
  closing_waste_day AS (
    -- Jour métier de la clôture de vitrine qui a saisi la perte (une perte
    -- reprise par une révision corrigée appartient au même jour).
    SELECT i.waste_declaration_id AS declaration_id, MIN(c.business_day) AS day
    FROM display_day_closing_items i
    JOIN display_day_closings c ON c.id = i.closing_id
    WHERE i.waste_declaration_id IS NOT NULL
    GROUP BY i.waste_declaration_id
  ),
  wasted AS (
    -- Décision 3 : uniquement le mouvement né d'une déclaration approuvée.
    SELECT w.day, w.product_id, SUM(w.qty) AS wasted
    FROM (
      SELECT COALESCE(cw.day, ((sm.created_at AT TIME ZONE v_tz))::date) AS day,
             sm.product_id,
             ABS(sm.quantity) AS qty
      FROM stock_movements sm
      JOIN scope s ON s.product_id = sm.product_id
      JOIN stock_declarations d ON d.id = sm.reference_id
      LEFT JOIN closing_waste_day cw ON cw.declaration_id = d.id
      WHERE sm.movement_type = 'waste'
        AND sm.reference_type = 'stock_declaration'
        AND d.status = 'approved'
        AND d.operation IN ('waste', 'display_waste')
    ) w
    WHERE w.day BETWEEN v_start AND v_end
    GROUP BY 1, 2
  ),
  closings AS (
    -- Dernière révision de chaque jour métier, de la veille du début à la fin.
    SELECT DISTINCT ON (c.business_day) c.id, c.business_day
    FROM display_day_closings c
    WHERE c.business_day BETWEEN v_start - 1 AND v_end
    ORDER BY c.business_day, c.revision DESC
  ),
  counted AS (
    SELECT cl.business_day AS day, i.product_id, i.remaining_qty
    FROM closings cl
    JOIN display_day_closing_items i ON i.closing_id = cl.id
    JOIN scope s ON s.product_id = i.product_id
  ),
  cells AS (
    -- Une cellule par (jour, article) ; toutes les ventilations en dérivent,
    -- ce qui garantit que leurs sommes se referment.
    SELECT u.day, u.product_id,
           SUM(u.produced)     AS produced,
           SUM(u.sold_counter) AS sold_counter,
           SUM(u.sold_b2b)     AS sold_b2b,
           SUM(u.sold_in_combo) AS sold_in_combo,
           SUM(u.wasted)       AS wasted
    FROM (
      SELECT day, product_id, produced, 0::numeric AS sold_counter,
             0::numeric AS sold_b2b, 0::numeric AS sold_in_combo,
             0::numeric AS wasted FROM produced
      UNION ALL
      SELECT day, product_id, 0, sold_counter, sold_b2b, sold_in_combo, 0 FROM sold
      UNION ALL
      SELECT day, product_id, 0, 0, 0, 0, wasted FROM wasted
      UNION ALL
      -- Un reste déclaré ouvre une cellule le soir même et le lendemain.
      SELECT day, product_id, 0, 0, 0, 0, 0 FROM counted WHERE day >= v_start
      UNION ALL
      SELECT day + 1, product_id, 0, 0, 0, 0, 0 FROM counted WHERE day + 1 <= v_end
    ) u
    GROUP BY u.day, u.product_id
  ),
  balanced AS (
    SELECT c.*,
           o.remaining_qty AS opening,
           k.remaining_qty AS closing,
           (o.remaining_qty IS NOT NULL AND k.remaining_qty IS NOT NULL) AS known
    FROM cells c
    LEFT JOIN counted o ON o.day = c.day - 1 AND o.product_id = c.product_id
    LEFT JOIN counted k ON k.day = c.day     AND k.product_id = c.product_id
  ),
  named AS (
    SELECT b.day, b.product_id, b.produced, b.sold_counter, b.sold_b2b,
           b.sold_in_combo, b.wasted,
           b.opening, b.closing,
           s.product_name, s.category_id, s.category_name,
           b.sold_counter + b.sold_b2b                          AS sold_total,
           b.produced - b.sold_counter - b.sold_b2b - b.wasted  AS gap,
           CASE WHEN b.known
                THEN b.opening + b.produced - b.sold_counter - b.sold_b2b - b.wasted - b.closing
           END                                                  AS unexplained
    FROM balanced b
    JOIN scope s ON s.product_id = b.product_id
    -- Une cellule sans aucun mouvement ni reste non nul n'apporte rien.
    WHERE b.produced <> 0 OR b.sold_counter <> 0 OR b.sold_b2b <> 0 OR b.wasted <> 0
       OR COALESCE(b.opening, 0) <> 0 OR COALESCE(b.closing, 0) <> 0
  ),
  tot AS (
    SELECT COALESCE(SUM(produced), 0)     AS produced,
           COALESCE(SUM(sold_counter), 0) AS sold_counter,
           COALESCE(SUM(sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(sold_total), 0)   AS sold_total,
           COALESCE(SUM(sold_in_combo), 0) AS sold_in_combo,
           COALESCE(SUM(wasted), 0)       AS wasted,
           COALESCE(SUM(gap), 0)          AS gap,
           COALESCE(SUM(opening), 0)      AS opening,
           COALESCE(SUM(closing), 0)      AS closing,
           SUM(unexplained)               AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
    FROM named
  ),
  per_day AS (
    SELECT g.day::date AS day,
           COALESCE(SUM(n.produced), 0)     AS produced,
           COALESCE(SUM(n.sold_counter), 0) AS sold_counter,
           COALESCE(SUM(n.sold_b2b), 0)     AS sold_b2b,
           COALESCE(SUM(n.sold_total), 0)   AS sold_total,
           COALESCE(SUM(n.sold_in_combo), 0) AS sold_in_combo,
           COALESCE(SUM(n.wasted), 0)       AS wasted,
           COALESCE(SUM(n.gap), 0)          AS gap,
           COALESCE(SUM(n.opening), 0)      AS opening,
           COALESCE(SUM(n.closing), 0)      AS closing,
           SUM(n.unexplained)               AS unexplained,
           COUNT(n.day) FILTER (WHERE n.unexplained IS NULL) AS unknown_cells,
           EXISTS (SELECT 1 FROM closings cl WHERE cl.business_day = g.day::date) AS has_closing
    FROM generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g(day)
    LEFT JOIN named n ON n.day = g.day::date
    GROUP BY g.day
  ),
  per_category AS (
    SELECT category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(sold_in_combo) AS sold_in_combo,
           SUM(wasted) AS wasted, SUM(gap) AS gap,
           COALESCE(SUM(opening), 0) AS opening, COALESCE(SUM(closing), 0) AS closing,
           SUM(unexplained) AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
    FROM named
    GROUP BY category_id, category_name
  ),
  per_product AS (
    SELECT product_id, product_name, category_id, category_name,
           SUM(produced) AS produced, SUM(sold_counter) AS sold_counter,
           SUM(sold_b2b) AS sold_b2b, SUM(sold_total) AS sold_total,
           SUM(sold_in_combo) AS sold_in_combo,
           SUM(wasted) AS wasted, SUM(gap) AS gap,
           COALESCE(SUM(opening), 0) AS opening, COALESCE(SUM(closing), 0) AS closing,
           SUM(unexplained) AS unexplained,
           COUNT(*) FILTER (WHERE unexplained IS NULL) AS unknown_cells
    FROM named
    GROUP BY product_id, product_name, category_id, category_name
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'categories', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'slug', c.slug)
                       ORDER BY c.name ASC, c.id ASC)
      FROM categories c
      WHERE c.slug = ANY (v_scope) AND c.deleted_at IS NULL
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'produced',         t.produced,
      'sold_counter',     t.sold_counter,
      'sold_b2b',         t.sold_b2b,
      'sold_total',       t.sold_total,
      'sold_in_combo',    t.sold_in_combo,
      'wasted',           t.wasted,
      'gap',              t.gap,
      'opening',          t.opening,
      'closing',          t.closing,
      'unexplained',      t.unexplained,
      'unknown_cells',    t.unknown_cells,
      'sell_through_pct', CASE WHEN t.produced = 0 THEN NULL
                               ELSE ROUND(100 * t.sold_total / t.produced, 1) END
    ),
    'by_day', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',          d.day,
        'produced',      d.produced,
        'sold_counter',  d.sold_counter,
        'sold_b2b',      d.sold_b2b,
        'sold_total',    d.sold_total,
        'sold_in_combo', d.sold_in_combo,
        'wasted',        d.wasted,
        'gap',           d.gap,
        'opening',       d.opening,
        'closing',       d.closing,
        'unexplained',   d.unexplained,
        'unknown_cells', d.unknown_cells,
        'has_closing',   d.has_closing
      ) ORDER BY d.day ASC)
      FROM per_day d
    ), '[]'::jsonb),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id',      pc.category_id,
        'category_name',    pc.category_name,
        'produced',         pc.produced,
        'sold_counter',     pc.sold_counter,
        'sold_b2b',         pc.sold_b2b,
        'sold_total',       pc.sold_total,
        'sold_in_combo',    pc.sold_in_combo,
        'wasted',           pc.wasted,
        'gap',              pc.gap,
        'opening',          pc.opening,
        'closing',          pc.closing,
        'unexplained',      pc.unexplained,
        'unknown_cells',    pc.unknown_cells,
        'sell_through_pct', CASE WHEN pc.produced = 0 THEN NULL
                                 ELSE ROUND(100 * pc.sold_total / pc.produced, 1) END
      ) ORDER BY pc.category_name ASC, pc.category_id ASC)
      FROM per_category pc
    ), '[]'::jsonb),
    'by_product', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',       pp.product_id,
        'product_name',     pp.product_name,
        'category_id',      pp.category_id,
        'category_name',    pp.category_name,
        'produced',         pp.produced,
        'sold_counter',     pp.sold_counter,
        'sold_b2b',         pp.sold_b2b,
        'sold_total',       pp.sold_total,
        'sold_in_combo',    pp.sold_in_combo,
        'wasted',           pp.wasted,
        'gap',              pp.gap,
        'opening',          pp.opening,
        'closing',          pp.closing,
        'unexplained',      pp.unexplained,
        'unknown_cells',    pp.unknown_cells,
        'sell_through_pct', CASE WHEN pp.produced = 0 THEN NULL
                                 ELSE ROUND(100 * pp.sold_total / pp.produced, 1) END
      ) ORDER BY pp.gap DESC, pp.product_name ASC, pp.product_id ASC)
      FROM per_product pp
    ), '[]'::jsonb),
    'by_day_product', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date',         n.day,
        'product_id',   n.product_id,
        'produced',     n.produced,
        'sold_counter', n.sold_counter,
        'sold_b2b',     n.sold_b2b,
        'sold_total',   n.sold_total,
        'sold_in_combo', n.sold_in_combo,
        'wasted',       n.wasted,
        'gap',          n.gap,
        'opening',      n.opening,
        'closing',      n.closing,
        'unexplained',  n.unexplained
      ) ORDER BY n.day ASC, n.product_name ASC, n.product_id ASC)
      FROM named n
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t;

  RETURN v_result;
END;
$function$;

-- get_reorder_suggestions_v3 → get_reorder_suggestions_v4
CREATE OR REPLACE FUNCTION public.get_reorder_suggestions_v4(p_lookback_days integer DEFAULT 30, p_buffer_days integer DEFAULT 14)
 RETURNS TABLE(product_id uuid, product_sku text, product_name text, unit text, current_stock numeric, min_stock_threshold numeric, avg_daily_usage numeric, days_of_stock numeric, suggested_order_qty numeric, supplier_id uuid, supplier_name text, last_purchase_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lookback INT;
  v_buffer   INT;
  v_since    TIMESTAMPTZ;
BEGIN
  PERFORM public.assert_stock_visible_v1();

  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  v_lookback := GREATEST(COALESCE(p_lookback_days, 30), 1);
  v_buffer   := GREATEST(COALESCE(p_buffer_days, 14), 1);
  v_since    := now() - (v_lookback * INTERVAL '1 day');
  PERFORM public.assert_business_days_visible_v2(v_since::date,current_date);

  RETURN QUERY
  WITH usage AS (
    SELECT
      sm.product_id,
      SUM(ABS(sm.quantity)) / v_lookback::DECIMAL AS avg_daily
    FROM stock_movements sm
    WHERE sm.created_at >= v_since
      AND sm.movement_type IN ('sale','production_out','waste','transfer_out')
    GROUP BY sm.product_id
  ), latest_supplier AS (
    SELECT DISTINCT ON (sm.product_id)
      sm.product_id, sm.supplier_id, sm.created_at
    FROM stock_movements sm
    WHERE sm.supplier_id IS NOT NULL
      AND sm.movement_type IN ('purchase','incoming')
    ORDER BY sm.product_id, sm.created_at DESC
  )
  SELECT
    p.id, p.sku, p.name, p.unit,
    p.current_stock,
    p.min_stock_threshold,
    COALESCE(u.avg_daily, 0)::DECIMAL(10,3),
    CASE
      WHEN COALESCE(u.avg_daily, 0) = 0 THEN NULL
      ELSE (p.current_stock / u.avg_daily)::DECIMAL(10,3)
    END,
    GREATEST(0, COALESCE(u.avg_daily, 0) * v_buffer - p.current_stock)::DECIMAL(10,3),
    ls.supplier_id,
    sup.name,
    ls.created_at
  FROM products p
  LEFT JOIN usage u ON u.product_id = p.id
  LEFT JOIN latest_supplier ls ON ls.product_id = p.id
  LEFT JOIN suppliers sup ON sup.id = ls.supplier_id
  WHERE p.deleted_at IS NULL
    AND p.is_active = true
    AND (
      (COALESCE(u.avg_daily, 0) > 0 AND (p.current_stock / u.avg_daily) < v_buffer)
      OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold)
    )
  ORDER BY
    CASE WHEN COALESCE(u.avg_daily, 0) > 0
         THEN (p.current_stock / u.avg_daily)
         ELSE 0 END ASC,
    p.name;
END $function$
;

-- get_stock_config_issues_v4 → get_stock_config_issues_v5
CREATE OR REPLACE FUNCTION public.get_stock_config_issues_v5()
 RETURNS TABLE(product_id uuid, sku text, name text, category_name text, issue_type text, severity text, track_inventory boolean, deduct_stock boolean, recipe_lines integer, current_stock numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2(current_date,current_date);


  RETURN QUERY
  WITH base AS (
    SELECT
      p.id, p.sku, p.name, c.name AS category_name,
      p.track_inventory, p.deduct_stock, p.is_display_item,
      p.visible_on_pos, p.is_active, p.product_type, p.current_stock,
      (SELECT count(*)::int FROM recipes r
        WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL) AS recipe_lines,
      EXISTS (SELECT 1 FROM recipes r2
        WHERE r2.material_id = p.id AND r2.is_active AND r2.deleted_at IS NULL) AS used_as_ingredient
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
  ),
  issues AS (
    SELECT b.id, b.sku, b.name, b.category_name,
           'negative_stock'::text AS issue_type, 'critical'::text AS severity,
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.track_inventory = true AND b.current_stock < 0
    UNION ALL
    -- v2 (F1) : paire d unites inconvertible entre la ligne de recette et le stock de
    -- la matiere. La vente ECHOUE desormais sur cette ligne — l anomalie doit se voir
    -- avant l encaissement. Predicat = miroir exact du corps de convert_quantity.
    SELECT b.id, b.sku, b.name, b.category_name,
           'unconvertible_recipe_unit', 'critical',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE EXISTS (
       SELECT 1
         FROM recipes r
         JOIN products m ON m.id = r.material_id
        WHERE r.product_id = b.id
          AND r.is_active AND r.deleted_at IS NULL
          AND m.track_inventory = true
          AND r.unit <> m.unit
          AND NOT EXISTS (
                SELECT 1 FROM unit_conversions uc
                 WHERE uc.from_unit = r.unit AND uc.to_unit = m.unit)
          AND NOT EXISTS (
                SELECT 1
                  FROM units uf
                  JOIN units ut ON ut.dimension = uf.dimension
                 WHERE uf.code = r.unit AND ut.code = m.unit
                   AND uf.factor_to_canonical IS NOT NULL
                   AND ut.factor_to_canonical IS NOT NULL)
     )
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'sale_deduct_no_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = false AND b.deduct_stock = true
       AND b.recipe_lines = 0
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'orphan_recipe', 'warning',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.deduct_stock = false AND b.recipe_lines > 0
    UNION ALL
    SELECT b.id, b.sku, b.name, b.category_name,
           'tracked_recipe_at_prod', 'info',
           b.track_inventory, b.deduct_stock, b.recipe_lines, b.current_stock
      FROM base b
     WHERE b.is_active = true AND b.visible_on_pos = true
       AND b.product_type <> 'combo' AND b.is_display_item = false
       AND b.track_inventory = true AND b.deduct_stock = true
       AND b.recipe_lines > 0 AND b.used_as_ingredient = false
  )
  SELECT i.id, i.sku, i.name, i.category_name, i.issue_type, i.severity,
         i.track_inventory, i.deduct_stock, i.recipe_lines, i.current_stock
    FROM issues i
   ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
            i.category_name, i.name;
END $function$
;

-- get_stock_counters_v3 → get_stock_counters_v4
CREATE OR REPLACE FUNCTION public.get_stock_counters_v4(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, low_count bigint, zero_count bigint, negative_count bigint, untracked_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2(current_date,current_date);


  RETURN QUERY
  SELECT COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory
                            AND p.min_stock_threshold > 0
                            AND p.current_stock < p.min_stock_threshold)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory AND p.current_stock = 0)::bigint,
         COUNT(*) FILTER (WHERE p.track_inventory AND p.current_stock < 0)::bigint,
         COUNT(*) FILTER (WHERE NOT p.track_inventory)::bigint
    FROM products p
   WHERE p.deleted_at IS NULL
     AND (p_category_id IS NULL OR p.category_id = p_category_id)
     AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%');
END $function$
;

-- get_stock_levels_v6 → get_stock_levels_v7
CREATE OR REPLACE FUNCTION public.get_stock_levels_v7(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_bucket stock_bucket DEFAULT 'all'::stock_bucket, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT NULL::text, p_sort_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(product_id uuid, sku text, name text, category_id uuid, category_name text, current_stock numeric, min_stock_threshold numeric, track_inventory boolean, unit text, stock_value numeric, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir text := lower(COALESCE(p_sort_dir, 'asc'));
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v2(current_date,current_date);

  IF p_sort IS NOT NULL AND p_sort NOT IN ('name', 'sku', 'category', 'stock', 'min', 'value', 'last_movement') THEN
    RAISE EXCEPTION 'invalid p_sort: %', p_sort USING ERRCODE='22023';
  END IF;
  IF v_dir NOT IN ('asc', 'desc') THEN
    RAISE EXCEPTION 'invalid p_sort_dir: %', p_sort_dir USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT sub.product_id, sub.sku, sub.name, sub.category_id, sub.category_name,
         sub.current_stock, sub.min_stock_threshold, sub.track_inventory,
         sub.unit, sub.stock_value, sub.last_movement_at
  FROM (
    SELECT p.id AS product_id, p.sku, p.name, p.category_id, c.name AS category_name,
           p.current_stock, p.min_stock_threshold, p.track_inventory,
           p.unit, (p.current_stock * p.cost_price)::numeric AS stock_value,
           (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id) AS last_movement_at,
           CASE WHEN p.track_inventory AND p.min_stock_threshold > 0
                THEN p.min_stock_threshold - p.current_stock
           END AS shortfall
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
       AND CASE COALESCE(p_bucket, 'all'::public.stock_bucket)
             WHEN 'all'       THEN TRUE
             WHEN 'low'       THEN p.track_inventory AND p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold
             WHEN 'zero'      THEN p.track_inventory AND p.current_stock = 0
             WHEN 'negative'  THEN p.track_inventory AND p.current_stock < 0
             WHEN 'untracked' THEN NOT p.track_inventory
           END
  ) sub
  ORDER BY
    CASE WHEN p_sort IS NULL THEN sub.shortfall END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' THEN
      CASE p_sort WHEN 'name' THEN sub.name WHEN 'sku' THEN sub.sku WHEN 'category' THEN sub.category_name END
    END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' THEN
      CASE p_sort WHEN 'name' THEN sub.name WHEN 'sku' THEN sub.sku WHEN 'category' THEN sub.category_name END
    END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' THEN
      CASE p_sort WHEN 'stock' THEN sub.current_stock WHEN 'min' THEN sub.min_stock_threshold WHEN 'value' THEN sub.stock_value END
    END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' THEN
      CASE p_sort WHEN 'stock' THEN sub.current_stock WHEN 'min' THEN sub.min_stock_threshold WHEN 'value' THEN sub.stock_value END
    END DESC NULLS LAST,
    CASE WHEN v_dir = 'asc' AND p_sort = 'last_movement' THEN sub.last_movement_at END ASC NULLS LAST,
    CASE WHEN v_dir = 'desc' AND p_sort = 'last_movement' THEN sub.last_movement_at END DESC NULLS LAST,
    sub.name
  LIMIT p_limit OFFSET p_offset;
END $function$
;

-- get_stock_movement_ledger_v4 → get_stock_movement_ledger_v5
CREATE OR REPLACE FUNCTION public.get_stock_movement_ledger_v5(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_section_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_tz        TEXT        := current_setting('TimeZone');
  v_start     TIMESTAMPTZ := (p_start::date)::timestamp           AT TIME ZONE v_tz;
  v_end_excl  TIMESTAMPTZ := ((p_end::date + 1))::timestamp       AT TIME ZONE v_tz;
  v_limit     INT         := LEAST(GREATEST(p_limit, 1), 10000);
  v_lines     JSONB;
  v_count     INT;
  v_total     INT;
  v_activation date;
  v_opening_visible boolean;
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT (has_permission(v_caller_id, 'inventory.read')
          OR has_permission(v_caller_id, 'reports.inventory.read')) THEN
    RAISE EXCEPTION 'Permission denied: inventory.read' USING ERRCODE = '42501';
  END IF;

  SELECT activated_on INTO v_activation FROM business_day_visibility_config WHERE id;
  v_opening_visible := is_business_owner_v1() OR p_start::date <= v_activation OR
    (SELECT count(*) FROM business_day_releases WHERE day >= v_activation AND day < p_start::date)
      = p_start::date - v_activation;

  WITH opening AS (
    SELECT sm.product_id, SUM(sm.quantity) AS opening_qty
    FROM stock_movements sm
    WHERE sm.created_at < v_start
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    GROUP BY sm.product_id
  ),
  in_range AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name                    AS product_name,
      c.name                    AS product_group,
      sm.movement_type::text    AS movement_type,
      sm.quantity,
      sm.unit,
      COALESCE(p.cost_price, 0) AS price,
      sm.reference_type,
      sm.reference_id,
      sm.reason,
      ord.order_number          AS reference_label,
      sm.created_at,
      sm.created_by,
      COALESCE(o.opening_qty, 0)
        + SUM(sm.quantity) OVER (
            PARTITION BY sm.product_id
            ORDER BY sm.created_at, sm.id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS balance_qty
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN reporting_private.closed_pos_orders_v1 ord ON sm.reference_type = 'orders' AND ord.id = sm.reference_id
    LEFT JOIN opening o ON o.product_id = sm.product_id
    WHERE sm.created_at >= v_start
      AND sm.created_at <  v_end_excl
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_section_id    IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    ORDER BY p.name, sm.created_at, sm.id
    LIMIT v_limit + 1
  ),
  numbered AS (
    SELECT ir.*, ROW_NUMBER() OVER (ORDER BY ir.product_name, ir.created_at, ir.id) AS rn
    FROM in_range ir
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              n.id,
        'movement_date',   (n.created_at AT TIME ZONE v_tz)::date,
        'created_time',    n.created_at,
        'movement_type',   n.movement_type,
        'product_id',      n.product_id,
        'product_name',    n.product_name,
        'product_group',   n.product_group,
        'unit',            n.unit,
        'incoming_qty',    GREATEST(n.quantity, 0),
        'outgoing_qty',    GREATEST(-n.quantity, 0),
        'beginning_qty',   CASE WHEN v_opening_visible THEN n.balance_qty - n.quantity ELSE NULL END,
        'balance_qty',     CASE WHEN v_opening_visible THEN n.balance_qty ELSE NULL END,
        'price',           n.price,
        'movement_amount', n.quantity * n.price,
        'reference_type',  n.reference_type,
        'reference_id',    n.reference_id,
        'reason',          n.reason,
        'reference_label', n.reference_label,
        'created_by_name', up.full_name
      ) ORDER BY n.product_name, n.created_at, n.id)
      FILTER (WHERE n.rn <= v_limit),
      '[]'::jsonb
    ),
    COUNT(*) FILTER (WHERE n.rn <= v_limit)::int,
    COUNT(*)::int
  INTO v_lines, v_count, v_total
  FROM numbered n
  LEFT JOIN user_profiles up ON up.id = n.created_by;

  RETURN jsonb_build_object(
    'lines',     v_lines,
    'truncated', v_total > v_limit,
    'row_count', v_count
  );
END;
$function$
;

-- get_stock_movements_v6 → get_stock_movements_v7
CREATE OR REPLACE FUNCTION public.get_stock_movements_v7(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := p_start::date::timestamptz;
  v_end       TIMESTAMPTZ := (p_end::date + 1)::timestamptz;
  v_clamp     INT := LEAST(GREATEST(p_limit, 1), 200);
  v_cursor_ts TIMESTAMPTZ := NULL;
  v_cursor_id UUID := NULL;
  v_lines     JSONB;
  v_last_cur  TEXT;
  v_has_next  BOOLEAN;
  v_next      TEXT;
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  IF p_cursor IS NOT NULL AND p_cursor <> '' THEN
    v_cursor_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(p_cursor, '|', 2)::uuid;
  END IF;

  WITH filtered AS (
    SELECT
      sm.id, sm.product_id, p.name AS product_name,
      sm.movement_type::text AS movement_type,
      sm.quantity, sm.unit_cost, sm.lot_id,
      sm.reference_type, sm.reference_id, sm.created_by, sm.created_at,
      ROW_NUMBER() OVER (ORDER BY sm.created_at DESC, sm.id DESC) AS rn
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.created_at >= v_start AND sm.created_at < v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (v_cursor_ts     IS NULL OR (sm.created_at, sm.id) < (v_cursor_ts, v_cursor_id))
    ORDER BY sm.created_at DESC, sm.id DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(
      jsonb_agg(jsonb_build_object(
        'id',              f.id,
        'product_id',      f.product_id,
        'product_name',    f.product_name,
        'movement_type',   f.movement_type,
        'quantity',        f.quantity,
        'unit_cost',       f.unit_cost,
        'value',           ABS(f.quantity) * COALESCE(f.unit_cost, 0),
        'lot_id',          f.lot_id,
        'reference_type',  f.reference_type,
        'reference_id',    f.reference_id,
        'created_by_name', up.full_name,
        'created_at',      f.created_at
      ) ORDER BY f.created_at DESC, f.id DESC)
      FILTER (WHERE f.rn <= v_clamp),
      '[]'::jsonb
    ),
    MAX(CASE WHEN f.rn = v_clamp
             THEN f.created_at::text || '|' || f.id::text END),
    bool_or(f.rn = v_clamp + 1)
  INTO v_lines, v_last_cur, v_has_next
  FROM filtered f
  LEFT JOIN user_profiles up ON up.id = f.created_by;

  v_next := CASE WHEN COALESCE(v_has_next, FALSE) THEN v_last_cur ELSE NULL END;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next);
END;
$function$
;

-- get_stock_position_v3 → get_stock_position_v4
CREATE OR REPLACE FUNCTION public.get_stock_position_v4(p_as_of date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     text;
  v_today  date;
  v_as_of  date;
  v_result jsonb;
BEGIN
  PERFORM public.assert_stock_visible_v1();

  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'permission denied: reports.inventory.read required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;
  v_as_of := COALESCE(p_as_of, v_today);
  PERFORM public.assert_business_days_visible_v2(v_as_of,v_as_of);

  IF v_as_of > v_today THEN
    RAISE EXCEPTION 'as_of_in_the_future' USING ERRCODE = 'P0001';
  END IF;

  WITH pos AS (
    SELECT
      p.id, p.name, p.sku, p.unit, p.category_id,
      c.name AS category_name,
      COALESCE(p.cost_price, 0)          AS wac,
      COALESCE(p.min_stock_threshold, 0) AS min_threshold,
      p.current_stock
        - COALESCE((SELECT SUM(sm.quantity)
                      FROM stock_movements sm
                     WHERE sm.product_id = p.id
                       AND ((sm.created_at AT TIME ZONE v_tz))::date > v_as_of), 0)
        AS qty
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.deleted_at IS NULL
      AND p.track_inventory
      AND NOT p.is_display_item
  ),
  valued AS (
    SELECT pos.*,
      pos.qty * pos.wac AS value,
      CASE
        WHEN pos.qty < 0                                            THEN 'negative'
        WHEN pos.qty = 0                                            THEN 'at_zero'
        WHEN pos.min_threshold > 0 AND pos.qty < pos.min_threshold  THEN 'below_threshold'
        ELSE 'ok'
      END AS status
    FROM pos
  )
  SELECT jsonb_build_object(
    'as_of',        v_as_of,
    'timezone',     v_tz,
    'generated_at', now(),
    'valuation',    'current_wac',
    'summary', jsonb_build_object(
      'total_value',          COALESCE((SELECT SUM(value) FROM valued), 0),
      'refs_tracked',         (SELECT COUNT(*) FROM valued),
      'refs_in_stock',        (SELECT COUNT(*) FROM valued WHERE qty > 0),
      'refs_at_zero',         (SELECT COUNT(*) FROM valued WHERE status = 'at_zero'),
      'refs_negative',        (SELECT COUNT(*) FROM valued WHERE status = 'negative'),
      'refs_below_threshold', (SELECT COUNT(*) FROM valued WHERE status = 'below_threshold')
    ),
    'by_category', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'category_id',   bc.category_id,
        'category_name', bc.category_name,
        'value',         bc.value,
        'refs',          bc.refs
      ) ORDER BY bc.value DESC)
      FROM (
        SELECT category_id, category_name,
               SUM(value) AS value, COUNT(*) AS refs
        FROM valued
        GROUP BY category_id, category_name
      ) bc
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'product_id',    v.id,
        'name',          v.name,
        'sku',           v.sku,
        'unit',          v.unit,
        'category_name', v.category_name,
        'qty',           v.qty,
        'wac',           v.wac,
        'value',         v.value,
        'min_threshold', v.min_threshold,
        'status',        v.status
      ) ORDER BY v.value DESC, v.name ASC)
      FROM valued v
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$function$
;

-- get_stock_variance_v5 → get_stock_variance_v6
CREATE OR REPLACE FUNCTION public.get_stock_variance_v6(p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(product_id uuid, product_name text, sku text, opening numeric, stock_in numeric, sold numeric, consumed numeric, wasted numeric, corrected numeric, other numeric, closing numeric, current_qty numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_visible_v1();
  IF NOT has_permission(auth.uid(), 'reports.inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v2(COALESCE(p_date_start,now()-interval '30 days')::date,GREATEST(COALESCE(p_date_end,now())::date,current_date));


  RETURN QUERY
  WITH bounds AS (
    SELECT COALESCE(p_date_start, now() - INTERVAL '30 days') AS ws,
           COALESCE(p_date_end,   now())                      AS we
  ),
  tail AS (
    SELECT sm.product_id AS pid,
           SUM(sm.quantity)                                    AS sum_since_start,
           SUM(sm.quantity) FILTER (WHERE sm.created_at > b.we) AS sum_after_end
    FROM stock_movements sm, bounds b
    WHERE sm.created_at >= b.ws
    GROUP BY sm.product_id
  ),
  win AS (
    SELECT sm.product_id AS pid,
      SUM(CASE WHEN sm.movement_type IN ('purchase','incoming','production_in')
               THEN sm.quantity ELSE 0 END) AS w_stock_in,
      SUM(CASE WHEN sm.movement_type IN ('sale','sale_void')
               THEN sm.quantity ELSE 0 END) AS w_sold,
      SUM(CASE WHEN sm.movement_type = 'production_out'
               THEN sm.quantity ELSE 0 END) AS w_consumed,
      SUM(CASE WHEN sm.movement_type = 'waste'
               THEN sm.quantity ELSE 0 END) AS w_wasted,
      SUM(CASE WHEN sm.movement_type IN ('opname_in','opname_out',
                                         'adjustment','adjustment_in','adjustment_out')
               THEN sm.quantity ELSE 0 END) AS w_corrected,
      SUM(CASE WHEN sm.movement_type NOT IN ('purchase','incoming','production_in',
                                             'sale','sale_void','production_out','waste',
                                             'opname_in','opname_out',
                                             'adjustment','adjustment_in','adjustment_out')
               THEN sm.quantity ELSE 0 END) AS w_other
    FROM stock_movements sm, bounds b
    WHERE sm.created_at BETWEEN b.ws AND b.we
    GROUP BY sm.product_id
  )
  SELECT
    p.id, p.name, p.sku,
    (p.current_stock - COALESCE(t.sum_since_start, 0))::DECIMAL(12,3) AS opening,
    COALESCE(w.w_stock_in, 0)::DECIMAL(12,3),
    COALESCE(w.w_sold, 0)::DECIMAL(12,3),
    COALESCE(w.w_consumed, 0)::DECIMAL(12,3),
    COALESCE(w.w_wasted, 0)::DECIMAL(12,3),
    COALESCE(w.w_corrected, 0)::DECIMAL(12,3),
    COALESCE(w.w_other, 0)::DECIMAL(12,3),
    (p.current_stock - COALESCE(t.sum_after_end, 0))::DECIMAL(12,3)   AS closing,
    p.current_stock::DECIMAL(12,3)
  FROM products p
  LEFT JOIN tail t ON t.pid = p.id
  LEFT JOIN win  w ON w.pid = p.id
  WHERE p.deleted_at IS NULL
    AND p.track_inventory = true
    AND (w.pid IS NOT NULL OR p.current_stock <> 0)
  ORDER BY (ABS(COALESCE(w.w_corrected, 0)) + ABS(COALESCE(w.w_wasted, 0))) DESC, p.name ASC;
END;
$function$
;

-- get_general_ledger_v4 → get_general_ledger_v5
CREATE OR REPLACE FUNCTION public.get_general_ledger_v5(p_account_id uuid, p_date_start date, p_date_end date, p_limit integer DEFAULT 50, p_cursor jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines           JSONB;
  v_account         RECORD;
  v_opening_balance NUMERIC(14,2) := 0;
  v_total_debit     NUMERIC(14,2) := 0;
  v_total_credit    NUMERIC(14,2) := 0;
  v_next_cursor     JSONB := NULL;
  v_cursor_date     DATE;
  v_cursor_id       UUID;
  v_count           INT;
BEGIN
  IF NOT public.can_view_stock_v2() AND EXISTS(SELECT 1 FROM public.accounts WHERE id=p_account_id AND code LIKE '114%') THEN RAISE EXCEPTION 'stock_visibility_required' USING ERRCODE='P0003'; END IF;
  IF NOT has_permission(auth.uid(), 'accounting.gl.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.gl.read' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = 'P0001';
  END IF;
  SELECT id, code, name, account_class, balance_type, is_active
    INTO v_account FROM accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT COALESCE(SUM(
      CASE v_account.balance_type
        WHEN 'debit'  THEN (jel.debit - jel.credit)
        ELSE              (jel.credit - jel.debit)
      END), 0)
  INTO v_opening_balance
  FROM reporting_private.safe_detail_journal_lines_v1 jel
  JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
    AND je.entry_date < p_date_start
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  IF p_cursor IS NOT NULL THEN
    v_cursor_date := (p_cursor->>'last_date')::DATE;
    v_cursor_id   := (p_cursor->>'last_id')::UUID;
  END IF;
  WITH paged AS (
    SELECT je.id AS je_id, je.entry_number, je.entry_date, je.description AS je_description,
      je.reference_type, je.reference_id, jel.debit, jel.credit, jel.description AS line_description
    FROM reporting_private.safe_detail_journal_lines_v1 jel
    JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
      AND (v_cursor_date IS NULL OR (je.entry_date, je.id) > (v_cursor_date, v_cursor_id))
    ORDER BY je.entry_date ASC, je.id ASC LIMIT p_limit + 1
  )
  SELECT COALESCE(jsonb_agg(
      jsonb_build_object('je_id', je_id, 'entry_number', entry_number, 'entry_date', entry_date,
        'description', je_description, 'reference_type', reference_type, 'reference_id', reference_id,
        'debit', debit, 'credit', credit, 'line_description', line_description)
      ORDER BY entry_date ASC, je_id ASC) FILTER (WHERE TRUE), '[]'::JSONB), COUNT(*)::INT
  INTO v_lines, v_count
  FROM (SELECT * FROM paged LIMIT p_limit) windowed;
  IF v_count >= p_limit AND EXISTS (
    SELECT 1 FROM reporting_private.safe_detail_journal_lines_v1 jel
    JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
      AND (v_cursor_date IS NULL OR (je.entry_date, je.id) > (v_cursor_date, v_cursor_id))
    OFFSET p_limit LIMIT 1
  ) THEN
    SELECT jsonb_build_object('last_date', entry_date, 'last_id', je_id)
      INTO v_next_cursor
      FROM jsonb_to_recordset(v_lines) AS x(je_id UUID, entry_date DATE)
      ORDER BY entry_date DESC, je_id DESC LIMIT 1;
  END IF;
  SELECT COALESCE(SUM(jel.debit), 0), COALESCE(SUM(jel.credit), 0)
  INTO v_total_debit, v_total_credit
  FROM reporting_private.safe_detail_journal_lines_v1 jel
  JOIN reporting_private.safe_detail_journal_entries_v1 je ON je.id = jel.journal_entry_id
  WHERE jel.account_id = p_account_id AND je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.safe_detail_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  RETURN jsonb_build_object(
    'account', jsonb_build_object('id', v_account.id, 'code', v_account.code, 'name', v_account.name,
      'account_class', v_account.account_class, 'balance_type', v_account.balance_type, 'is_active', v_account.is_active),
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'opening_balance', v_opening_balance, 'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'lines', v_lines, 'next_cursor', v_next_cursor);
END; $function$
;

-- get_dashboard_overview_v7 → get_dashboard_overview_v8
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v8()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_today  DATE;
  v_kpis   JSONB;
  v_rev    JSONB;
  v_hourly JSONB;
  v_sp     JSONB;
  v_cost   JSONB;
BEGIN
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission denied: reports.read required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  v_kpis   := _dashboard_kpis_v3(v_tz, v_today);
  v_rev    := _dashboard_revenue_series_v2(v_tz, v_today);
  v_hourly := _dashboard_hourly_v2(v_tz, v_today);
  v_sp     := _dashboard_share_payments_v4(v_tz, v_today);

  IF public.can_view_stock_v2() AND has_permission(auth.uid(), 'reports.financial.read') THEN
    v_cost := _dashboard_cost_mtd_v3(v_tz, v_today);
  ELSE
    v_kpis := jsonb_set(v_kpis, '{gross_margin}', jsonb_build_object(
      'restricted', TRUE, 'value', NULL, 'vs_yesterday_pt', NULL,
      'vs_d7_pt', NULL, 'basis', NULL, 'cost_coverage_pct', NULL));
    v_cost := jsonb_build_object(
      'restricted', TRUE, 'cogs_total', NULL, 'opex_total', NULL,
      'sales_mtd', NULL, 'cogs_pct_of_sales', NULL, 'opex_pct_of_sales', NULL,
      'total', NULL, 'cost_per_basket', NULL, 'lines', '[]'::jsonb);
  END IF;

  IF has_permission(auth.uid(), 'accounting.cash.read') THEN
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}', _dashboard_cash_on_hand_v2());
  ELSE
    v_kpis := jsonb_set(v_kpis, '{cash_on_hand}',
                jsonb_build_object('value', NULL, 'restricted', TRUE,
                                   'wallets', '[]'::jsonb));
  END IF;

  RETURN jsonb_build_object(
    'kpis',                v_kpis,
    'revenue_30d',         v_rev    -> 'series',
    'revenue_30d_summary', v_rev    -> 'summary',
    'hourly_sales',        v_hourly -> 'series',
    'hourly_peak',         v_hourly -> 'peak',
    'revenue_share',       v_sp     -> 'revenue_share',
    'payments',            v_sp     -> 'payments',
    'cost_mtd',            v_cost,
    'generated_at',        now()
  );
END;
$function$
;

-- recipe_bom_full_v5 → recipe_bom_full_v6
CREATE OR REPLACE FUNCTION public.recipe_bom_full_v6(p_product_id uuid, p_max_depth integer DEFAULT 5)
 RETURNS TABLE(material_id uuid, material_name text, material_unit text, recipe_unit text, qty_per_unit numeric, current_stock numeric, cost_price numeric, qty_in_base numeric, line_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity::NUMERIC      AS qty,
           r.unit          AS line_unit,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path,
           COALESCE(m.track_inventory, TRUE) AS is_stocked
      FROM recipes r
      JOIN products m ON m.id = r.material_id
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT w.root_id,
           r.material_id,
           (public.convert_quantity(w.qty, w.line_unit, parent.unit) * r.quantity::NUMERIC),
           r.unit,
           w.depth + 1,
           w.path || r.material_id,
           COALESCE(m.track_inventory, TRUE)
      FROM walk w
      JOIN products parent ON parent.id = w.material_id
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
      JOIN products m ON m.id = r.material_id
     WHERE w.depth < p_max_depth
       AND w.is_stocked = FALSE
       AND NOT (r.material_id = ANY(w.path))
  ),
  leaf_paths AS (
    SELECT w.material_id, w.qty, w.line_unit, p.unit AS stock_unit,
           MIN(w.line_unit) OVER (PARTITION BY w.material_id) AS output_unit
      FROM walk w
      JOIN products p ON p.id = w.material_id
     WHERE w.is_stocked = TRUE
        OR NOT EXISTS (
             SELECT 1 FROM recipes c
              WHERE c.product_id = w.material_id
                AND c.is_active = TRUE
                AND c.deleted_at IS NULL
           )
  ),
  normalized AS (
    SELECT l.material_id, l.output_unit,
           public.convert_quantity(l.qty, l.line_unit, l.output_unit) AS qty_output,
           public.convert_quantity(l.qty, l.line_unit, l.stock_unit) AS qty_base
      FROM leaf_paths l
  ),
  leaves AS (
    SELECT n.material_id, n.output_unit AS recipe_unit,
           SUM(n.qty_output) AS qty_agg,
           SUM(n.qty_base) AS qty_base
      FROM normalized n
     GROUP BY n.material_id, n.output_unit
  )
  SELECT l.material_id,
         p.name,
         p.unit,
         l.recipe_unit,
         l.qty_agg,
         CASE WHEN public.can_view_stock_v2() THEN p.current_stock ELSE NULL::numeric END,
         p.cost_price,
         l.qty_base,
         l.qty_base * COALESCE(p.cost_price, 0) AS line_cost
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $function$
;

-- recipe_direct_cost_v3 → recipe_direct_cost_v4
CREATE OR REPLACE FUNCTION public.recipe_direct_cost_v4(p_product_id uuid)
 RETURNS TABLE(material_id uuid, material_name text, material_unit text, recipe_unit text, qty_per_unit numeric, current_stock numeric, cost_price numeric, qty_in_base numeric, line_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT r.material_id,
         m.name,
         m.unit,
         r.unit,
         r.quantity::NUMERIC,
         CASE WHEN public.can_view_stock_v2() THEN m.current_stock ELSE NULL::numeric END,
         m.cost_price,
         public._try_convert_quantity(r.quantity::NUMERIC, r.unit, m.unit) AS qty_in_base,
         public._try_convert_quantity(r.quantity::NUMERIC, r.unit, m.unit) * COALESCE(m.cost_price, 0) AS line_cost
    FROM recipes r
    JOIN products m ON m.id = r.material_id
   WHERE r.product_id = p_product_id
     AND r.is_active = TRUE
     AND r.deleted_at IS NULL
   ORDER BY r.display_order, m.name;
END $function$
;

-- search_ingredients_v3 → search_ingredients_v4
CREATE OR REPLACE FUNCTION public.search_ingredients_v4(p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(product_id uuid, sku text, name text, unit text, cost_price numeric, current_stock numeric, kind text, has_recipe boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     UUID := auth.uid();
  v_query   TEXT := COALESCE(trim(p_query), '');
  v_kind    TEXT := COALESCE(p_kind, 'all');
  v_limit   INT  := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
  v_like    TEXT;
  v_prefix  TEXT;
  v_lower_q TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF v_kind NOT IN ('raw', 'semi_finished', 'sub_recipe', 'all') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'P0001',
      DETAIL = 'p_kind must be one of: raw, semi_finished, sub_recipe, all.';
  END IF;

  v_lower_q := lower(v_query);
  v_like    := '%' || v_lower_q || '%';
  v_prefix  := v_lower_q || '%';

  RETURN QUERY
  WITH base AS (
    SELECT
      p.id              AS product_id,
      p.sku             AS sku,
      p.name            AS name,
      p.unit            AS unit,
      p.cost_price      AS cost_price,
      CASE WHEN public.can_view_stock_v2() THEN p.current_stock ELSE NULL::numeric END   AS current_stock,
      p.is_semi_finished AS is_semi,
      EXISTS (
        SELECT 1 FROM recipes r
         WHERE r.product_id = p.id
           AND r.is_active = TRUE
           AND r.deleted_at IS NULL
      ) AS has_recipe
    FROM products p
    WHERE p.is_active = TRUE
      AND p.deleted_at IS NULL
  ),
  classified AS (
    SELECT
      b.*,
      CASE
        WHEN b.is_semi    THEN 'semi_finished'
        WHEN b.has_recipe THEN 'sub_recipe'
        ELSE                   'raw'
      END AS kind
    FROM base b
  ),
  scored AS (
    SELECT
      c.*,
      CASE
        WHEN v_query = ''                                 THEN 0.0
        ELSE GREATEST(
          similarity(c.name, v_query),
          similarity(c.sku,  v_query)
        )
      END AS sim_score
    FROM classified c
  ),
  filtered AS (
    SELECT *
      FROM scored s
     WHERE (v_kind = 'all' OR s.kind = v_kind)
       AND (
         v_query = ''
         OR lower(s.name) LIKE v_like
         OR lower(s.sku)  LIKE v_like
         OR s.sim_score >= 0.3
       )
  ),
  ranked AS (
    SELECT
      f.*,
      CASE
        WHEN v_query = ''                       THEN 4
        WHEN lower(f.name) = v_lower_q
          OR lower(f.sku)  = v_lower_q          THEN 0
        WHEN lower(f.name) LIKE v_prefix
          OR lower(f.sku)  LIKE v_prefix        THEN 1
        WHEN lower(f.name) LIKE v_like
          OR lower(f.sku)  LIKE v_like          THEN 2
        ELSE                                         3
      END AS rank
    FROM filtered f
  )
  SELECT
    r.product_id, r.sku, r.name, r.unit, r.cost_price, r.current_stock,
    r.kind, r.has_recipe
  FROM ranked r
  ORDER BY r.rank ASC, r.sim_score DESC, r.name ASC
  LIMIT v_limit;
END $function$
;

-- get_dashboard_action_queue_v3 → get_dashboard_action_queue_v4
CREATE OR REPLACE FUNCTION public.get_dashboard_action_queue_v4()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_tz    TEXT;
  v_today DATE;
  v_items JSONB := '[]'::jsonb;
  v_n     INT;
  v_date  DATE;
  v_days  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'permission denied: authentication required'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;
  v_today := (now() AT TIME ZONE v_tz)::date;

  IF has_permission(v_uid, 'zreports.read') THEN
    SELECT COUNT(*)::INT, MIN(((s.opened_at AT TIME ZONE v_tz))::date)
      INTO v_n, v_date
      FROM reporting_private.closed_pos_sessions_v1 s
     WHERE s.status = 'open'
       AND ((s.opened_at AT TIME ZONE v_tz))::date < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'register_not_closed', 'severity', 'blocking', 'count', v_n,
        'label', CASE WHEN v_n = 1
                      THEN 'Register not closed - ' || to_char(v_date, 'DD Mon')
                      ELSE v_n || ' registers not closed since ' || to_char(v_date, 'DD Mon') END,
        'action', 'Reconcile', 'to', '/backoffice/cash-register/zreports');
    END IF;
  END IF;

  IF has_permission(v_uid, 'inventory.read') AND public.can_view_stock_v2() THEN
    SELECT COUNT(*)::INT INTO v_n FROM get_low_stock_v5();
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'low_stock', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below minimum stock',
        'action', 'Review', 'to', '/backoffice/inventory/alerts');
    END IF;

    SELECT COUNT(*)::INT INTO v_n FROM get_reorder_suggestions_v4(30, 14);
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'reorder', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' item' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' below reorder point',
        'action', 'Create PO', 'to', '/backoffice/purchasing/purchase-orders/new');
    END IF;
  END IF;

  IF has_permission(v_uid, 'purchasing.po.read') THEN
    SELECT COUNT(*)::INT INTO v_n
      FROM purchase_orders po
     WHERE po.status IN ('pending', 'partial')
       AND po.deleted_at IS NULL;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'po_awaiting_receipt', 'severity', 'info', 'count', v_n,
        'label', v_n || ' PO' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' awaiting receipt',
        'action', 'Receive', 'to', '/backoffice/purchasing/purchase-orders');
    END IF;
  END IF;

  IF has_permission(v_uid, 'b2b.read') THEN
    SELECT COUNT(*)::INT,
           MAX(v_today - (((o.created_at AT TIME ZONE v_tz))::date
               + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30)))
      INTO v_n, v_days
      FROM reporting_private.closed_pos_orders_v1 o
      JOIN customers c ON c.id = o.customer_id
      LEFT JOIN b2b_settings bs ON TRUE
     WHERE o.order_type = 'b2b'
       AND o.status = 'b2b_pending'
       AND o.voided_at IS NULL
       AND ((o.created_at AT TIME ZONE v_tz))::date
           + COALESCE(c.b2b_payment_terms_days, bs.default_payment_terms, 30) < v_today;
    IF v_n > 0 THEN
      v_items := v_items || jsonb_build_object(
        'key', 'b2b_overdue', 'severity', 'warning', 'count', v_n,
        'label', v_n || ' B2B invoice' || CASE WHEN v_n > 1 THEN 's' ELSE '' END
                 || ' overdue - up to ' || v_days || ' d',
        'action', 'Open', 'to', '/backoffice/b2b/payments');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE((SELECT SUM((i->>'count')::INT)
                         FROM jsonb_array_elements(v_items) i), 0)::INT,
    'generated_at', now()
  );
END;
$function$
;

-- ── États financiers : reports.statements.read ───────────────────────

-- get_balance_sheet_v5 → get_balance_sheet_v6
CREATE OR REPLACE FUNCTION public.get_balance_sheet_v6(p_as_of_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assets_cash NUMERIC(14,2):=0; v_assets_ar NUMERIC(14,2):=0; v_assets_inv NUMERIC(14,2):=0; v_assets_other NUMERIC(14,2):=0;
  v_assets_current NUMERIC(14,2):=0; v_assets_fixed NUMERIC(14,2):=0; v_assets_total NUMERIC(14,2):=0;
  v_liab_ap NUMERIC(14,2):=0; v_liab_tax NUMERIC(14,2):=0; v_liab_loyalty NUMERIC(14,2):=0; v_liab_other NUMERIC(14,2):=0;
  v_liab_current NUMERIC(14,2):=0; v_liab_long NUMERIC(14,2):=0; v_liab_total NUMERIC(14,2):=0;
  v_eq_capital NUMERIC(14,2):=0; v_eq_retained NUMERIC(14,2):=0; v_eq_other NUMERIC(14,2):=0; v_eq_total NUMERIC(14,2):=0;
  v_cye_revenue NUMERIC(14,2):=0; v_cye_cogs NUMERIC(14,2):=0; v_cye_opex NUMERIC(14,2):=0; v_cye NUMERIC(14,2):=0;
  v_ytd_start DATE; v_delta NUMERIC(14,2):=0; v_balanced BOOLEAN:=FALSE; v_lines JSONB := '[]'::JSONB;
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'get_balance_sheet_v6: p_as_of_date is required';
  END IF;
  v_ytd_start := date_trunc('year', p_as_of_date::TIMESTAMP)::DATE;
  WITH agg AS (
    SELECT a.id AS account_id, a.code, a.name, a.account_class, a.balance_type,
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2) AS d, SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS c
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.status IN ('posted','locked') AND je.entry_date <= p_as_of_date AND a.account_class IN (1, 2, 3)
      AND NOT (je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '111%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '113%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '114%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code NOT LIKE '111%' AND code NOT LIKE '113%'
                       AND code NOT LIKE '114%' AND code NOT LIKE '16%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 1 AND code LIKE '16%' THEN (d - c) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2141') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code IN ('2110','2142','2143') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code = '2210' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 2 AND code NOT IN ('2141','2110','2142','2143','2210') THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code = '3100' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code LIKE '32%' THEN (c - d) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 3 AND code NOT IN ('3100','3300') AND code NOT LIKE '32%' THEN (c - d) END), 0),
    COALESCE(jsonb_agg(jsonb_build_object('account_id', account_id, 'code', code, 'name', name, 'debit', d, 'credit', c,
      'balance', CASE WHEN balance_type = 'debit' THEN (d - c) ELSE (c - d) END, 'account_class', account_class)
      ORDER BY code) FILTER (WHERE d <> 0 OR c <> 0), '[]'::JSONB)
  INTO v_assets_cash, v_assets_ar, v_assets_inv, v_assets_other, v_assets_fixed, v_liab_ap, v_liab_tax, v_liab_loyalty, v_liab_other,
    v_eq_capital, v_eq_retained, v_eq_other, v_lines
  FROM agg;
  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0)
  INTO v_cye_revenue, v_cye_cogs, v_cye_opex
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked') AND je.entry_date BETWEEN v_ytd_start AND p_as_of_date
    AND a.account_class IN (4, 5, 6)
    AND NOT (je.reference_type = 'sale_void'
      AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));
  v_cye := (v_cye_revenue - v_cye_cogs - v_cye_opex)::NUMERIC(14,2);
  v_assets_current := (v_assets_cash + v_assets_ar + v_assets_inv + v_assets_other)::NUMERIC(14,2);
  v_assets_total := (v_assets_current + v_assets_fixed)::NUMERIC(14,2);
  v_liab_current := (v_liab_ap + v_liab_tax + v_liab_loyalty + v_liab_other)::NUMERIC(14,2);
  v_liab_total := (v_liab_current + v_liab_long)::NUMERIC(14,2);
  v_eq_total := (v_eq_capital + v_eq_retained + v_eq_other + v_cye)::NUMERIC(14,2);
  v_delta := (v_assets_total - (v_liab_total + v_eq_total))::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;
  RETURN jsonb_build_object(
    'assets', jsonb_build_object('current', jsonb_build_object('cash', v_assets_cash, 'ar', v_assets_ar,
      'inventory', v_assets_inv, 'other', v_assets_other, 'total', v_assets_current),
      'fixed', jsonb_build_object('total', v_assets_fixed), 'total', v_assets_total),
    'liabilities', jsonb_build_object('current', jsonb_build_object('ap', v_liab_ap, 'tax_payable', v_liab_tax,
      'loyalty', v_liab_loyalty, 'other', v_liab_other, 'total', v_liab_current),
      'long_term', jsonb_build_object('total', v_liab_long), 'total', v_liab_total),
    'equity', jsonb_build_object('share_capital', v_eq_capital, 'retained_earnings', v_eq_retained,
      'current_year_earnings', v_cye, 'other', v_eq_other, 'total', v_eq_total),
    'balanced', v_balanced, 'delta', v_delta, 'as_of', p_as_of_date, 'lines', v_lines);
END; $function$;

-- get_cash_flow_v4 → get_cash_flow_v5
CREATE OR REPLACE FUNCTION public.get_cash_flow_v5(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_net_profit       NUMERIC(14,2) := 0;
  v_revenue          NUMERIC(14,2) := 0;
  v_cogs             NUMERIC(14,2) := 0;
  v_opex             NUMERIC(14,2) := 0;
  v_delta_ar         NUMERIC(14,2) := 0;
  v_delta_ap         NUMERIC(14,2) := 0;
  v_delta_inv        NUMERIC(14,2) := 0;
  v_other            NUMERIC(14,2) := 0;
  v_operating_total  NUMERIC(14,2) := 0;
  v_investing_total  NUMERIC(14,2) := 0;
  v_financing_total  NUMERIC(14,2) := 0;
  v_cash_start       NUMERIC(14,2) := 0;
  v_cash_end         NUMERIC(14,2) := 0;
  v_net_change       NUMERIC(14,2) := 0;
  v_prior_end        DATE;
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read required'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_cash_flow_v3: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  v_prior_end := (p_date_start - INTERVAL '1 day')::DATE;

  SELECT
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'operating' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'investing' THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.cash_flow_section = 'financing' THEN (jel.credit - jel.debit) END), 0)
  INTO v_operating_total, v_investing_total, v_financing_total
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end
    AND a.cash_flow_section <> 'none';

  SELECT
    COALESCE(SUM(CASE WHEN a.account_class = 4 THEN (jel.credit - jel.debit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 5 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.account_class = 6 THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '113%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code LIKE '114%' THEN -(jel.debit - jel.credit) END), 0),
    COALESCE(SUM(CASE WHEN a.code = '2141'    THEN  (jel.credit - jel.debit) END), 0)
  INTO v_revenue, v_cogs, v_opex, v_delta_ar, v_delta_inv, v_delta_ap
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date BETWEEN p_date_start AND p_date_end;

  v_net_profit := (v_revenue - v_cogs - v_opex)::NUMERIC(14,2);

  v_other := (v_operating_total
              - (v_net_profit + v_delta_ar + v_delta_ap + v_delta_inv))::NUMERIC(14,2);

  SELECT
    COALESCE(SUM(CASE WHEN je.entry_date <= v_prior_end THEN (jel.debit - jel.credit) END), 0),
    COALESCE(SUM(jel.debit - jel.credit), 0)
  INTO v_cash_start, v_cash_end
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
  JOIN accounts a         ON a.id = jel.account_id
  WHERE je.status IN ('posted','locked')
    AND je.entry_date <= p_date_end
    AND a.cash_flow_section = 'none';

  v_net_change := (v_operating_total + v_investing_total + v_financing_total)::NUMERIC(14,2);

  RETURN jsonb_build_object(
    'operating', jsonb_build_object(
      'net_profit',           v_net_profit,
      'delta_ar',             v_delta_ar,
      'delta_ap',             v_delta_ap,
      'delta_inventory',      v_delta_inv,
      'non_cash_adjustments', v_other,
      'total',                v_operating_total
    ),
    'investing', jsonb_build_object('total', v_investing_total),
    'financing', jsonb_build_object('total', v_financing_total),
    'net_change_in_cash', v_net_change,
    'cash_start',         v_cash_start,
    'cash_end',           v_cash_end,
    'period', jsonb_build_object(
      'start', p_date_start,
      'end',   p_date_end
    )
  );
END;
$function$
;

-- get_cash_wallet_ledger_v4 → get_cash_wallet_ledger_v5
CREATE OR REPLACE FUNCTION public.get_cash_wallet_ledger_v5(p_account_code text, p_date_start date, p_date_end date)
 RETURNS TABLE(row_date date, remark text, category text, description text, supplier text, in_amount numeric, out_amount numeric, saldo numeric, ref_type text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acc_id  UUID;
  v_opening NUMERIC;
BEGIN
  IF p_account_code IS NULL OR p_account_code NOT LIKE '111%' THEN
    PERFORM public.assert_statements_visible_v1();
    IF p_account_code LIKE '114%' THEN PERFORM public.assert_stock_visible_v1(); END IF;
  END IF;
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_acc_id FROM accounts WHERE code = p_account_code;
  IF v_acc_id IS NULL THEN
    RAISE EXCEPTION 'unknown account code %', p_account_code USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(jel.debit - jel.credit), 0) INTO v_opening
  FROM reporting_private.closed_shift_journal_lines_v1 jel
  JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE jel.account_id = v_acc_id AND je.entry_date < p_date_start;

  RETURN QUERY
  WITH raw AS (
    SELECT je.entry_date AS d,
           'Shift ' || dense_rank() OVER (
              PARTITION BY je.entry_date ORDER BY MIN(s.opened_at)
           )::text AS rmk,
           NULL::text AS cat, NULL::text AS descr, NULL::text AS sup,
           SUM(jel.debit) AS in_amt, SUM(jel.credit) AS out_amt,
           'sale'::text AS rt, 1 AS grp
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    JOIN orders o          ON je.reference_type = 'sale' AND je.reference_id = o.id
    LEFT JOIN pos_sessions s ON s.id = o.session_id
    WHERE p_account_code = '1110'
      AND jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
    GROUP BY je.entry_date, o.session_id

    UNION ALL

    SELECT je.entry_date AS d,
           COALESCE(jel.description, je.description) AS rmk,
           ec.name AS cat,
           ex.description AS descr,
           COALESCE(ex.vendor_name, sup.name) AS sup,
           jel.debit AS in_amt, jel.credit AS out_amt,
           je.reference_type AS rt, 0 AS grp
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id AND je.status = 'posted'
    LEFT JOIN expenses ex            ON je.reference_type = 'expense'          AND je.reference_id = ex.id
    LEFT JOIN expense_categories ec  ON ec.id = ex.category_id
    LEFT JOIN purchase_payments pp   ON je.reference_type = 'purchase_payment' AND je.reference_id = pp.id
    LEFT JOIN purchase_orders po     ON po.id = pp.purchase_order_id
    LEFT JOIN suppliers sup          ON sup.id = po.supplier_id
    WHERE jel.account_id = v_acc_id
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND NOT (p_account_code = '1110' AND je.reference_type = 'sale')
  ),
  ordered AS (
    SELECT d, rmk, cat, descr, sup, in_amt, out_amt, rt,
           row_number() OVER (ORDER BY d, grp DESC, rmk) AS rn
    FROM raw
  )
  SELECT o.d, o.rmk, o.cat, o.descr, o.sup, o.in_amt, o.out_amt,
         v_opening + SUM(o.in_amt - o.out_amt) OVER (ORDER BY o.rn
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS saldo,
         o.rt
  FROM ordered o
  ORDER BY o.rn;
END $function$
;

-- get_profit_loss_v4 → get_profit_loss_v5
CREATE OR REPLACE FUNCTION public.get_profit_loss_v5(p_date_start date, p_date_end date, p_section_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_revenue        NUMERIC(14,2) := 0;
  v_revenue_sales  NUMERIC(14,2) := 0;
  v_revenue_disc   NUMERIC(14,2) := 0;
  v_revenue_adj    NUMERIC(14,2) := 0;
  v_cogs           NUMERIC(14,2) := 0;
  v_cogs_prod      NUMERIC(14,2) := 0;
  v_cogs_waste     NUMERIC(14,2) := 0;
  v_cogs_other     NUMERIC(14,2) := 0;
  v_opex           NUMERIC(14,2) := 0;
  v_opex_salary    NUMERIC(14,2) := 0;
  v_opex_rent      NUMERIC(14,2) := 0;
  v_opex_util      NUMERIC(14,2) := 0;
  v_opex_supplies  NUMERIC(14,2) := 0;
  v_opex_marketing NUMERIC(14,2) := 0;
  v_opex_maint     NUMERIC(14,2) := 0;
  v_opex_other     NUMERIC(14,2) := 0;
  v_lines          JSONB         := '[]'::JSONB;
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF NOT has_permission(auth.uid(), 'reports.financial.read') THEN
    RAISE EXCEPTION 'permission denied: reports.financial.read'
      USING ERRCODE = '42501';
  END IF;

  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'get_profit_loss_v3: p_date_start and p_date_end are required';
  END IF;
  IF p_date_start > p_date_end THEN
    RAISE EXCEPTION 'get_profit_loss_v3: p_date_start (%) must be <= p_date_end (%)',
      p_date_start, p_date_end;
  END IF;

  WITH agg AS (
    SELECT
      a.id            AS account_id,
      a.code          AS code,
      a.name          AS name,
      a.account_class AS account_class,
      a.balance_type  AS balance_type,
      SUM(COALESCE(jel.debit,  0))::NUMERIC(14,2) AS total_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS total_credit
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    JOIN accounts a         ON a.id = jel.account_id
    WHERE je.status IN ('posted', 'locked')
      AND je.entry_date BETWEEN p_date_start AND p_date_end
      AND a.account_class IN (4, 5, 6)
      AND je.reference_type IS DISTINCT FROM 'year_close'
      AND NOT (
        je.reference_type = 'sale_void'
        AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id)
      )
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '41%'  THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code IN ('4190','4900') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '45%'  THEN (total_credit - total_debit) END), 0)
      + COALESCE(SUM(CASE WHEN account_class = 4 AND code LIKE '49%' AND code NOT IN ('4900','4190') THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 4 THEN (total_credit - total_debit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '51%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 AND code NOT LIKE '51%' AND code NOT LIKE '52%' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 5 THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6111' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6112' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6113' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6114' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6115' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code = '6116' THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 AND code NOT IN ('6111','6112','6113','6114','6115','6116') THEN (total_debit - total_credit) END), 0),
    COALESCE(SUM(CASE WHEN account_class = 6 THEN (total_debit - total_credit) END), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_id',    account_id,
          'code',          code,
          'name',          name,
          'debit',         total_debit,
          'credit',        total_credit,
          'balance',
            CASE
              WHEN balance_type = 'debit'  THEN (total_debit  - total_credit)
              ELSE                              (total_credit - total_debit)
            END,
          'account_class', account_class
        )
        ORDER BY code
      ) FILTER (WHERE total_debit <> 0 OR total_credit <> 0),
      '[]'::JSONB
    )
  INTO
    v_revenue_sales, v_revenue_disc, v_revenue_adj, v_revenue,
    v_cogs_prod, v_cogs_waste, v_cogs_other, v_cogs,
    v_opex_salary, v_opex_rent, v_opex_util, v_opex_supplies,
    v_opex_marketing, v_opex_maint, v_opex_other, v_opex,
    v_lines
  FROM agg;

  RETURN jsonb_build_object(
    'revenue', jsonb_build_object(
      'sales',       v_revenue_sales,
      'discounts',   v_revenue_disc,
      'adjustments', v_revenue_adj,
      'total',       v_revenue
    ),
    'cogs', jsonb_build_object(
      'production', v_cogs_prod,
      'waste',      v_cogs_waste,
      'other',      v_cogs_other,
      'total',      v_cogs
    ),
    'gross_profit',    (v_revenue - v_cogs)::NUMERIC(14,2),
    'opex', jsonb_build_object(
      'salary',      v_opex_salary,
      'rent',        v_opex_rent,
      'utilities',   v_opex_util,
      'supplies',    v_opex_supplies,
      'marketing',   v_opex_marketing,
      'maintenance', v_opex_maint,
      'other',       v_opex_other,
      'total',       v_opex
    ),
    'operating_profit', (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'net_profit',       (v_revenue - v_cogs - v_opex)::NUMERIC(14,2),
    'lines',  v_lines,
    'period', jsonb_build_object(
      'start',      p_date_start,
      'end',        p_date_end,
      'section_id', p_section_id
    )
  );
END;
$function$
;

-- get_trial_balance_v5 → get_trial_balance_v6
CREATE OR REPLACE FUNCTION public.get_trial_balance_v6(p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines JSONB; v_total_debit NUMERIC(14,2); v_total_credit NUMERIC(14,2);
  v_balanced BOOLEAN; v_delta NUMERIC(14,2);
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF NOT has_permission(auth.uid(), 'accounting.tb.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.tb.read' USING ERRCODE = '42501';
  END IF;
  IF p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  WITH agg AS (
    SELECT a.id, a.code, a.name, a.account_class, a.balance_type,
      -- Période [start, end] — year_close exclue (écriture technique de clôture ;
      -- JE entière toutes classes → l'invariant Σ débit = Σ crédit reste vrai)
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS per_debit,
      SUM(CASE WHEN je.entry_date BETWEEN p_date_start AND p_date_end
                AND je.reference_type IS DISTINCT FROM 'year_close'
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS per_credit,
      -- Ouverture (cumul strictement avant start — year_close INCLUSE : 3200 porte
      -- le report, les 4/5/6 rouvrent à 0)
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.debit, 0) ELSE 0 END)::NUMERIC(14,2)  AS open_debit,
      SUM(CASE WHEN je.entry_date < p_date_start
               THEN COALESCE(jel.credit, 0) ELSE 0 END)::NUMERIC(14,2) AS open_credit,
      -- Cumul as-of end (= ouverture + période — year_close INCLUSE)
      SUM(COALESCE(jel.debit, 0))::NUMERIC(14,2)  AS cum_debit,
      SUM(COALESCE(jel.credit, 0))::NUMERIC(14,2) AS cum_credit
    FROM accounts a
    LEFT JOIN (
      journal_entry_lines jel
      JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
        AND je.status IN ('posted','locked')
        AND je.entry_date <= p_date_end
        AND NOT (je.reference_type = 'sale_void'
          AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN refunds rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id))
    ) ON jel.account_id = a.id
    WHERE a.is_active = TRUE
    GROUP BY a.id, a.code, a.name, a.account_class, a.balance_type
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'account_id', id, 'code', code, 'name', name, 'account_class', account_class,
        'balance_type', balance_type,
        -- Colonnes Débit/Crédit affichées = mouvements de période (compat v2)
        'total_debit', per_debit, 'total_credit', per_credit,
        -- Solde d'ouverture signé (cumul < start)
        'opening_balance', CASE balance_type WHEN 'debit' THEN (open_debit - open_credit)
                                             ELSE (open_credit - open_debit) END,
        -- Solde : permanents (1/2/3) = cumul as-of end ; résultat (4/5/6) = net de période
        'balance', CASE
          WHEN account_class IN (1,2,3) THEN
            CASE balance_type WHEN 'debit' THEN (cum_debit - cum_credit)
                              ELSE (cum_credit - cum_debit) END
          ELSE
            CASE balance_type WHEN 'debit' THEN (per_debit - per_credit)
                              ELSE (per_credit - per_debit) END
        END)
      ORDER BY code)
      FILTER (WHERE per_debit <> 0 OR per_credit <> 0
              OR (account_class IN (1,2,3) AND (cum_debit <> 0 OR cum_credit <> 0))),
      '[]'::JSONB),
    -- Totaux + invariant : mouvements de période (s'équilibrent toujours)
    COALESCE(SUM(per_debit), 0), COALESCE(SUM(per_credit), 0)
  INTO v_lines, v_total_debit, v_total_credit FROM agg;

  v_delta := (v_total_debit - v_total_credit)::NUMERIC(14,2);
  v_balanced := ABS(v_delta) < 0.01;

  RETURN jsonb_build_object(
    'period', jsonb_build_object('start', p_date_start, 'end', p_date_end),
    'lines', v_lines, 'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'balanced', v_balanced, 'delta', v_delta);
END; $function$
;

-- get_gross_margin_by_product_v5 → get_gross_margin_by_product_v6
CREATE OR REPLACE FUNCTION public.get_gross_margin_by_product_v6(p_start_date text, p_end_date text, p_category_id uuid DEFAULT NULL::uuid)
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
  PERFORM public.assert_statements_visible_v1();
  PERFORM public.assert_business_days_visible_v2(p_start_date::date,p_end_date::date);
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
    FROM reporting_private.closed_order_items_v1 oi
    JOIN reporting_private.recognized_sales_v2 o    ON o.id = oi.order_id
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
$function$;

-- calculate_pb1_payable_v5 → calculate_pb1_payable_v6
CREATE OR REPLACE FUNCTION public.calculate_pb1_payable_v6(p_period_start date, p_period_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id   UUID := auth.uid();
  v_pb1_id      UUID;
  v_pb1_output  DECIMAL(14,2);
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;

  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'period_required' USING ERRCODE = 'P0002';
  END IF;
  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'period_end_before_start' USING ERRCODE = 'check_violation';
  END IF;

  v_pb1_id := resolve_mapping_account('SALE_PB1_TAX');

  -- PB1 output = Σ credits on 2110 over period − Σ debits (reversals on voids/refunds).
  -- Dédup (S50 Vague 2a-i) : exclure la JE sale_void quand un refund existe pour le
  -- même order — sinon void + refund contre-passent 2110 deux fois → PB1 sous-déclaré.
  -- Mirror exact de get_profit_loss_v4 (S26 _017/_018).
  SELECT COALESCE(SUM(jel.credit) - SUM(jel.debit), 0)
    INTO v_pb1_output
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1     je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_id
      AND je.entry_date BETWEEN p_period_start AND p_period_end
      AND je.status IN ('posted', 'locked')
      AND NOT (je.reference_type = 'sale_void'
               AND EXISTS (SELECT 1 FROM reporting_private.closed_shift_journal_entries_v1 jr JOIN reporting_private.closed_refunds_v1 rf ON rf.id = jr.reference_id WHERE jr.reference_type = 'sale_refund' AND rf.order_id = je.reference_id));

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end',   p_period_end,
    'pb1_output',   v_pb1_output,
    'pb1_payable',  v_pb1_output,
    'tax_rate',     current_pb1_rate(),
    'tax_regime',   'NON_PKP_LOMBOK_PBJT',
    'note',         'NON-PKP — PBJT Makanan dan Minuman payable to Bapenda Lombok/NTB (UU HKPD 1/2022). No VAT input deduction (ADR-005).'
  );
END;
$function$;

-- get_pb1_report_v6 → get_pb1_report_v7
CREATE OR REPLACE FUNCTION public.get_pb1_report_v7(p_period_month integer, p_period_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_start_date     DATE;
  v_end_date       DATE;
  v_pb1_rate       NUMERIC;
  v_taxable_base   NUMERIC(15,2);
  v_pb1_collected  NUMERIC(15,2);
  v_pb1_payable    NUMERIC(15,2);
  v_pb1_account_id UUID;
  v_balance        NUMERIC(15,2);
  v_by_day         JSONB;
  v_calc           JSONB;
BEGIN
  PERFORM public.assert_statements_visible_v1();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.financial.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.financial.read' USING ERRCODE = '42501';
  END IF;
  IF p_period_month < 1 OR p_period_month > 12 THEN
    RAISE EXCEPTION 'Invalid month: %', p_period_month USING ERRCODE = '22023';
  END IF;
  IF p_period_year < 2000 OR p_period_year > 2100 THEN
    RAISE EXCEPTION 'Invalid year: %', p_period_year USING ERRCODE = '22023';
  END IF;

  v_start_date := make_date(p_period_year, p_period_month, 1);
  v_end_date   := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::date;

  v_pb1_rate := current_pb1_rate();

  -- Taxable base = subtotal (excl. tax), pb1_collected = tax_amount from reporting_private.closed_pos_orders_v1
  SELECT
    COALESCE(SUM(subtotal),    0),
    COALESCE(SUM(tax_amount),  0)
  INTO v_taxable_base, v_pb1_collected
  FROM reporting_private.recognized_sales_v2
  WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
    AND status NOT IN ('voided');

  -- Reuse calculate_pb1_payable helper — signature: (p_period_start DATE, p_period_end DATE)
  -- DEV-S30-1.B-01: actual signature uses DATE args, not TEXT as originally assumed
  -- Lot D1 : bump _v1→_v2 — calculate_pb1_payable a gagné le gate reports.financial.read,
  -- règle RPC versioning monotone oblige (jamais éditer une _vN publiée).
  v_calc := calculate_pb1_payable_v6(v_start_date, v_end_date);
  v_pb1_payable := COALESCE((v_calc->>'pb1_payable')::numeric, v_pb1_collected);

  -- Balance on account 2110 (PB1 Payable) at period end
  SELECT id INTO v_pb1_account_id FROM accounts WHERE code = '2110' LIMIT 1;
  IF v_pb1_account_id IS NOT NULL THEN
    SELECT COALESCE(SUM(jel.credit - jel.debit), 0)
    INTO v_balance
    FROM reporting_private.closed_shift_journal_lines_v1 jel
    JOIN reporting_private.closed_shift_journal_entries_v1 je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = v_pb1_account_id
      AND je.entry_date <= v_end_date;
  ELSE
    v_balance := 0;
  END IF;

  -- Daily breakdown
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.day ASC), '[]'::jsonb)
  INTO v_by_day
  FROM (
    SELECT
      recognized_at::date                AS day,
      COALESCE(SUM(subtotal),   0)   AS taxable_base,
      COALESCE(SUM(tax_amount), 0)   AS pb1_collected
    FROM reporting_private.recognized_sales_v2
    WHERE recognized_at::date BETWEEN v_start_date AND v_end_date
      AND status NOT IN ('voided')
    GROUP BY recognized_at::date
  ) t;

  RETURN jsonb_build_object(
    'period', jsonb_build_object(
      'month', p_period_month,
      'year',  p_period_year,
      'start', v_start_date::text,
      'end',   v_end_date::text
    ),
    'pb1_rate',              v_pb1_rate,
    'taxable_base',          v_taxable_base,
    'pb1_collected',         v_pb1_collected,
    'pb1_payable',           v_pb1_payable,
    'by_day',                v_by_day,
    'balance_account_code',  '2110',
    'balance_at_period_end', v_balance
  );
END;
$function$;

-- ── Droits : authenticated et service_role seulement ─────────────────
DO $grants$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY[
   'get_display_stock_activity_v4',
   'get_low_stock_v5',
   'get_movement_aggregates_v6',
   'get_product_analytics_v5',
   'get_product_dashboard_v8',
   'get_production_suggestions_v4',
   'get_production_vs_sales_v5',
   'get_reorder_suggestions_v4',
   'get_stock_config_issues_v5',
   'get_stock_counters_v4',
   'get_stock_levels_v7',
   'get_stock_movement_ledger_v5',
   'get_stock_movements_v7',
   'get_stock_position_v4',
   'get_stock_variance_v6',
   'get_general_ledger_v5',
   'get_dashboard_overview_v8',
   'recipe_bom_full_v6',
   'recipe_direct_cost_v4',
   'search_ingredients_v4',
   'get_dashboard_action_queue_v4',
   'get_balance_sheet_v6',
   'get_cash_flow_v5',
   'get_cash_wallet_ledger_v5',
   'get_profit_loss_v5',
   'get_trial_balance_v6',
   'get_gross_margin_by_product_v6',
   'calculate_pb1_payable_v6',
   'get_pb1_report_v7'])
 LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
 END LOOP;
END $grants$;

DO $c$ BEGIN
 EXECUTE format('COMMENT ON FUNCTION public.get_production_vs_sales_v5(date,date,uuid,uuid) IS %L',
  obj_description('public.get_production_vs_sales_v4(date,date,uuid,uuid)'::regprocedure,'pg_proc'));
END $c$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
