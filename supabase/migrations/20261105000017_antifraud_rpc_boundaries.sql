-- Suite des corps live avec garde antifraude.
CREATE OR REPLACE FUNCTION public.get_pos_activity_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz     TEXT;
  v_total  INTEGER;
  v_events JSONB;
  c_cap    CONSTANT INTEGER := 500;
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
    SELECT
      o.id,
      o.order_number,
      o.total,
      COALESCE(o.recognized_at, o.created_at) AS at
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
  capped AS (
    SELECT * FROM scoped ORDER BY at DESC LIMIT c_cap
  )
  SELECT
    (SELECT COUNT(*)::int FROM scoped),
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id',        'order-' || c.id::text,
        'kind',      'sale',
        'reference', c.order_number,
        'amount',    c.total,
        'at',        c.at,
        'label',     'Sale completed'
      ) ORDER BY c.at DESC
    ), '[]'::jsonb)
  INTO v_total, v_events
  FROM capped c;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'start_date',   p_start_date,
    'end_date',     p_end_date,
    'timezone',     v_tz,
    'total_events', v_total,
    'truncated',    v_total > c_cap,
    'events',       v_events
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_activity_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_activity_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_activity_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_activity_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_stock_counters_v3(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, low_count bigint, zero_count bigint, negative_count bigint, untracked_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.assert_stock_owner_v1();
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
REVOKE ALL ON FUNCTION public.get_stock_counters_v3(p_category_id uuid, p_search text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_counters_v3(p_category_id uuid, p_search text) TO authenticated,service_role;
DROP FUNCTION public.get_stock_counters_v2(p_category_id uuid, p_search text);

CREATE OR REPLACE FUNCTION public.get_pos_sales_overview_v3(p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz         TEXT;
  v_revenue    NUMERIC;
  v_tax        NUMERIC;
  v_orders     INTEGER;
  v_items_sold NUMERIC;
  v_by_hour    JSONB;
  v_by_day     JSONB;
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

  WITH sale_orders AS (
    SELECT o.id, o.total, o.tax_amount
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
  )
  SELECT COALESCE(SUM(total), 0), COALESCE(SUM(tax_amount), 0), COUNT(*)
    INTO v_revenue, v_tax, v_orders
    FROM sale_orders;

  WITH sale_orders AS (
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
  )
  SELECT COALESCE(SUM(oi.quantity), 0)
    INTO v_items_sold
    FROM reporting_private.closed_order_items_v1 oi
    JOIN sale_orders s ON s.id = oi.order_id
    WHERE oi.is_cancelled = false
      AND oi.is_promo_gift = false;

  WITH sale_orders AS (
    SELECT o.total, COALESCE(o.recognized_at, o.created_at) AS ts
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
  hourly AS (
    SELECT EXTRACT(HOUR FROM (so.ts AT TIME ZONE v_tz))::int AS hour,
           COALESCE(SUM(so.total), 0) AS revenue,
           COUNT(*)                   AS tickets
    FROM sale_orders so
    GROUP BY 1
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'hour',    h.hour,
      'revenue', COALESCE(hr.revenue, 0),
      'tickets', COALESCE(hr.tickets, 0)
    ) ORDER BY h.hour
  )
  INTO v_by_hour
  FROM generate_series(0, 23) AS h(hour)
  LEFT JOIN hourly hr ON hr.hour = h.hour;

  WITH sale_orders AS (
    SELECT o.total,
           ((COALESCE(o.recognized_at, o.created_at) AT TIME ZONE v_tz))::date AS d
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
  daily AS (
    SELECT d, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS tickets
    FROM sale_orders GROUP BY d
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date',    to_char(gs::date, 'YYYY-MM-DD'),
      'revenue', COALESCE(dd.revenue, 0),
      'tickets', COALESCE(dd.tickets, 0)
    ) ORDER BY gs
  )
  INTO v_by_day
  FROM generate_series(p_start_date::timestamp, p_end_date::timestamp, interval '1 day') gs
  LEFT JOIN daily dd ON dd.d = gs::date;

  RETURN jsonb_build_object(
    'generated_at',  now(),
    'start_date',    p_start_date,
    'end_date',      p_end_date,
    'timezone',      v_tz,
    'revenue',       v_revenue,
    'tax',           v_tax,
    'orders',        v_orders,
    'items_sold',    v_items_sold,
    'avg_basket',    COALESCE(ROUND(v_revenue / NULLIF(v_orders, 0), 2), 0),
    'sales_by_hour', COALESCE(v_by_hour, '[]'::jsonb),
    'by_day',        COALESCE(v_by_day, '[]'::jsonb)
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.get_pos_sales_overview_v3(p_start_date date, p_end_date date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_sales_overview_v3(p_start_date date, p_end_date date) TO authenticated,service_role;
DROP FUNCTION public.get_pos_sales_overview_v1(p_start_date date, p_end_date date);
DROP FUNCTION public.get_pos_sales_overview_v2(p_start_date date, p_end_date date);

CREATE OR REPLACE FUNCTION public.get_stock_levels_v6(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_bucket stock_bucket DEFAULT 'all'::stock_bucket, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT NULL::text, p_sort_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(product_id uuid, sku text, name text, category_id uuid, category_name text, current_stock numeric, min_stock_threshold numeric, track_inventory boolean, unit text, stock_value numeric, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir text := lower(COALESCE(p_sort_dir, 'asc'));
BEGIN
  PERFORM public.assert_stock_owner_v1();
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
REVOKE ALL ON FUNCTION public.get_stock_levels_v6(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_levels_v6(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text) TO authenticated,service_role;
DROP FUNCTION public.get_stock_levels_v5(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text);

CREATE OR REPLACE FUNCTION public.get_stock_movements_v6(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_cursor text DEFAULT NULL::text)
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
  PERFORM public.assert_stock_owner_v1();
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
REVOKE ALL ON FUNCTION public.get_stock_movements_v6(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_limit integer, p_cursor text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_stock_movements_v6(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_limit integer, p_cursor text) TO authenticated,service_role;
DROP FUNCTION public.get_stock_movements_v3(p_section_id uuid, p_product_id uuid, p_movement_type text, p_date_start timestamp with time zone, p_date_end timestamp with time zone, p_cursor timestamp with time zone, p_cursor_id uuid, p_limit integer);
DROP FUNCTION public.get_stock_movements_v5(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_limit integer, p_cursor text);
