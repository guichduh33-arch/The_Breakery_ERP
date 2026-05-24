-- 20260615000016_create_get_stock_movements_v1_rpc.sql
-- S30 Wave 1.A.2 — Stock Movement history (cursor-paginated).
-- NOTE: a pre-existing 8-arg overload of get_stock_movements_v1 exists from a prior session.
-- This migration adds the S30 6-arg overload as a separate signature.
CREATE OR REPLACE FUNCTION get_stock_movements_v1(
  p_start          TEXT,
  p_end            TEXT,
  p_product_id     UUID        DEFAULT NULL,
  p_movement_type  TEXT        DEFAULT NULL,
  p_limit          INT         DEFAULT 50,
  p_cursor         TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_clamp     INT := LEAST(GREATEST(p_limit, 1), 200);
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'reports.inventory.read') THEN
    RAISE EXCEPTION 'Permission denied: reports.inventory.read' USING ERRCODE = '42501';
  END IF;

  -- Fetch v_clamp + 1 rows to detect next page
  WITH filtered AS (
    SELECT
      sm.id,
      sm.product_id,
      p.name            AS product_name,
      sm.movement_type::text AS movement_type,
      sm.quantity,
      sm.unit_cost,
      sm.lot_id,
      sm.reference_type,
      sm.reference_id,
      sm.created_by,
      sm.created_at,
      ROW_NUMBER() OVER (ORDER BY sm.created_at DESC) AS rn
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    WHERE sm.created_at BETWEEN v_start AND v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_cursor        IS NULL OR sm.created_at          < p_cursor)
    ORDER BY sm.created_at DESC
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
      ) ORDER BY f.created_at DESC)
      FILTER (WHERE f.rn <= v_clamp),
      '[]'::jsonb
    )
  INTO v_lines
  FROM filtered f
  LEFT JOIN user_profiles up ON up.id = f.created_by;

  -- Determine next cursor: the created_at of the (v_clamp + 1)th row if it exists
  WITH filtered AS (
    SELECT sm.created_at,
      ROW_NUMBER() OVER (ORDER BY sm.created_at DESC) AS rn
    FROM stock_movements sm
    WHERE sm.created_at BETWEEN v_start AND v_end
      AND (p_product_id    IS NULL OR sm.product_id          = p_product_id)
      AND (p_movement_type IS NULL OR sm.movement_type::text = p_movement_type)
      AND (p_cursor        IS NULL OR sm.created_at          < p_cursor)
    ORDER BY sm.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT MIN(created_at) INTO v_next
  FROM filtered
  WHERE rn > v_clamp;

  RETURN jsonb_build_object(
    'lines',       v_lines,
    'next_cursor', v_next
  );
END;
$$;

COMMENT ON FUNCTION get_stock_movements_v1(TEXT, TEXT, UUID, TEXT, INT, TIMESTAMPTZ) IS
  'S30 : Stock Movement history — cursor-paginated, optional product_id/movement_type filters.';
