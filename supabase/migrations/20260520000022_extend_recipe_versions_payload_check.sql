-- 20260520000022_extend_recipe_versions_payload_check.sql
-- Session 16 / Phase 2.B — Enforce new payload shape going forward, exempt
-- legacy rows. Legacy rows are detected by snapshot being a JSONB array
-- (jsonb_typeof(snapshot) = 'array'). New rows MUST be jsonb_typeof = 'object'
-- AND contain `items` (array) + `product_cost_at_version` (number).
--
-- jsonb_typeof discriminator is more robust than a created_at < timestamp
-- predicate — survives clock drift, partial backfills, future refresh runs.

ALTER TABLE recipe_versions
  ADD CONSTRAINT recipe_versions_snapshot_shape_chk
  CHECK (
    jsonb_typeof(snapshot) = 'array'
    OR (
      jsonb_typeof(snapshot) = 'object'
      AND snapshot ? 'items'
      AND snapshot ? 'product_cost_at_version'
      AND jsonb_typeof(snapshot -> 'items') = 'array'
      AND jsonb_typeof(snapshot -> 'product_cost_at_version') = 'number'
    )
  )
  NOT VALID;

ALTER TABLE recipe_versions
  VALIDATE CONSTRAINT recipe_versions_snapshot_shape_chk;

COMMENT ON CONSTRAINT recipe_versions_snapshot_shape_chk ON recipe_versions IS
  'Session 16 / Phase 2.B. Accept legacy bare-array snapshots OR new '
  '{items, product_cost_at_version} object snapshots. Other shapes rejected.';
