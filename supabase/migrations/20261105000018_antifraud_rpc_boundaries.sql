-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_stock_position_v3(p_as_of date DEFAULT NULL::date)
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
  PERFORM public.assert_stock_owner_v1();

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
REVOKE ALL ON FUNCTION public.get_stock_position_v3(p_as_of date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_position_v3(p_as_of date) TO authenticated,service_role;
DROP FUNCTION public.get_stock_position_v2(p_as_of date);

CREATE OR REPLACE FUNCTION public.get_promo_roi_v2(p_promotion_id uuid, p_date_start date, p_date_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo          RECORD;
  v_redemptions    INT     := 0;
  v_orders         INT     := 0;
  v_discount       NUMERIC := 0;
  v_revenue        NUMERIC := 0;
  v_increment      NUMERIC := 0;
  v_roi_pct        NUMERIC := 0;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF NOT public.has_permission(auth.uid(), 'reports.read') THEN
    RAISE EXCEPTION 'permission_denied'
      USING ERRCODE = '42501', HINT = 'reports.read required';
  END IF;

  IF p_promotion_id IS NULL OR p_date_start IS NULL OR p_date_end IS NULL THEN
    RAISE EXCEPTION 'invalid_args' USING ERRCODE = '22023';
  END IF;
  IF p_date_end < p_date_start THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = '22023';
  END IF;

  SELECT id, slug, name INTO v_promo
  FROM public.promotions
  WHERE id = p_promotion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'promotion_not_found' USING ERRCODE = 'P0002';
  END IF;

  WITH appls AS (
    SELECT pa.id, pa.amount, pa.order_id
    FROM public.promotion_applications pa
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = pa.order_id
    WHERE pa.promotion_id = p_promotion_id
      AND o.status::TEXT IN ('completed','paid','refunded')
      AND o.created_at >= p_date_start::TIMESTAMPTZ
      AND o.created_at <  (p_date_end::TIMESTAMPTZ + INTERVAL '1 day')
  )
  SELECT
    COUNT(*)::INT,
    COUNT(DISTINCT order_id)::INT,
    COALESCE(SUM(amount), 0)::NUMERIC
  INTO v_redemptions, v_orders, v_discount
  FROM appls;

  SELECT COALESCE(SUM(o.total), 0)::NUMERIC INTO v_revenue
  FROM reporting_private.closed_pos_orders_v1 o
  WHERE o.id IN (
    SELECT DISTINCT order_id FROM public.promotion_applications
    WHERE promotion_id = p_promotion_id
  )
  AND o.status::TEXT IN ('completed','paid','refunded')
  AND o.created_at >= p_date_start::TIMESTAMPTZ
  AND o.created_at <  (p_date_end::TIMESTAMPTZ + INTERVAL '1 day');

  -- Proxy : revenue net of the discount given.
  v_increment := v_revenue - v_discount;
  v_roi_pct := CASE
    WHEN v_discount > 0
      THEN ROUND(((v_increment - v_discount) / v_discount) * 100, 2)
    ELSE 0
  END;

  RETURN jsonb_build_object(
    'promotion_id',         v_promo.id,
    'code',                 v_promo.slug,
    'name',                 v_promo.name,
    'redemptions',          v_redemptions,
    'incremental_orders',   v_orders,
    'total_discount_given', v_discount,
    'total_revenue',        v_revenue,
    'incremental_revenue',  v_increment,
    'estimated_cost',       v_discount,
    'roi_pct',              v_roi_pct,
    'period', jsonb_build_object(
      'start', p_date_start::TEXT,
      'end',   p_date_end::TEXT
    )
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_promo_roi_v2(p_promotion_id uuid, p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_promo_roi_v2(p_promotion_id uuid, p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_promo_roi_v1(p_promotion_id uuid, p_date_start date, p_date_end date);

CREATE OR REPLACE FUNCTION public.get_stock_variance_v5(p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(product_id uuid, product_name text, sku text, opening numeric, stock_in numeric, sold numeric, consumed numeric, wasted numeric, corrected numeric, other numeric, closing numeric, current_qty numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_owner_v1();
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
REVOKE ALL ON FUNCTION public.get_stock_variance_v5(p_date_start timestamp with time zone, p_date_end timestamp with time zone) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_variance_v5(p_date_start timestamp with time zone, p_date_end timestamp with time zone) TO authenticated,service_role;
DROP FUNCTION public.get_stock_variance_v4(p_date_start timestamp with time zone, p_date_end timestamp with time zone);

CREATE OR REPLACE FUNCTION public.get_zreport_snapshot_v3(p_zreport_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_result       JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(s.opened_at::date,COALESCE(s.closed_at,s.opened_at)::date) FROM reporting_private.closed_pos_sessions_v1 s JOIN public.z_reports z ON z.shift_id=s.id WHERE z.id=p_zreport_id;
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT has_permission(v_caller_id, 'zreports.read') THEN
    RAISE EXCEPTION 'Permission denied: zreports.read' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id',                z.id,
    'shift_id',          z.shift_id,
    'generated_at',      z.generated_at,
    'signed_at',         z.signed_at,
    'signed_by',         z.signed_by,
    'signed_by_name',    up.full_name,
    'voided_at',         z.voided_at,
    'voided_by',         z.voided_by,
    'void_reason',       z.void_reason,
    'pdf_storage_path',  z.pdf_storage_path,
    'status',            z.status,
    'snapshot',          z.snapshot
  )
  INTO v_result
  FROM z_reports z
  LEFT JOIN user_profiles up ON up.id = z.signed_by
  WHERE z.id = p_zreport_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_zreport_snapshot_v3(p_zreport_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_zreport_snapshot_v3(p_zreport_id uuid) TO authenticated,service_role;
DROP FUNCTION public.get_zreport_snapshot_v2(p_zreport_id uuid);

CREATE OR REPLACE FUNCTION public.recipe_bom_full_v5(p_product_id uuid, p_max_depth integer DEFAULT 5)
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
         CASE WHEN public.can_view_business_day_v2(current_date) THEN p.current_stock ELSE NULL::numeric END,
         p.cost_price,
         l.qty_base,
         l.qty_base * COALESCE(p.cost_price, 0) AS line_cost
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $function$
;
REVOKE ALL ON FUNCTION public.recipe_bom_full_v5(p_product_id uuid, p_max_depth integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_bom_full_v5(p_product_id uuid, p_max_depth integer) TO authenticated,service_role;
DROP FUNCTION public.recipe_bom_full_v4(p_product_id uuid, p_max_depth integer);

CREATE OR REPLACE FUNCTION public.recipe_direct_cost_v3(p_product_id uuid)
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
         CASE WHEN public.can_view_business_day_v2(current_date) THEN m.current_stock ELSE NULL::numeric END,
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
REVOKE ALL ON FUNCTION public.recipe_direct_cost_v3(p_product_id uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_direct_cost_v3(p_product_id uuid) TO authenticated,service_role;
DROP FUNCTION public.recipe_direct_cost_v2(p_product_id uuid);
