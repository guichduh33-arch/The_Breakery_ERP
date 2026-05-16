-- 20260519000150_extend_recipes_baker_percentage.sql
-- Session 15 / Phase 5.B — Boulanger's percentages on recipes.
--
-- Spec §D13 — adds two NULLABLE/BOOLEAN columns on `recipes` to let bakers
-- express ingredient quantities as percentages of flour (the "pivot" row).
--
-- Columns :
--   is_baker_percentage BOOLEAN NOT NULL DEFAULT FALSE
--   baker_percentage    DECIMAL(7,2) NULL — 0..1000 (enrichments may exceed
--                       100% of flour ; e.g. enriched brioche : butter 80%,
--                       eggs 60%, sugar 25%).
--
-- Pivot convention (per spec §D13) : within a (product_id) recipe set, the
-- row whose `baker_percentage = 100.00` is the flour pivot ; every other
-- row's `baker_percentage` is read relative to that flour mass.
--
-- Mode is intended to be uniform per product : either ALL active rows have
-- `is_baker_percentage = TRUE` or NONE do. The application layer enforces
-- this (a single toggle applies to every active row). The DB allows mixed
-- mode but `convert_baker_recipe_to_absolute_v1` skips non-baker rows.
--
-- Check constraint : if `is_baker_percentage = TRUE`, `baker_percentage`
-- must be set ; baker_percentage range guarded.
--
-- Helper RPC : `convert_baker_recipe_to_absolute_v1(product_id, target_flour_qty)`
-- returns a jsonb { product_id, target_flour_qty, rows: [{ recipe_id,
-- material_id, material_name, baker_percentage, absolute_qty, unit }] }.
-- Gated by `inventory.read` (mirrors `list_recipes_v1`).

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS is_baker_percentage BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS baker_percentage DECIMAL(7,2) NULL;

-- Range guard : 0..1000 (1000% = ten times the flour mass — generous upper
-- bound to accommodate even the wildest enriched-dough recipes).
ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS recipes_baker_percentage_range_chk;
ALTER TABLE recipes
  ADD CONSTRAINT recipes_baker_percentage_range_chk
    CHECK (
      baker_percentage IS NULL
      OR (baker_percentage >= 0 AND baker_percentage <= 1000)
    );

-- Required-when-on guard : if baker mode is on for a row, the percentage
-- must be populated.
ALTER TABLE recipes
  DROP CONSTRAINT IF EXISTS recipes_baker_percentage_required_chk;
ALTER TABLE recipes
  ADD CONSTRAINT recipes_baker_percentage_required_chk
    CHECK (
      (is_baker_percentage = FALSE)
      OR (baker_percentage IS NOT NULL)
    );

COMMENT ON COLUMN recipes.is_baker_percentage IS
  'Session 15 — Phase 5.B / spec §D13. When TRUE this row is expressed as a '
  'percentage of flour (baker_percentage) instead of an absolute quantity. '
  'Intended uniform per product (UI enforces this).';

COMMENT ON COLUMN recipes.baker_percentage IS
  'Session 15 — Phase 5.B / spec §D13. Percentage of the flour-pivot mass '
  '(the row with baker_percentage=100). Range 0..1000 ; >100 allowed for '
  'enrichments (butter, eggs, sugar). NULL when is_baker_percentage=FALSE.';

COMMENT ON TABLE recipes IS
  'BoM rows : quantity of (material_id) needed to make 1 unit of '
  '(product_id). Session 15 / Phase 5.B adds optional baker''s-percentage '
  'mode (spec §D13) : when is_baker_percentage=TRUE, baker_percentage is '
  'read relative to the row whose baker_percentage=100 (the flour pivot). '
  'Use convert_baker_recipe_to_absolute_v1(product, flour_qty) to flatten '
  'to absolute quantities for production.';

-- ─────────────────────────────────────────────────────────────────────────────
-- convert_baker_recipe_to_absolute_v1 — flatten baker percentages.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION convert_baker_recipe_to_absolute_v1(
  p_product_id       UUID,
  p_target_flour_qty NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid           UUID := auth.uid();
  v_has_baker     BOOLEAN;
  v_has_pivot     BOOLEAN;
  v_rows          JSONB;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  IF p_target_flour_qty IS NULL OR p_target_flour_qty <= 0 THEN
    RAISE EXCEPTION 'target_flour_qty_must_be_positive' USING ERRCODE='P0001';
  END IF;

  -- Detect baker rows + pivot presence in one scan.
  SELECT
    bool_or(is_baker_percentage),
    bool_or(is_baker_percentage AND baker_percentage = 100.00)
  INTO v_has_baker, v_has_pivot
  FROM recipes
  WHERE product_id = p_product_id
    AND is_active  = TRUE
    AND deleted_at IS NULL;

  IF v_has_baker IS NOT TRUE THEN
    -- No baker rows for this product : return an empty result set with the
    -- target flour qty echoed so callers can detect "nothing to convert".
    RETURN jsonb_build_object(
      'product_id',       p_product_id,
      'target_flour_qty', p_target_flour_qty,
      'rows',             '[]'::jsonb
    );
  END IF;

  IF v_has_pivot IS NOT TRUE THEN
    RAISE EXCEPTION 'pivot_not_found'
      USING ERRCODE = 'P0002',
            DETAIL  = format(
              'product %s has baker rows but no row with baker_percentage=100',
              p_product_id
            );
  END IF;

  -- Compute absolute_qty for every baker row. Mixed-mode rows (FALSE) are
  -- intentionally skipped — the UI prevents mixed mode, but if it happens
  -- the converter ignores absolute rows so they keep their stored quantity
  -- unchanged.
  SELECT jsonb_agg(
    jsonb_build_object(
      'recipe_id',        r.id,
      'material_id',      r.material_id,
      'material_name',    m.name,
      'baker_percentage', r.baker_percentage,
      'absolute_qty',     ROUND(r.baker_percentage / 100.00 * p_target_flour_qty, 4),
      'unit',             r.unit
    )
    ORDER BY r.display_order NULLS LAST, r.created_at, m.name
  )
  INTO v_rows
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.product_id          = p_product_id
    AND r.is_baker_percentage = TRUE
    AND r.is_active           = TRUE
    AND r.deleted_at          IS NULL;

  RETURN jsonb_build_object(
    'product_id',       p_product_id,
    'target_flour_qty', p_target_flour_qty,
    'rows',             COALESCE(v_rows, '[]'::jsonb)
  );
END $$;

REVOKE EXECUTE ON FUNCTION convert_baker_recipe_to_absolute_v1(UUID, NUMERIC) FROM public;
GRANT  EXECUTE ON FUNCTION convert_baker_recipe_to_absolute_v1(UUID, NUMERIC) TO authenticated;
REVOKE EXECUTE ON FUNCTION convert_baker_recipe_to_absolute_v1(UUID, NUMERIC) FROM anon;

COMMENT ON FUNCTION convert_baker_recipe_to_absolute_v1(UUID, NUMERIC) IS
  'Session 15 — Phase 5.B / spec §D13. Walks active baker rows for a '
  'product and returns absolute quantities computed against a target flour '
  'mass. Raises pivot_not_found if baker rows exist but none has '
  'baker_percentage=100. STABLE SECURITY DEFINER, gated by inventory.read.';
