-- 20260626000014_transfer_validates_track_inventory_not_is_active.sql
-- Corrective découverte pendant B4 (audit M1 au niveau DB) :
-- create_internal_transfer_v1 validait les items avec `is_active = true`
-- (= « vendable au POS ») alors que les 15 ingrédients sont is_active=false /
-- track_inventory=true. Le front (fix A3, ae1ba4f) liste désormais les
-- ingrédients dans le picker des transferts → le RPC les rejetait en
-- product_not_found. Doctrine M1 : le bon gate stock est track_inventory.
-- Signature inchangée — DO-block pg_get_functiondef + replace (pattern S38).

DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_internal_transfer_v1'::regproc) INTO v_def;
  IF position('SELECT track_inventory, unit INTO v_product_active' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  v_def := replace(v_def,
$anchor$    SELECT is_active, unit INTO v_product_active, v_product_unit
      FROM products WHERE id = v_pid AND deleted_at IS NULL;$anchor$,
$new$    SELECT track_inventory, unit INTO v_product_active, v_product_unit
      FROM products WHERE id = v_pid AND deleted_at IS NULL;$new$);
  EXECUTE v_def;
END $do$;
