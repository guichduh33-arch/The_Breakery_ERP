-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_refunds_report_v3(p_start_date date, p_end_date date)
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
  PERFORM public.assert_business_days_visible_v2(v_prev_start,v_end);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      r.id, r.refund_number, r.order_id, o.order_number,
      r.created_at, r.total, r.tax_refunded, r.reason,
      r.refunded_by, r.authorized_by, r.is_full_void,
      ((r.created_at AT TIME ZONE v_tz))::date AS business_date,
      CASE
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(saisie|erreur|wrong|mistake|input|salah)%'          THEN 'input_error'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(qualit|defect|defaut|défaut|stale|burnt|rusak|basi)%' THEN 'quality'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(double|duplicate|dobel)%'                            THEN 'duplicate'
        WHEN lower(COALESCE(r.reason, '')) SIMILAR TO
          '%(avis|chang|mind|batal)%'                             THEN 'customer_change'
        ELSE 'other'
      END AS reason_family
    FROM reporting_private.closed_refunds_v1 r
    JOIN reporting_private.closed_pos_orders_v1 o ON o.id = r.order_id
    WHERE o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM reporting_private.closed_order_items_v1 oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_prev_start AND v_end
  ),
  cur  AS (SELECT * FROM scoped WHERE business_date >= v_start),
  prev AS (SELECT * FROM scoped WHERE business_date <  v_start),
  sales AS (
    SELECT
      COALESCE(SUM(o.total) FILTER (WHERE bd BETWEEN v_start AND v_end), 0)      AS gross,
      COALESCE(SUM(o.total) FILTER (WHERE bd BETWEEN v_prev_start AND v_prev_end), 0) AS gross_prev
    FROM (
      SELECT o.total,
             ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date AS bd
      FROM reporting_private.closed_pos_orders_v1 o
      WHERE o.status IN ('paid', 'completed')
        AND o.voided_at IS NULL
        AND o.is_historical_import = false
        AND NOT EXISTS (
          SELECT 1 FROM reporting_private.closed_order_items_v1 oi
          JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id AND p.is_test = true
        )
        AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
            BETWEEN v_prev_start AND v_end
    ) o
  ),
  cl AS (
    SELECT
      oi.product_id,
      p.name AS product_name,
      COALESCE(oi.line_total, 0) AS value,
      oi.cancelled_reason,
      oi.cancelled_by
    FROM reporting_private.closed_order_items_v1 oi
    JOIN reporting_private.closed_pos_orders_v1   o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    WHERE oi.is_cancelled = true
      AND oi.cancelled_at IS NOT NULL
      AND o.is_historical_import = false
      AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
  ),
  cl_prod AS (
    SELECT
      product_id,
      product_name,
      COUNT(*)                                            AS line_count,
      COALESCE(SUM(value), 0)                             AS value,
      mode() WITHIN GROUP (ORDER BY cancelled_reason)     AS top_reason,
      mode() WITHIN GROUP (ORDER BY cancelled_by::text)   AS top_cashier_id
    FROM cl
    GROUP BY product_id, product_name
  ),
  tot AS (
    SELECT
      COALESCE(SUM(total), 0)                                     AS refunded,
      COUNT(*)                                                    AS refund_count,
      COUNT(*)          FILTER (WHERE is_full_void)               AS void_count,
      COALESCE(SUM(total) FILTER (WHERE is_full_void), 0)         AS void_amount,
      COUNT(*)          FILTER (WHERE NOT is_full_void)           AS partial_count,
      COALESCE(SUM(total) FILTER (WHERE NOT is_full_void), 0)     AS partial_amount,
      COALESCE(SUM(tax_refunded), 0)                              AS tax_refunded
    FROM cur
  ),
  tot_prev AS (
    SELECT COALESCE(SUM(total), 0) AS refunded FROM prev
  )
  SELECT jsonb_build_object(
    'period',       jsonb_build_object('start', v_start, 'end', v_end),
    'period_prev',  jsonb_build_object('start', v_prev_start, 'end', v_prev_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'refunded',         t.refunded,
      'refunded_prev',    tp.refunded,
      'refund_count',     t.refund_count,
      'void_count',       t.void_count,
      'void_amount',      t.void_amount,
      'partial_count',    t.partial_count,
      'partial_amount',   t.partial_amount,
      'tax_refunded',     t.tax_refunded,
      'gross_sales',      s.gross,
      'gross_sales_prev', s.gross_prev,
      'cancelled', jsonb_build_object(
        'lines', (SELECT COUNT(*) FROM cl),
        'value', (SELECT COALESCE(SUM(value), 0) FROM cl)
      )
    ),
    'events', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',            c.id,
          'refund_number', c.refund_number,
          'order_id',      c.order_id,
          'order_number',  c.order_number,
          'created_at',    c.created_at,
          'business_date', c.business_date,
          'is_full_void',  c.is_full_void,
          'reason',        c.reason,
          'reason_family', c.reason_family,
          'tax_refunded',  c.tax_refunded,
          'total',         c.total,
          'refunded_by',   jsonb_build_object('id', c.refunded_by,   'name', up1.full_name),
          'authorized_by', jsonb_build_object('id', c.authorized_by, 'name', up2.full_name),
          'payments', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('method', rp.method, 'amount', rp.amount)
              ORDER BY rp.amount DESC
            ) FROM refund_payments rp WHERE rp.refund_id = c.id
          ), '[]'::jsonb)
        ) ORDER BY c.total DESC, c.created_at DESC
      )
      FROM cur c
      LEFT JOIN user_profiles up1 ON up1.id = c.refunded_by
      LEFT JOIN user_profiles up2 ON up2.id = c.authorized_by
    ), '[]'::jsonb),
    'cancelled_by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',  g.product_id,
          'name',        g.product_name,
          'line_count',  g.line_count,
          'value',       g.value,
          'top_reason',  g.top_reason,
          'top_cashier', jsonb_build_object(
            'id',   g.top_cashier_id,
            'name', up.full_name,
            'count', (SELECT COUNT(*) FROM cl c2
                      WHERE c2.product_id = g.product_id
                        AND c2.cancelled_by::text = g.top_cashier_id)
          )
        ) ORDER BY g.value DESC, g.product_name ASC
      )
      FROM cl_prod g
      LEFT JOIN user_profiles up ON up.id::text = g.top_cashier_id
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, tot_prev tp, sales s;

  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_refunds_report_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_refunds_report_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_refunds_report_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_sales_by_category_v6(p_date_start date, p_date_end date)
 RETURNS TABLE(category_id uuid, category_name text, total numeric, qty numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
      FROM business_config WHERE id = 1
  )
  SELECT
    c.id                                   AS category_id,
    c.name                                 AS category_name,
    COALESCE(SUM(oi.line_total), 0)::DECIMAL(14,2) AS total,
    COALESCE(SUM(oi.quantity),  0)::DECIMAL(12,3)  AS qty
  FROM reporting_private.closed_order_items_v1 oi
  JOIN reporting_private.recognized_sales_v2     o ON o.id = oi.order_id
  JOIN products   p ON p.id = oi.product_id
  JOIN categories c ON c.id = p.category_id
  WHERE TRUE
    AND o.recognized_at IS NOT NULL
    AND o.voided_at IS NULL
    AND oi.is_cancelled = false
    AND oi.is_promo_gift = false
    AND ((o.recognized_at AT TIME ZONE (SELECT tz FROM cfg)))::date
        BETWEEN p_date_start AND p_date_end
  GROUP BY c.id, c.name
  ORDER BY total DESC;
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_sales_by_category_v6(p_date_start date, p_date_end date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_by_category_v6(p_date_start date, p_date_end date) TO authenticated,service_role;
DROP FUNCTION public.get_sales_by_category_v4(p_date_start date, p_date_end date);
DROP FUNCTION public.get_sales_by_category_v5(p_date_start date, p_date_end date);

CREATE OR REPLACE FUNCTION public.get_stock_config_issues_v4()
 RETURNS TABLE(product_id uuid, sku text, name text, category_name text, issue_type text, severity text, track_inventory boolean, deduct_stock boolean, recipe_lines integer, current_stock numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_owner_v1();
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
REVOKE ALL ON FUNCTION public.get_stock_config_issues_v4() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_config_issues_v4() TO authenticated,service_role;
DROP FUNCTION public.get_stock_config_issues_v3();
