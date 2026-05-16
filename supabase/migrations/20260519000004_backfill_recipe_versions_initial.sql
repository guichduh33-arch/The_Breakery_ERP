-- 20260519000004_backfill_recipe_versions_initial.sql
-- Session 15 / Phase 1.A — Backfill : initial recipe_versions snapshot per product.
--
-- Idempotent : skips products that already have at least one snapshot. Uses
-- version_number = 1 with change_note = 'backfill_session_15'. created_by is
-- NULL (migration time — no auth context).

INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
SELECT
  r.product_id,
  1 AS version_number,
  jsonb_agg(
    jsonb_build_object(
      'recipe_id',     r.id,
      'material_id',   r.material_id,
      'material_name', m.name,
      'quantity',      r.quantity,
      'unit',          r.unit,
      'notes',         r.notes
    ) ORDER BY m.name
  ) AS snapshot,
  NULL::UUID AS created_by,
  'backfill_session_15' AS change_note
FROM recipes r
JOIN products m ON m.id = r.material_id
WHERE r.is_active = TRUE
  AND r.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM recipe_versions rv WHERE rv.product_id = r.product_id
  )
GROUP BY r.product_id;
