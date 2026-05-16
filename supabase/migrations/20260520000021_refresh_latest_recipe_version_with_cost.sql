-- 20260520000021_refresh_latest_recipe_version_with_cost.sql
-- Session 16 / Phase 2.B — Non-destructive one-time refresh : for every
-- product with at least one active recipe row, create a fresh
-- recipe_versions row carrying the new {items, product_cost_at_version}
-- shape. Older versions stay in the legacy bare-array shape.

WITH bom AS (
  SELECT
    r.product_id,
    jsonb_agg(
      jsonb_build_object(
        'recipe_id',           r.id,
        'material_id',         r.material_id,
        'material_name',       m.name,
        'quantity',            r.quantity,
        'unit',                r.unit,
        'notes',               r.notes,
        'material_cost_price', m.cost_price
      ) ORDER BY m.name
    ) AS items
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.is_active = TRUE
    AND r.deleted_at IS NULL
  GROUP BY r.product_id
),
costed AS (
  SELECT
    b.product_id,
    b.items,
    COALESCE((
      SELECT SUM((it->>'quantity')::NUMERIC * (it->>'material_cost_price')::NUMERIC)
        FROM jsonb_array_elements(b.items) AS it
    ), 0)::NUMERIC(14,2) AS product_cost
  FROM bom b
),
numbered AS (
  SELECT
    c.product_id,
    c.items,
    c.product_cost,
    COALESCE((SELECT MAX(version_number) FROM recipe_versions rv WHERE rv.product_id = c.product_id), 0) + 1 AS next_version
  FROM costed c
)
INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
SELECT
  n.product_id,
  n.next_version,
  jsonb_build_object(
    'items',                   n.items,
    'product_cost_at_version', n.product_cost
  ),
  NULL,
  'cost_snapshot_refresh'
FROM numbered n;
