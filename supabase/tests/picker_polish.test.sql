-- supabase/tests/picker_polish.test.sql
-- Session 16 / Phase 2.A — covers is_semi_finished flag + trigram ranking.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- search_ingredients_v1 is SECURITY DEFINER and gated by has_permission(uid,
-- 'inventory.read'). We spoof JWT.sub to the seed admin (EMP000) so the
-- permission check passes in the same transaction.

BEGIN;

SELECT plan(8);

-- Bootstrap : pick the seed admin so search_ingredients_v1 sees a valid uid.
DO $bootstrap$
DECLARE
  v_admin_uid   UUID;
  v_category_id UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid
    FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found — apply session 13 seeds first';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);

  SELECT id INTO v_category_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'No active category found — seeds incomplete';
  END IF;
  PERFORM set_config('test.category_id', v_category_id::text, false);
END $bootstrap$;

-- Setup fixture inside the rolled-back transaction.
DO $$
DECLARE
  v_pn  UUID := gen_random_uuid();
  v_mt  UUID := gen_random_uuid();
  v_sf  UUID := gen_random_uuid();
  v_lf  UUID := gen_random_uuid();
  v_cat UUID := current_setting('test.category_id')::uuid;
BEGIN
  -- Leaf material (flour-like).
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_lf, 'TEST-LEAF-1', 'TestLeafCroisant', v_cat, 100, 1000,
          'g', 0.01, 'finished', TRUE);

  -- Sub-recipe (dough-like). Has leaf as material.
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_sf, 'TEST-SUB-1', 'TestSubDough', v_cat, 100, 1000,
          'kg', 0.0, 'finished', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_sf, v_lf, 500, 'g', TRUE);

  -- Semi-finished (croissant pastry uses dough).
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_mt, 'TEST-SEMI-1', 'TestPainChocoMaster', v_cat, 100, 1000,
          'pcs', 0.0, 'finished', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_mt, v_sf, 0.05, 'kg', TRUE);

  -- Plain raw (no recipe).
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_pn, 'TEST-RAW-1', 'TestPureRaw', v_cat, 100, 1000,
          'kg', 1.0, 'finished', TRUE);

  PERFORM set_config('test.leaf', v_lf::text, false);
  PERFORM set_config('test.sub',  v_sf::text, false);
  PERFORM set_config('test.semi', v_mt::text, false);
  PERFORM set_config('test.raw',  v_pn::text, false);
END $$;

SELECT ok(
  (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T1 — semi-finished product has is_semi_finished = TRUE'
);

SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.sub')::uuid),
  'T2 — depth-1 sub-recipe does NOT have is_semi_finished = TRUE'
);

SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.raw')::uuid),
  'T3 — raw product is NOT semi-finished'
);

UPDATE recipes SET is_active = FALSE WHERE product_id = current_setting('test.semi')::uuid;

SELECT ok(
  NOT (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T4 — deactivating sub-recipe rows flips is_semi_finished to FALSE'
);

UPDATE recipes SET is_active = TRUE WHERE product_id = current_setting('test.semi')::uuid;

SELECT ok(
  (SELECT is_semi_finished FROM products WHERE id = current_setting('test.semi')::uuid),
  'T5 — reactivating sub-recipe rows flips is_semi_finished back to TRUE'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM search_ingredients_v1('TestPainChocoMaster', 'semi_finished', 20)
     WHERE product_id = current_setting('test.semi')::uuid
  ),
  'T6 — search_ingredients_v1 returns semi product under kind=semi_finished'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM search_ingredients_v1('croisant', 'all', 20)
     WHERE product_id = current_setting('test.leaf')::uuid
  ),
  'T7 — trigram similarity matches misspelled query'
);

SELECT is(
  (SELECT product_id FROM search_ingredients_v1('TestLeafCroisant', 'all', 5) LIMIT 1),
  current_setting('test.leaf')::uuid,
  'T8 — exact name match wins rank 0'
);

SELECT * FROM finish();
ROLLBACK;
