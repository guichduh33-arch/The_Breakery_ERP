-- 20260521000020_create_recipe_bom_full_v1_rpc.sql
-- Session 17 / Phase 1.D — Server-side leaves-only BoM for production preview.
-- Resolves DEV-S16-2.C-01 (single RPC vs N round-trips) + 2.C-02 (depth-5).
-- Mirrors record_batch_production_v1's server cascade (source of truth).
--
-- Fix applied inline: anchor qty cast to NUMERIC to resolve type mismatch with
-- the recursive arm (recipes.quantity is NUMERIC(10,3); multiplication produces
-- unconstrained NUMERIC). Applied as single CREATE OR REPLACE (no separate fix
-- migration needed — both apply_ calls were in the same session before commit).

CREATE OR REPLACE FUNCTION recipe_bom_full_v1(
  p_product_id UUID,
  p_max_depth  INT DEFAULT 5
) RETURNS TABLE(
  material_id    UUID,
  material_name  TEXT,
  material_unit  TEXT,
  qty_per_unit   NUMERIC,
  current_stock  NUMERIC,
  cost_price     NUMERIC
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_max_depth IS NULL OR p_max_depth < 1 OR p_max_depth > 20 THEN
    RAISE EXCEPTION 'invalid_max_depth' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  WITH RECURSIVE walk AS (
    -- Anchor: cast quantity to plain NUMERIC so the recursive arm's
    -- multiplication (NUMERIC * NUMERIC(10,3)) matches the column type.
    SELECT r.product_id    AS root_id,
           r.material_id,
           r.quantity::NUMERIC      AS qty,
           1               AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path
      FROM recipes r
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT w.root_id,
           r.material_id,
           (w.qty * r.quantity::NUMERIC),
           w.depth + 1,
           w.path || r.material_id
      FROM walk w
      JOIN recipes r
        ON r.product_id = w.material_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
     WHERE w.depth < p_max_depth
       AND NOT (r.material_id = ANY(w.path))
  ),
  leaves AS (
    SELECT w.material_id, SUM(w.qty) AS qty_agg
      FROM walk w
     WHERE NOT EXISTS (
       SELECT 1 FROM recipes c
        WHERE c.product_id = w.material_id
          AND c.is_active = TRUE
          AND c.deleted_at IS NULL
     )
     GROUP BY w.material_id
  )
  SELECT l.material_id, p.name, p.unit, l.qty_agg, p.current_stock, p.cost_price
    FROM leaves l
    JOIN products p ON p.id = l.material_id
   ORDER BY p.name;
END $$;

GRANT EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) TO authenticated;
REVOKE EXECUTE ON FUNCTION recipe_bom_full_v1(UUID, INT) FROM anon;

COMMENT ON FUNCTION recipe_bom_full_v1(UUID, INT) IS
  'Session 17 / Phase 1.D. Server-side leaves-only BoM for IngredientAggregatePreview. '
  'WITH RECURSIVE cascade depth=p_max_depth (default 5). Cycle guard via path[]. '
  'Aggregates by material_id (sum qty). Gated by inventory.read. '
  'Fix: anchor qty cast to NUMERIC to match recursive multiplication result type.';
