-- 20260517000075_create_stock_variance_rpc.sql
-- Session 13 / Phase 2.B / migration 6 :
--   RPC `get_stock_variance_v1` returns the per-product variance between
--   the expected stock (sum of all movements over a date window) and the
--   current cached stock.
--
-- Window :
--   p_date_start : default = now() - interval '30 days'
--   p_date_end   : default = now()
-- Section filter (optional) :
--   - filters movements whose `from_section_id` or `to_section_id` matches.
--   - section_id is NULL → no filter (all sections).
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.E

CREATE OR REPLACE FUNCTION public.get_stock_variance_v1(
  p_section_id  UUID        DEFAULT NULL,
  p_date_start  TIMESTAMPTZ DEFAULT NULL,
  p_date_end    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  product_id    UUID,
  product_name  TEXT,
  sku           TEXT,
  opened        DECIMAL(12,3),
  sold          DECIMAL(12,3),
  adjusted      DECIMAL(12,3),
  current_qty   DECIMAL(12,3),
  expected      DECIMAL(12,3),
  variance      DECIMAL(12,3),
  variance_pct  DECIMAL(10,3)
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    product_id,
    product_name,
    sku,
    opened::DECIMAL(12,3),
    sold::DECIMAL(12,3),
    adjusted::DECIMAL(12,3),
    current_qty::DECIMAL(12,3),
    expected::DECIMAL(12,3),
    (current_qty - expected)::DECIMAL(12,3) AS variance,
    CASE WHEN expected <> 0
         THEN (((current_qty - expected) / expected) * 100)::DECIMAL(10,3)
         ELSE 0::DECIMAL(10,3) END           AS variance_pct
  FROM agg
  ORDER BY ABS(current_qty - expected) DESC, product_name ASC;
$$;

COMMENT ON FUNCTION public.get_stock_variance_v1(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Phase 2.B — Stock variance report. Window defaults to last 30 days. Per-product '
  'variance = current_stock - expected (sum of all movements in the window). '
  'Section filter is optional. Order by abs(variance) desc.';

GRANT EXECUTE ON FUNCTION public.get_stock_variance_v1(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
