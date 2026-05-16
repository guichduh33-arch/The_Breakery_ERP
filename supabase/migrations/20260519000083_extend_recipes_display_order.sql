-- 20260519000083_extend_recipes_display_order.sql
-- Session 15 / Phase 3.B — RecipeEditor row reorder support.
--
-- Adds a NULLABLE `display_order INT` column to `recipes` so the editor can
-- persist a stable visual ordering across reloads. NULL values fall back to
-- `created_at` ordering at read time (callers using `list_recipes_v1` keep
-- working unchanged).
--
-- Backfill : for every (product_id) we set display_order = row_number() over
-- (PARTITION BY product_id ORDER BY created_at) so existing rows start with
-- a sane sequence (1..N).
--
-- A small SECURITY DEFINER RPC `reorder_recipe_rows_v1(p_product_id UUID,
-- p_recipe_ids UUID[])` is shipped alongside : it validates ownership (every
-- id belongs to p_product_id, is active, not deleted) and rewrites
-- display_order in a single atomic UPDATE. Gated by inventory.recipes.update.

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS display_order INT;

COMMENT ON COLUMN recipes.display_order IS
  'Optional manual order (1..N) maintained by the RecipeEditor UI. NULL '
  'rows fall back to created_at ASC at render time.';

CREATE INDEX IF NOT EXISTS idx_recipes_product_display_order
  ON recipes(product_id, display_order)
  WHERE deleted_at IS NULL;

-- Backfill : assign 1..N per product, ordered by created_at.
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY created_at, id) AS rn
    FROM recipes
   WHERE deleted_at IS NULL
)
UPDATE recipes r
   SET display_order = o.rn
  FROM ordered o
 WHERE r.id = o.id
   AND r.display_order IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- reorder_recipe_rows_v1 — atomic batch reorder.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reorder_recipe_rows_v1(
  p_product_id UUID,
  p_recipe_ids UUID[]
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_count     INT;
  v_input_len INT := COALESCE(array_length(p_recipe_ids, 1), 0);
BEGIN
  IF NOT has_permission(v_uid, 'inventory.recipes.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_input_len = 0 THEN
    RETURN 0;
  END IF;

  -- Every supplied recipe id must belong to p_product_id and be active.
  SELECT COUNT(*) INTO v_count
    FROM recipes
   WHERE id = ANY(p_recipe_ids)
     AND product_id = p_product_id
     AND is_active  = TRUE
     AND deleted_at IS NULL;

  IF v_count <> v_input_len THEN
    RAISE EXCEPTION 'recipe_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format('expected %s ids belonging to product %s, found %s',
                             v_input_len, p_product_id, v_count);
  END IF;

  -- Apply the new order using a 1-based ordinality on the input array.
  UPDATE recipes r
     SET display_order = pos.idx,
         updated_at    = now()
    FROM unnest(p_recipe_ids) WITH ORDINALITY AS pos(recipe_id, idx)
   WHERE r.id = pos.recipe_id
     AND r.product_id = p_product_id
     AND r.deleted_at IS NULL;

  RETURN v_input_len;
END $$;

REVOKE EXECUTE ON FUNCTION reorder_recipe_rows_v1(UUID, UUID[]) FROM public;
GRANT  EXECUTE ON FUNCTION reorder_recipe_rows_v1(UUID, UUID[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION reorder_recipe_rows_v1(UUID, UUID[]) FROM anon;

COMMENT ON FUNCTION reorder_recipe_rows_v1(UUID, UUID[]) IS
  'Session 15 — Phase 3.B. Atomic batch reorder of recipe rows for a single '
  'product. Validates every supplied id belongs to the product. Gated by '
  'inventory.recipes.update.';

-- ──────────────────────────────────────────────────────────────────────────────
-- list_recipes_v1 (bump) — expose display_order and order by it.
-- Signature unchanged (single UUID input, SETOF JSONB output).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION list_recipes_v1(p_product_id UUID)
RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  RETURN QUERY
    SELECT jsonb_build_object(
      'recipe_id',     r.id,
      'product_id',    r.product_id,
      'product_name',  p.name,
      'product_unit',  p.unit,
      'material_id',   r.material_id,
      'material_name', m.name,
      'material_unit', m.unit,
      'material_cost_price', m.cost_price,
      'quantity',      r.quantity,
      'unit',          r.unit,
      'is_active',     r.is_active,
      'notes',         r.notes,
      'display_order', r.display_order,
      'created_at',    r.created_at,
      'updated_at',    r.updated_at
    )
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    JOIN products m ON m.id = r.material_id
    WHERE r.product_id = p_product_id
      AND r.is_active = TRUE
      AND r.deleted_at IS NULL
    ORDER BY r.display_order NULLS LAST, r.created_at, m.name;
END $$;

COMMENT ON FUNCTION list_recipes_v1(UUID) IS
  'Session 15 — Phase 3.B (bumped). Lists active recipe rows for a product, '
  'ordered by display_order then created_at. Gated by inventory.read.';
