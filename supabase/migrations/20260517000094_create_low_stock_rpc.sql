-- 20260517000094_create_low_stock_rpc.sql
-- Session 13 / Phase 2.D — Low-stock alerts (Session 12 phase 7).
--
-- get_low_stock_v1 returns one row per (section, product) pair below threshold
-- when p_section_id is provided ; otherwise per product based on the global
-- products.current_stock cache. The column min_stock_threshold lives on
-- products (migration 000005), not section_stock — only a global threshold
-- exists today. The grouping by section is here to enable a per-section
-- "what to restock in this kitchen" view consumed by AlertsPage.
--
-- Note : the spec body referred to a "low_stock_threshold" column but the
-- existing column is named min_stock_threshold (cf. 20260516000005). We use
-- the actual column.

CREATE OR REPLACE FUNCTION get_low_stock_v1(
  p_section_id UUID DEFAULT NULL
) RETURNS TABLE (
  product_id          UUID,
  product_sku         TEXT,
  product_name        TEXT,
  current_qty         DECIMAL(10,3),
  min_stock_threshold DECIMAL(10,3),
  unit                TEXT,
  section_id          UUID,
  section_code        TEXT,
  section_name        TEXT,
  shortfall           DECIMAL(10,3)
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_section_id IS NULL THEN
    -- Global mode : one row per product where the global cache is below threshold.
    RETURN QUERY
    SELECT
      p.id, p.sku, p.name,
      p.current_stock, p.min_stock_threshold, p.unit,
      NULL::UUID, NULL::TEXT, NULL::TEXT,
      (p.min_stock_threshold - p.current_stock) AS shortfall
    FROM products p
    WHERE p.deleted_at IS NULL
      AND p.is_active = true
      AND p.min_stock_threshold > 0
      AND p.current_stock < p.min_stock_threshold
    ORDER BY (p.min_stock_threshold - p.current_stock) DESC, p.name;
  ELSE
    -- Per-section mode : compare section_stock.quantity against
    -- products.min_stock_threshold for products attached to the section.
    RETURN QUERY
    SELECT
      p.id, p.sku, p.name,
      COALESCE(ss.quantity, 0), p.min_stock_threshold, p.unit,
      s.id, s.code, s.name,
      (p.min_stock_threshold - COALESCE(ss.quantity, 0)) AS shortfall
    FROM products p
    LEFT JOIN section_stock ss ON ss.product_id = p.id AND ss.section_id = p_section_id
    JOIN sections s ON s.id = p_section_id
    WHERE p.deleted_at IS NULL
      AND p.is_active = true
      AND p.min_stock_threshold > 0
      AND COALESCE(ss.quantity, 0) < p.min_stock_threshold
    ORDER BY (p.min_stock_threshold - COALESCE(ss.quantity, 0)) DESC, p.name;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION get_low_stock_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_low_stock_v1 TO authenticated;

COMMENT ON FUNCTION get_low_stock_v1 IS
  'Session 13 — Phase 2.D. inventory.read. Returns products below min_stock_threshold. '
  'Global mode (p_section_id NULL) compares products.current_stock. Per-section mode '
  'compares section_stock.quantity. shortfall = threshold - current_qty (positive).';
