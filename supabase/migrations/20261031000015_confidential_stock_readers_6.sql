-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_sales_by_product_v2(p_start_date date, p_end_date date, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tz      text;
  v_start   date;
  v_end     date;
  v_result  jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (has_permission(auth.uid(), 'reports.sales.read') OR has_permission(auth.uid(), 'reports.product_sales.read')) THEN
    RAISE EXCEPTION 'permission denied: reports.sales.read required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start_date::text,''),current_date::text)::date,COALESCE(NULLIF(p_end_date::text,''),current_date::text)::date);

  IF p_start_date IS NULL OR p_end_date IS NULL THEN
    RAISE EXCEPTION 'start and end dates are required' USING ERRCODE = 'P0001';
  END IF;
  IF p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range' USING ERRCODE = 'P0001';
  END IF;

  v_end   := p_end_date;
  v_start := GREATEST(p_start_date, p_end_date - 366);

  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') INTO v_tz
    FROM business_config WHERE id = 1;

  WITH scoped AS (
    SELECT
      o.id,
      (o.order_type = 'b2b')          AS is_b2b,
      COALESCE(o.discount_amount, 0)  AS order_discount,
      COALESCE(o.promotion_total, 0)  AS promotion_total
    FROM orders o
    WHERE o.status IN ('paid', 'completed')
      AND o.voided_at IS NULL
      AND o.is_historical_import = false
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_test = true
      )
      AND ((COALESCE(o.paid_at, o.created_at) AT TIME ZONE v_tz))::date
          BETWEEN v_start AND v_end
  ),
  lines AS (
    SELECT
      oi.order_id,
      oi.product_id,
      p.name                             AS product_name,
      p.category_id                      AS category_id,
      COALESCE(c.name, 'Uncategorized')  AS category_name,
      s.is_b2b,
      oi.quantity,
      oi.line_total,
      COALESCE(oi.discount_amount, 0)    AS discount_amount
    FROM order_items oi
    JOIN scoped   s ON s.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE oi.is_cancelled  = false
      AND oi.is_promo_gift = false
      AND (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  tot AS (
    SELECT
      COALESCE(SUM(line_total), 0)      AS revenue,
      COALESCE(SUM(quantity), 0)        AS qty,
      COALESCE(SUM(discount_amount), 0) AS discount,
      COUNT(*)                          AS line_count,
      COUNT(DISTINCT order_id)          AS order_count,
      COUNT(DISTINCT product_id)        AS product_count,
      COALESCE(SUM(line_total) FILTER (WHERE NOT is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE NOT is_b2b), 0) AS counter_qty,
      COALESCE(SUM(line_total) FILTER (WHERE is_b2b), 0)     AS b2b_revenue,
      COALESCE(SUM(quantity)   FILTER (WHERE is_b2b), 0)     AS b2b_qty
    FROM lines
  ),
  unattributed AS (
    SELECT
      COALESCE(SUM(s.order_discount), 0)  AS order_discount,
      COALESCE(SUM(s.promotion_total), 0) AS promotion_total
    FROM scoped s
    WHERE EXISTS (SELECT 1 FROM lines l WHERE l.order_id = s.id)
  ),
  per_product AS (
    SELECT
      l.product_id,
      l.product_name                                             AS name,
      l.category_id                                              AS category_id,
      l.category_name                                            AS category_name,
      SUM(l.quantity)                                            AS qty,
      SUM(l.line_total)                                          AS revenue,
      SUM(l.discount_amount)                                     AS discount,
      COUNT(DISTINCT l.order_id)                                 AS order_count,
      COALESCE(SUM(l.quantity)   FILTER (WHERE NOT l.is_b2b), 0) AS counter_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE NOT l.is_b2b), 0) AS counter_revenue,
      COALESCE(SUM(l.quantity)   FILTER (WHERE l.is_b2b), 0)     AS b2b_qty,
      COALESCE(SUM(l.line_total) FILTER (WHERE l.is_b2b), 0)     AS b2b_revenue
    FROM lines l
    GROUP BY l.product_id, l.product_name, l.category_id, l.category_name
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('start', v_start, 'end', v_end),
    'timezone',     v_tz,
    'generated_at', now(),
    'summary', jsonb_build_object(
      'revenue',       t.revenue,
      'qty',           t.qty,
      'discount',      t.discount,
      'lines',         t.line_count,
      'orders',        t.order_count,
      'products',      t.product_count,
      'avg_price',     COALESCE(ROUND(t.revenue / NULLIF(t.qty, 0), 2), 0),
      'counter', jsonb_build_object('qty', t.counter_qty, 'revenue', t.counter_revenue),
      'b2b',     jsonb_build_object('qty', t.b2b_qty,     'revenue', t.b2b_revenue),
      'unattributed', jsonb_build_object(
        'order_discount',  u.order_discount,
        'promotion_total', u.promotion_total
      )
    ),
    'by_product', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id',    pp.product_id,
          'name',          pp.name,
          'category_id',   pp.category_id,
          'category_name', pp.category_name,
          'qty',           pp.qty,
          'revenue',       pp.revenue,
          'discount',      pp.discount,
          'order_count',   pp.order_count,
          'avg_price',     COALESCE(ROUND(pp.revenue / NULLIF(pp.qty, 0), 2), 0),
          'share_pct',     COALESCE(ROUND(100 * pp.revenue / NULLIF(t.revenue, 0), 2), 0),
          'counter',       jsonb_build_object('qty', pp.counter_qty, 'revenue', pp.counter_revenue),
          'b2b',           jsonb_build_object('qty', pp.b2b_qty,     'revenue', pp.b2b_revenue)
        ) ORDER BY pp.revenue DESC, pp.name ASC
      ) FROM per_product pp
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM tot t, unattributed u;

  RETURN v_result;
END;
$function$
;
DROP FUNCTION public.get_sales_by_product_v1(p_start_date date, p_end_date date, p_category_id uuid);
REVOKE ALL ON FUNCTION public.get_sales_by_product_v2(p_start_date date, p_end_date date, p_category_id uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_sales_by_product_v2(p_start_date date, p_end_date date, p_category_id uuid) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_stock_counters_v2(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, low_count bigint, zero_count bigint, negative_count bigint, untracked_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v1(current_date,current_date);


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
DROP FUNCTION public.get_stock_counters_v1(p_category_id uuid, p_search text);
REVOKE ALL ON FUNCTION public.get_stock_counters_v2(p_category_id uuid, p_search text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_counters_v2(p_category_id uuid, p_search text) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_stock_levels_v5(p_category_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_bucket stock_bucket DEFAULT 'all'::stock_bucket, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_sort text DEFAULT NULL::text, p_sort_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(product_id uuid, sku text, name text, category_id uuid, category_name text, current_stock numeric, min_stock_threshold numeric, track_inventory boolean, unit text, stock_value numeric, last_movement_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dir text := lower(COALESCE(p_sort_dir, 'asc'));
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v1(current_date,current_date);

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
DROP FUNCTION public.get_stock_levels_v4(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text);
REVOKE ALL ON FUNCTION public.get_stock_levels_v5(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_levels_v5(p_category_id uuid, p_search text, p_bucket stock_bucket, p_limit integer, p_offset integer, p_sort text, p_sort_dir text) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_stock_movement_ledger_v2(p_start text, p_end text, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_section_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_id UUID        := auth.uid();
  v_tz        TEXT        := COALESCE((SELECT timezone FROM business_config ORDER BY id LIMIT 1), 'Asia/Makassar');
  v_start     TIMESTAMPTZ := (p_start::date)::timestamp           AT TIME ZONE v_tz;
  v_end_excl  TIMESTAMPTZ := ((p_end::date + 1))::timestamp       AT TIME ZONE v_tz;
  v_limit     INT         := LEAST(GREATEST(p_limit, 1), 10000);
  v_lines     JSONB;
  v_count     INT;
  v_total     INT;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  PERFORM public.assert_business_days_visible_v1(current_date,current_date);
  PERFORM public.assert_business_days_visible_v1(COALESCE(NULLIF(p_start::text,''),current_date::text)::date,COALESCE(NULLIF(p_end::text,''),current_date::text)::date);

  IF NOT (has_permission(v_caller_id, 'inventory.read')
          OR has_permission(v_caller_id, 'reports.inventory.read')) THEN
    RAISE EXCEPTION 'Permission denied: inventory.read' USING ERRCODE = '42501';
  END IF;

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
    LEFT JOIN orders ord ON sm.reference_type = 'orders' AND ord.id = sm.reference_id
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
        'beginning_qty',   n.balance_qty - n.quantity,
        'balance_qty',     n.balance_qty,
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
DROP FUNCTION public.get_stock_movement_ledger_v1(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer);
REVOKE ALL ON FUNCTION public.get_stock_movement_ledger_v2(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_movement_ledger_v2(p_start text, p_end text, p_product_id uuid, p_movement_type text, p_section_id uuid, p_limit integer) TO authenticated;

-- Définition source pg_get_functiondef V3 dev, 31 octobre 2026.
CREATE OR REPLACE FUNCTION public.get_stock_movements_v3(p_section_id uuid DEFAULT NULL::uuid, p_product_id uuid DEFAULT NULL::uuid, p_movement_type text DEFAULT NULL::text, p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_end timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, product_id uuid, product_sku text, product_name text, movement_type movement_type, quantity numeric, unit text, reason text, unit_cost numeric, from_section_id uuid, from_section_code text, to_section_id uuid, to_section_code text, supplier_id uuid, supplier_name text, reference_type text, reference_id uuid, lot_id uuid, created_at timestamp with time zone, created_by uuid, author_name text, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limit INT;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;
  PERFORM public.assert_business_days_visible_v1(COALESCE(p_date_start::date,(SELECT activated_on FROM public.business_day_visibility_config WHERE id)),COALESCE(p_date_end::date,current_date));


  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);

  RETURN QUERY
  SELECT
    sm.id,
    sm.product_id,
    p.sku,
    p.name,
    sm.movement_type,
    sm.quantity,
    sm.unit,
    sm.reason,
    sm.unit_cost,
    sm.from_section_id,
    fs.code AS from_section_code,
    sm.to_section_id,
    ts.code AS to_section_code,
    sm.supplier_id,
    sup.name AS supplier_name,
    sm.reference_type,
    sm.reference_id,
    sm.lot_id,
    sm.created_at,
    sm.created_by,
    up.full_name AS author_name,
    sm.metadata
  FROM stock_movements sm
  LEFT JOIN products      p   ON p.id  = sm.product_id
  LEFT JOIN sections      fs  ON fs.id = sm.from_section_id
  LEFT JOIN sections      ts  ON ts.id = sm.to_section_id
  LEFT JOIN suppliers     sup ON sup.id = sm.supplier_id
  LEFT JOIN user_profiles up  ON up.id  = sm.created_by
  WHERE
    (p_section_id IS NULL OR sm.from_section_id = p_section_id OR sm.to_section_id = p_section_id)
    AND (p_product_id IS NULL OR sm.product_id = p_product_id)
    AND (p_movement_type IS NULL OR sm.movement_type::TEXT = p_movement_type)
    AND (p_date_start IS NULL OR sm.created_at >= p_date_start)
    AND (p_date_end   IS NULL OR sm.created_at <= p_date_end)
    AND (
      p_cursor IS NULL
      OR sm.created_at < p_cursor
      OR (sm.created_at = p_cursor AND (p_cursor_id IS NULL OR sm.id < p_cursor_id))
    )
  ORDER BY sm.created_at DESC, sm.id DESC
  LIMIT v_limit;
END $function$
;
DROP FUNCTION public.get_stock_movements_v1(p_section_id uuid, p_product_id uuid, p_movement_type text, p_date_start timestamp with time zone, p_date_end timestamp with time zone, p_cursor timestamp with time zone, p_cursor_id uuid, p_limit integer);
REVOKE ALL ON FUNCTION public.get_stock_movements_v3(p_section_id uuid, p_product_id uuid, p_movement_type text, p_date_start timestamp with time zone, p_date_end timestamp with time zone, p_cursor timestamp with time zone, p_cursor_id uuid, p_limit integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_stock_movements_v3(p_section_id uuid, p_product_id uuid, p_movement_type text, p_date_start timestamp with time zone, p_date_end timestamp with time zone, p_cursor timestamp with time zone, p_cursor_id uuid, p_limit integer) TO authenticated;


