-- 20260519000003_init_recipe_versions.sql
-- Session 15 / Phase 1.A — F6 sub-recipes : recipe_versions snapshot history.
--
-- Decision D4 : trigger AFTER INSERT/UPDATE/DELETE on `recipes` (FOR EACH ROW).
-- At each modification, snapshot the FULL CURRENT BoM of the affected
-- product_id into recipe_versions (one row per snapshot, jsonb aggregates
-- all active+non-deleted lines). One snapshot per change event — even bulk
-- multi-row INSERTs produce one snapshot per row (acceptable for audit ;
-- the seed backfill in migration 000004 produces a baseline version_number=1).
--
-- pg_trigger_depth() < 1 guard prevents infinite recursion when the snapshot
-- trigger itself somehow triggers another recipe operation.
--
-- created_by resolved best-effort from auth.uid() → user_profiles.id ; NULL
-- when called outside an authenticated session (seed, admin SQL).
--
-- RLS : authenticated SELECT (inventory.read). REVOKE INSERT/UPDATE/DELETE
-- from authenticated — writes only via the snapshot trigger.

CREATE TABLE recipe_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  version_number  INT  NOT NULL,
  snapshot        JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  change_note     TEXT,
  UNIQUE (product_id, version_number)
);

CREATE INDEX idx_recipe_versions_product
  ON recipe_versions(product_id, version_number DESC);

CREATE INDEX idx_recipe_versions_created_at
  ON recipe_versions(created_at DESC);

COMMENT ON TABLE recipe_versions IS
  'Session 15 — Phase 1.A. Append-only snapshot of the full BoM (active+non-deleted '
  'recipe rows) for a product at the moment of a recipes table change. '
  'production_records.recipe_version_id FKs the snapshot that was current when the '
  'production batch ran (anti-rétroactivité COGS).';
COMMENT ON COLUMN recipe_versions.snapshot IS
  'JSONB array : [{material_id, material_name, quantity, unit, notes}, ...]. '
  'Materialises the BoM lines so historical productions remain explainable '
  'even after the recipe is edited.';
COMMENT ON COLUMN recipe_versions.version_number IS
  'Monotonic per product_id starting at 1 (backfill seed). Auto-incremented '
  'by the snapshot trigger as MAX(existing) + 1.';

ALTER TABLE recipe_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON recipe_versions FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON recipe_versions FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON recipe_versions FROM anon;

-- ──────────────────────────────────────────────────────────────────────────────
-- Snapshot trigger function
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tr_snapshot_recipe_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_next_version INT;
  v_snapshot JSONB;
  v_profile UUID;
  v_action TEXT;
BEGIN
  -- Avoid recursion if the trigger somehow re-enters.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD.product_id;
    v_action := 'delete';
  ELSE
    v_product_id := NEW.product_id;
    v_action := lower(TG_OP);
  END IF;

  -- Build the current BoM snapshot (all active+non-deleted lines for this product).
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'recipe_id',     r.id,
        'material_id',   r.material_id,
        'material_name', m.name,
        'quantity',      r.quantity,
        'unit',          r.unit,
        'notes',         r.notes
      ) ORDER BY m.name
    ),
    '[]'::jsonb
  )
  INTO v_snapshot
  FROM recipes r
  JOIN products m ON m.id = r.material_id
  WHERE r.product_id = v_product_id
    AND r.is_active = TRUE
    AND r.deleted_at IS NULL;

  -- Compute next version number.
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM recipe_versions
   WHERE product_id = v_product_id;

  -- Resolve actor best-effort.
  BEGIN
    SELECT id INTO v_profile FROM user_profiles
      WHERE auth_user_id = auth.uid() AND deleted_at IS NULL;
  EXCEPTION WHEN OTHERS THEN
    v_profile := NULL;
  END;

  INSERT INTO recipe_versions (product_id, version_number, snapshot, created_by, change_note)
  VALUES (v_product_id, v_next_version, v_snapshot, v_profile, v_action);

  RETURN NULL;
END $$;

COMMENT ON FUNCTION tr_snapshot_recipe_version() IS
  'Session 15 — Phase 1.A. AFTER INSERT/UPDATE/DELETE trigger on `recipes`. '
  'Snapshots the full current BoM of the affected product into recipe_versions, '
  'auto-incrementing version_number per product. Best-effort created_by from auth.uid().';

DROP TRIGGER IF EXISTS tr_recipes_snapshot_version ON recipes;

CREATE TRIGGER tr_recipes_snapshot_version
  AFTER INSERT OR UPDATE OR DELETE ON recipes
  FOR EACH ROW
  EXECUTE FUNCTION tr_snapshot_recipe_version();
