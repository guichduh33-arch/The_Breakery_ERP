-- Audit corrective (post-S33, 2026-05-31) — stock-management skill audit finding C.1
--
-- get_stock_variance_v1 was SECURITY INVOKER with NO has_permission gate. Its RLS
-- dependency (stock_movements.perm_read requires inventory.read) silenced movement
-- rows for unauthorized callers, but the `products` LEFT JOIN still leaked the product
-- list + current_stock to any authenticated user lacking inventory.read.
--
-- Fix: add an explicit `inventory.read` gate. This is the exact permission the RLS
-- already depends on, so legitimate users (MANAGER+/anyone who already saw real data)
-- are unaffected — only the product-list leak is closed. Converted SQL -> plpgsql to
-- allow a RAISE; signature + return type are unchanged (CREATE OR REPLACE preserves
-- grants). Query body preserved verbatim.

CREATE OR REPLACE FUNCTION public.get_stock_variance_v1(
  p_section_id uuid DEFAULT NULL::uuid,
  p_date_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_end   timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(
  product_id uuid, product_name text, sku text,
  opened numeric, sold numeric, adjusted numeric,
  current_qty numeric, expected numeric, variance numeric, variance_pct numeric
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH window_bounds AS (
    SELECT COALESCE(p_date_start, now() - INTERVAL '30 days') AS ws,
           COALESCE(p_date_end,   now())                      AS we
  ),
  filtered AS (
    SELECT sm.*
    FROM stock_movements sm, window_bounds w
    WHERE sm.created_at BETWEEN w.ws AND w.we
      AND (p_section_id IS NULL
           OR sm.from_section_id = p_section_id
           OR sm.to_section_id   = p_section_id)
  ),
  agg AS (
    SELECT
      p.id   AS product_id,
      p.name AS product_name,
      p.sku  AS sku,
      p.current_stock AS current_qty,
      COALESCE(SUM(CASE WHEN sm.movement_type IN ('purchase','incoming','production_in')
                        THEN sm.quantity ELSE 0 END), 0) AS opened,
      COALESCE(SUM(CASE WHEN sm.movement_type IN ('sale','sale_void')
                        THEN sm.quantity ELSE 0 END), 0) AS sold,
      COALESCE(SUM(CASE WHEN sm.movement_type IN
                             ('adjustment','adjustment_in','adjustment_out',
                              'waste','opname_in','opname_out',
                              'production_out','purchase_return',
                              'transfer_in','transfer_out')
                        THEN sm.quantity ELSE 0 END), 0) AS adjusted,
      COALESCE(SUM(sm.quantity), 0) AS expected
    FROM products p
    LEFT JOIN filtered sm ON sm.product_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id, p.name, p.sku, p.current_stock
  )
  SELECT
    a.product_id,
    a.product_name,
    a.sku,
    a.opened::DECIMAL(12,3),
    a.sold::DECIMAL(12,3),
    a.adjusted::DECIMAL(12,3),
    a.current_qty::DECIMAL(12,3),
    a.expected::DECIMAL(12,3),
    (a.current_qty - a.expected)::DECIMAL(12,3) AS variance,
    CASE WHEN a.expected <> 0
         THEN (((a.current_qty - a.expected) / a.expected) * 100)::DECIMAL(10,3)
         ELSE 0::DECIMAL(10,3) END              AS variance_pct
  FROM agg a
  ORDER BY ABS(a.current_qty - a.expected) DESC, a.product_name ASC;
END;
$function$;
