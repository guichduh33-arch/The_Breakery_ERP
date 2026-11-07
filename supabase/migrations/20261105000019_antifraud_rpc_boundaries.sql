-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.search_ingredients_v3(p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 20)
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
      CASE WHEN public.can_view_business_day_v2(current_date) THEN p.current_stock ELSE NULL::numeric END   AS current_stock,
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
REVOKE ALL ON FUNCTION public.search_ingredients_v3(p_query text, p_kind text, p_limit integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_ingredients_v3(p_query text, p_kind text, p_limit integer) TO authenticated,service_role;
DROP FUNCTION public.search_ingredients_v2(p_query text, p_kind text, p_limit integer);

CREATE OR REPLACE FUNCTION public.search_orders_v3(p_query text, p_limit integer DEFAULT 10)
 RETURNS TABLE(id uuid, order_number text, status order_status, order_type order_type, total numeric, created_at timestamp with time zone, customer_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID := auth.uid();
  v_term TEXT := btrim(COALESCE(p_query, ''));
  v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 20);
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'permission denied: orders.read required' USING ERRCODE = '42501';
  END IF;
  IF length(v_term) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT o.id, o.order_number, o.status, o.order_type, o.total, o.created_at,
           c.name AS customer_name
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE public.can_view_order_v2(o.id) AND o.order_number ILIKE '%' || v_term || '%'
    ORDER BY o.created_at DESC
    LIMIT v_lim;
END; $function$
;
REVOKE ALL ON FUNCTION public.search_orders_v3(p_query text, p_limit integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.search_orders_v3(p_query text, p_limit integer) TO authenticated,service_role;
DROP FUNCTION public.search_orders_v2(p_query text, p_limit integer);

CREATE OR REPLACE FUNCTION public.suggest_production_schedule_v3(p_target_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_target_dow   INT  := EXTRACT(DOW FROM p_target_date)::int;
  v_window_start DATE := p_target_date - INTERVAL '28 days';
  v_suggestions  JSONB;
BEGIN
  IF v_window_start<=current_date THEN
    PERFORM public.assert_business_days_visible_v2(v_window_start,LEAST(p_target_date,current_date));
  END IF;
  IF NOT has_permission(v_uid, 'inventory.production.schedule') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = 'P0001',
            DETAIL  = 'inventory.production.schedule required';
  END IF;

  WITH same_dow_sales AS (
    SELECT
      oi.product_id,
      (o.created_at AT TIME ZONE 'UTC')::date AS sale_date,
      SUM(oi.quantity)                       AS qty_sold_that_day
    FROM order_items oi
    JOIN orders      o ON o.id = oi.order_id
    WHERE o.status IN ('paid','completed')
      AND o.created_at >= v_window_start
      AND o.created_at <  p_target_date + INTERVAL '1 day'
      AND EXTRACT(DOW FROM (o.created_at AT TIME ZONE 'UTC')::date) = v_target_dow
      AND COALESCE(oi.is_cancelled, FALSE) = FALSE
      AND oi.product_id IS NOT NULL
    GROUP BY oi.product_id, (o.created_at AT TIME ZONE 'UTC')::date
  ),
  daily_avg AS (
    SELECT
      product_id,
      COUNT(DISTINCT sale_date)             AS sale_days,
      AVG(qty_sold_that_day)::numeric(10,3) AS avg_daily_qty,
      SUM(qty_sold_that_day)::numeric(10,3) AS total_volume
    FROM same_dow_sales
    GROUP BY product_id
  ),
  recipe_products AS (
    SELECT DISTINCT product_id
    FROM recipes
    WHERE is_active = TRUE AND deleted_at IS NULL
  ),
  enriched AS (
    SELECT
      p.id                AS product_id,
      p.name              AS product_name,
      da.sale_days,
      COALESCE(da.avg_daily_qty, 0)::numeric(10,3)   AS avg_daily_qty,
      COALESCE(da.total_volume, 0)::numeric(10,3)    AS total_volume,
      p.retail_price                                  AS retail_price,
      COALESCE(p.cost_price, 0)::numeric(10,3)       AS cost_price,
      CASE
        WHEN p.retail_price > 0
          THEN ((p.retail_price - COALESCE(p.cost_price, 0)) / p.retail_price * 100)::numeric(6,2)
        ELSE 0
      END                 AS margin_pct
    FROM products p
    JOIN recipe_products rp ON rp.product_id = p.id
    LEFT JOIN daily_avg  da ON da.product_id = p.id
    WHERE p.deleted_at IS NULL AND p.is_active = TRUE
  ),
  ranked AS (
    SELECT
      product_id,
      product_name,
      sale_days,
      avg_daily_qty,
      margin_pct,
      total_volume,
      (margin_pct * total_volume)::numeric(12,2)                AS ranking_score,
      (COALESCE(sale_days, 0) >= 7)                              AS has_sufficient_history,
      CASE
        WHEN COALESCE(sale_days, 0) >= 7
          THEN ROUND(avg_daily_qty * 1.10, 3)
        ELSE 0
      END                                                        AS suggested_qty
    FROM enriched
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'product_id',             product_id,
             'product_name',           product_name,
             'suggested_qty',          suggested_qty,
             'avg_daily_sales',        avg_daily_qty,
             'margin_pct',             margin_pct,
             'ranking_score',          ranking_score,
             'has_sufficient_history', has_sufficient_history,
             'sale_days',              COALESCE(sale_days, 0)
           )
           ORDER BY ranking_score DESC, product_name ASC
         ), '[]'::jsonb)
    INTO v_suggestions
    FROM ranked;

  RETURN jsonb_build_object(
    'target_date', p_target_date,
    'target_dow',  v_target_dow,
    'window_start', v_window_start,
    'suggestions', v_suggestions
  );
END $function$
;
REVOKE ALL ON FUNCTION public.suggest_production_schedule_v3(p_target_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suggest_production_schedule_v3(p_target_date date) TO authenticated,service_role;
DROP FUNCTION public.suggest_production_schedule_v2(p_target_date date);

CREATE OR REPLACE FUNCTION public.add_display_stock_v4(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.add_display_stock_v2(p_product_id,p_quantity,p_reason,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.add_display_stock_v4(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_display_stock_v4(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.add_display_stock_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public.reservation_hold_v3(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid DEFAULT NULL::uuid, p_holder_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.reservation_hold_v1(p_product_id,p_quantity,p_holder_type,p_expires_at,p_section_id,p_holder_id,p_notes,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.reservation_hold_v3(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reservation_hold_v3(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.reservation_hold_v2(p_product_id uuid, p_quantity numeric, p_holder_type text, p_expires_at timestamp with time zone, p_section_id uuid, p_holder_id uuid, p_notes text, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public.return_display_to_kitchen_v4(p_product_id uuid, p_quantity numeric, p_reason text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN

 RETURN stock_private.mask_stock_payload(stock_private.return_display_to_kitchen_v2(p_product_id,p_quantity,p_reason,p_idempotency_key));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date)
    AND (SQLERRM ~* '(stock|shortage)' OR COALESCE(SQLERRM,'') ~* 'have [0-9]')
 THEN RAISE EXCEPTION 'stock_operation_rejected' USING ERRCODE=SQLSTATE; END IF;
 RAISE;
END $function$
;
REVOKE ALL ON FUNCTION public.return_display_to_kitchen_v4(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.return_display_to_kitchen_v4(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid) TO authenticated,service_role;
DROP FUNCTION public.return_display_to_kitchen_v3(p_product_id uuid, p_quantity numeric, p_reason text, p_idempotency_key uuid);

CREATE OR REPLACE FUNCTION public.get_staff_performance_v3(p_date_start text, p_date_end text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_start    DATE;
  v_end      DATE;
  v_tz       TEXT;
  v_by_staff JSONB;
BEGIN
  PERFORM public.assert_business_days_visible_v2(p_date_start::date,p_date_end::date);
  IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.sales.read') THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required'
      USING ERRCODE = '42501';
  END IF;

  v_start := p_date_start::DATE;
  v_end   := p_date_end::DATE;
  IF v_end < v_start THEN
    RAISE EXCEPTION 'invalid range: end before start' USING ERRCODE = 'P0001';
  END IF;
  -- clamp pattern S30 : 366 jours max
  IF v_end - v_start > 366 THEN
    v_start := v_end - 366;
  END IF;

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH served AS (
    SELECT o.served_by                   AS staff_id,
           COUNT(*)::INT                 AS orders_served,
           SUM(o.total)::NUMERIC(14,2)   AS revenue
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  items AS (
    SELECT o.served_by AS staff_id,
           COUNT(oi.id)::INT AS item_count
      FROM reporting_private.recognized_sales_v2 o
      JOIN reporting_private.closed_order_items_v1 oi ON oi.order_id = o.id AND oi.is_cancelled = false
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  voids AS (
    SELECT o.voided_by                  AS staff_id,
           COUNT(*)::INT                AS voids_count,
           SUM(o.total)::NUMERIC(14,2)  AS voids_value
      FROM reporting_private.closed_pos_orders_v1 o
     WHERE o.voided_at IS NOT NULL
       AND ((o.voided_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.voided_by IS NOT NULL
     GROUP BY o.voided_by
  ),
  refunds_agg AS (
    SELECT r.refunded_by                AS staff_id,
           COUNT(*)::INT                AS refunds_count,
           SUM(r.total)::NUMERIC(14,2)  AS refunds_value
      FROM reporting_private.closed_refunds_v1 r
     WHERE ((r.created_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND r.refunded_by IS NOT NULL
     GROUP BY r.refunded_by
  ),
  discounts AS (
    SELECT o.served_by                            AS staff_id,
           COUNT(*)::INT                          AS discount_orders_count,
           SUM(o.discount_amount)::NUMERIC(14,2)  AS discount_value
      FROM reporting_private.recognized_sales_v2 o
     WHERE TRUE
       AND o.voided_at IS NULL
       AND o.recognized_at IS NOT NULL
       AND o.discount_amount > 0
       AND ((o.recognized_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
       AND o.served_by IS NOT NULL
     GROUP BY o.served_by
  ),
  cancelled AS (
    SELECT oi.cancelled_by AS staff_id,
           COUNT(*)::INT   AS items_cancelled
      FROM reporting_private.closed_order_items_v1 oi
     WHERE oi.is_cancelled = true
       AND oi.cancelled_by IS NOT NULL
       AND oi.cancelled_at IS NOT NULL
       AND ((oi.cancelled_at AT TIME ZONE v_tz))::date BETWEEN v_start AND v_end
     GROUP BY oi.cancelled_by
  ),
  all_staff AS (
    SELECT staff_id FROM served
    UNION SELECT staff_id FROM voids
    UNION SELECT staff_id FROM refunds_agg
    UNION SELECT staff_id FROM discounts
    UNION SELECT staff_id FROM cancelled
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'staff_id',              a.staff_id,
      'staff_name',            COALESCE(up.full_name, '(unknown)'),
      'orders_served',         COALESCE(s.orders_served, 0),
      'revenue',               COALESCE(s.revenue, 0),
      'aov',                   CASE WHEN COALESCE(s.orders_served, 0) = 0 THEN 0
                                    ELSE ROUND(s.revenue / s.orders_served, 2) END,
      'items_per_order',       CASE WHEN COALESCE(s.orders_served, 0) = 0 THEN 0
                                    ELSE ROUND(COALESCE(i.item_count, 0)::numeric / s.orders_served, 2) END,
      'voids_count',           COALESCE(v.voids_count, 0),
      'voids_value',           COALESCE(v.voids_value, 0),
      'refunds_count',         COALESCE(r.refunds_count, 0),
      'refunds_value',         COALESCE(r.refunds_value, 0),
      'discount_orders_count', COALESCE(d.discount_orders_count, 0),
      'discount_value',        COALESCE(d.discount_value, 0),
      'items_cancelled',       COALESCE(c.items_cancelled, 0)
    ) ORDER BY COALESCE(s.revenue, 0) DESC
  ), '[]'::jsonb)
  INTO v_by_staff
  FROM all_staff a
  LEFT JOIN served      s ON s.staff_id = a.staff_id
  LEFT JOIN items       i ON i.staff_id = a.staff_id
  LEFT JOIN voids       v ON v.staff_id = a.staff_id
  LEFT JOIN refunds_agg r ON r.staff_id = a.staff_id
  LEFT JOIN discounts   d ON d.staff_id = a.staff_id
  LEFT JOIN cancelled   c ON c.staff_id = a.staff_id
  LEFT JOIN user_profiles up ON up.id = a.staff_id;

  RETURN jsonb_build_object(
    'period',   jsonb_build_object('start', v_start, 'end', v_end),
    'by_staff', v_by_staff
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_staff_performance_v3(p_date_start text, p_date_end text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_staff_performance_v3(p_date_start text, p_date_end text) TO authenticated,service_role;
DROP FUNCTION public.get_staff_performance_v1(p_date_start text, p_date_end text);
DROP FUNCTION public.get_staff_performance_v2(p_date_start text, p_date_end text);
