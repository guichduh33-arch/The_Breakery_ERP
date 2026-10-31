-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.recipe_direct_cost_v2(p_product_id uuid)
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
         CASE WHEN public.can_view_business_day_v1(current_date) THEN m.current_stock ELSE NULL::numeric END,
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
DROP FUNCTION public.recipe_direct_cost_v1(p_product_id uuid);
REVOKE ALL ON FUNCTION public.recipe_direct_cost_v2(p_product_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.recipe_direct_cost_v2(p_product_id uuid) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.search_ingredients_v2(p_query text DEFAULT ''::text, p_kind text DEFAULT 'all'::text, p_limit integer DEFAULT 20)
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
      CASE WHEN public.can_view_business_day_v1(current_date) THEN p.current_stock ELSE NULL::numeric END   AS current_stock,
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
DROP FUNCTION public.search_ingredients_v1(p_query text, p_kind text, p_limit integer);
REVOKE ALL ON FUNCTION public.search_ingredients_v2(p_query text, p_kind text, p_limit integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_ingredients_v2(p_query text, p_kind text, p_limit integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.search_orders_v2(p_query text, p_limit integer DEFAULT 10)
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
    WHERE public.can_view_order_v1(o.id) AND o.order_number ILIKE '%' || v_term || '%'
    ORDER BY o.created_at DESC
    LIMIT v_lim;
END; $function$
;
DROP FUNCTION public.search_orders_v1(p_query text, p_limit integer);
REVOKE ALL ON FUNCTION public.search_orders_v2(p_query text, p_limit integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_orders_v2(p_query text, p_limit integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.suggest_production_schedule_v2(p_target_date date)
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
    PERFORM public.assert_business_days_visible_v1(v_window_start,LEAST(p_target_date,current_date));
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
DROP FUNCTION public.suggest_production_schedule_v1(p_target_date date);
REVOKE ALL ON FUNCTION public.suggest_production_schedule_v2(p_target_date date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.suggest_production_schedule_v2(p_target_date date) TO authenticated;


