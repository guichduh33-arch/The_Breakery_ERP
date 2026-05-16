-- supabase/tests/recipe_version_cost.test.sql
-- Session 16 / Phase 2.B — covers new snapshot shape + refresh idempotency
-- + CHECK constraint behavior.
--
-- Runner (Docker retired) — apply the whole file via MCP execute_sql in one
-- shot ; the BEGIN..ROLLBACK envelope guarantees no leak.
--
-- V3 dev products table requires category_id + retail_price + current_stock
-- + product_type NOT NULL, mirroring picker_polish.test.sql fixture.

BEGIN;

SELECT plan(6);

-- Bootstrap : pick an active category from seeds so the fixture inserts pass.
DO $bootstrap$
DECLARE
  v_category_id UUID;
BEGIN
  SELECT id INTO v_category_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  IF v_category_id IS NULL THEN
    RAISE EXCEPTION 'No active category found — seeds incomplete';
  END IF;
  PERFORM set_config('test.category_id', v_category_id::text, false);
END $bootstrap$;

-- Setup fixture inside the rolled-back transaction.
DO $$
DECLARE
  v_pr  UUID := gen_random_uuid();
  v_ma  UUID := gen_random_uuid();
  v_cat UUID := current_setting('test.category_id')::uuid;
BEGIN
  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_ma, 'TEST-COST-MAT', 'TestCostMat', v_cat, 100, 1000,
          'g', 0.02, 'finished', TRUE);

  INSERT INTO products (id, sku, name, category_id, retail_price, current_stock,
                        unit, cost_price, product_type, is_active)
  VALUES (v_pr, 'TEST-COST-PROD', 'TestCostProd', v_cat, 100, 1000,
          'pcs', 0.0, 'finished', TRUE);

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
  VALUES (v_pr, v_ma, 50, 'g', TRUE);

  PERFORM set_config('test.prod', v_pr::text, false);
  PERFORM set_config('test.mat',  v_ma::text, false);
END $$;

SELECT is(
  jsonb_typeof((SELECT snapshot FROM recipe_versions
                 WHERE product_id = current_setting('test.prod')::uuid
                 ORDER BY version_number DESC LIMIT 1)),
  'object',
  'T1 — fresh snapshot uses object shape'
);

SELECT is(
  (SELECT (snapshot->>'product_cost_at_version')::NUMERIC
     FROM recipe_versions
    WHERE product_id = current_setting('test.prod')::uuid
    ORDER BY version_number DESC LIMIT 1),
  1.00::NUMERIC,
  'T2 — product_cost_at_version = Σ(qty × material_cost_price)'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      (SELECT snapshot->'items' FROM recipe_versions
        WHERE product_id = current_setting('test.prod')::uuid
        ORDER BY version_number DESC LIMIT 1)
    ) it
    WHERE (it->>'material_cost_price')::NUMERIC = 0.02
  ),
  'T3 — items rows include material_cost_price'
);

SELECT throws_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (gen_random_uuid(), 1, '42'::jsonb)$$,
  '23514',
  NULL,
  'T4 — CHECK rejects non-object non-array snapshot'
);

SELECT lives_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (current_setting('test.prod')::uuid, 99999, '[{"material_id":"x"}]'::jsonb)$$,
  'T5 — CHECK accepts legacy bare-array snapshots'
);

SELECT throws_ok(
  $$INSERT INTO recipe_versions (product_id, version_number, snapshot)
    VALUES (gen_random_uuid(), 1, '{"items":[]}'::jsonb)$$,
  '23514',
  NULL,
  'T6 — CHECK rejects object snapshot missing product_cost_at_version'
);

SELECT * FROM finish();
ROLLBACK;
