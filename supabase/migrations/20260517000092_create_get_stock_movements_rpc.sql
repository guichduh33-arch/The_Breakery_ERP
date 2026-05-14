-- 20260517000092_create_get_stock_movements_rpc.sql
-- Session 13 / Phase 2.D — Movements ledger view (Session 12 phase 6).
--
-- get_stock_movements_v1 : cursor-paginated, filterable.
--   - p_section_id : matches from_section_id OR to_section_id.
--   - p_product_id : exact match.
--   - p_movement_type : NULL = all, or one specific type.
--   - p_date_start / p_date_end : created_at window.
--   - p_cursor / p_cursor_id : cursor pagination (rows older than (cursor, cursor_id)).
--   - p_limit : hard-capped at 200 to bound DB load.
--
-- Returns enriched rows (product name + sku, section codes, supplier name, author).

CREATE OR REPLACE FUNCTION get_stock_movements_v1(
  p_section_id     UUID         DEFAULT NULL,
  p_product_id     UUID         DEFAULT NULL,
  p_movement_type  TEXT         DEFAULT NULL,
  p_date_start     TIMESTAMPTZ  DEFAULT NULL,
  p_date_end       TIMESTAMPTZ  DEFAULT NULL,
  p_cursor         TIMESTAMPTZ  DEFAULT NULL,
  p_cursor_id      UUID         DEFAULT NULL,
  p_limit          INT          DEFAULT 100
) RETURNS TABLE (
  id              UUID,
  product_id      UUID,
  product_sku     TEXT,
  product_name    TEXT,
  movement_type   movement_type,
  quantity        DECIMAL(10,3),
  unit            TEXT,
  reason          TEXT,
  unit_cost       DECIMAL(14,2),
  from_section_id UUID,
  from_section_code TEXT,
  to_section_id   UUID,
  to_section_code TEXT,
  supplier_id     UUID,
  supplier_name   TEXT,
  reference_type  TEXT,
  reference_id    UUID,
  lot_id          UUID,
  created_at      TIMESTAMPTZ,
  created_by      UUID,
  author_name     TEXT,
  metadata        JSONB
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_limit INT;
BEGIN
  IF NOT has_permission(auth.uid(), 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

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
END $$;

REVOKE EXECUTE ON FUNCTION get_stock_movements_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION get_stock_movements_v1 TO authenticated;

COMMENT ON FUNCTION get_stock_movements_v1 IS
  'Session 13 — Phase 2.D. inventory.read. Cursor-paginated stock movements feed '
  'with filters (section, product, movement_type, date range). Page tail = '
  '(created_at, id) of last row ; pass back as p_cursor + p_cursor_id. Hard-capped '
  'at 200 rows per call.';
