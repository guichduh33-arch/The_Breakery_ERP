-- 20260516000010_create_get_stock_levels_rpc.sql
-- Session 12 / migration 10 : get_stock_levels_v1 (read paginated, MANAGER+).
-- Returns product stock levels with category name + last movement timestamp.
-- Gated by inventory.read permission.

CREATE OR REPLACE FUNCTION get_stock_levels_v1(
  p_category_id    UUID    DEFAULT NULL,
  p_search         TEXT    DEFAULT NULL,
  p_low_stock_only BOOLEAN DEFAULT false,
  p_limit          INT     DEFAULT 50,
  p_offset         INT     DEFAULT 0
) RETURNS TABLE (
  product_id          UUID,
  sku                 TEXT,
  name                TEXT,
  category_id         UUID,
  category_name       TEXT,
  current_stock       DECIMAL(10,3),
  min_stock_threshold DECIMAL(10,3),
  last_movement_at    TIMESTAMPTZ,
  total_count         BIGINT
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT p.id, p.sku, p.name, p.category_id, c.name AS cat_name,
           p.current_stock, p.min_stock_threshold,
           (SELECT max(sm.created_at) FROM stock_movements sm WHERE sm.product_id = p.id) AS last_mvt
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.deleted_at IS NULL
       AND (p_category_id IS NULL OR p.category_id = p_category_id)
       AND (p_search IS NULL OR p.name ILIKE '%' || p_search || '%' OR p.sku ILIKE '%' || p_search || '%')
       AND (NOT p_low_stock_only
            OR (p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold))
  ), counted AS (SELECT COUNT(*) AS total FROM filtered)
  SELECT f.id, f.sku, f.name, f.category_id, f.cat_name,
         f.current_stock, f.min_stock_threshold, f.last_mvt,
         (SELECT total FROM counted)
    FROM filtered f
   ORDER BY f.name
   LIMIT p_limit OFFSET p_offset;
END $$;

REVOKE EXECUTE ON FUNCTION get_stock_levels_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_stock_levels_v1 TO authenticated;
-- Note: SECURITY INVOKER + explicit has_permission gate. The function calls
-- has_permission (which is SECURITY DEFINER) so the role check runs as owner.

COMMENT ON FUNCTION get_stock_levels_v1 IS
  'MANAGER+. Paginated stock levels with category name + last movement timestamp. '
  'Filters: category_id, search (ILIKE on sku/name), low_stock_only.';
