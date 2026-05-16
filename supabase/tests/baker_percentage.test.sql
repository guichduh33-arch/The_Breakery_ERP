-- supabase/tests/baker_percentage.test.sql
-- Session 15 / Phase 5.B — Baker's percentage pgTAP suite.
--
-- Coverage matrix :
--   T1 — CHECK constraint : is_baker_percentage=TRUE + baker_percentage=NULL
--        is rejected.
--   T2 — Flat-mode row (is_baker_percentage=FALSE, baker_percentage=NULL) is
--        accepted (regression : default flat mode keeps working).
--   T3 — convert_baker_recipe_to_absolute_v1 against a pivot recipe
--        (100% flour, 70% water, 2% salt, 5% yeast) with target 1000 g
--        returns flour=1000, water=700, salt=20, yeast=50.
--   T4 — Product with is_baker_percentage=TRUE but no pivot (=100) row
--        raises pivot_not_found.
--
-- Runner : execute via MCP execute_sql under BEGIN..ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

-- ---------------------------------------------------------------------------
-- Bootstrap
-- ---------------------------------------------------------------------------
DO $boot$
DECLARE
  v_admin_uid   UUID;
  v_category_id UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid   FROM user_profiles WHERE employee_code='EMP000';
  SELECT id           INTO v_category_id FROM categories    WHERE deleted_at IS NULL LIMIT 1;

  PERFORM set_config('bp.admin_uid',   v_admin_uid::text,   false);
  PERFORM set_config('bp.category_id', v_category_id::text, false);
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $boot$;

-- Helper : create a finished product + N materials, return ids in a TEMP TABLE.
CREATE TEMP TABLE bp_ids (
  k TEXT PRIMARY KEY,
  v UUID NOT NULL
);

DO $seed$
DECLARE
  v_prod  UUID;
  v_flour UUID;
  v_water UUID;
  v_salt  UUID;
  v_yeast UUID;
BEGIN
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('BP-PROD', 'BP Baguette', current_setting('bp.category_id')::uuid, 30000, 0, 'pcs', 0, 'finished', TRUE)
    RETURNING id INTO v_prod;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('BP-FLOUR', 'BP Flour', current_setting('bp.category_id')::uuid, 0, 10000, 'g', 10, 'finished', TRUE)
    RETURNING id INTO v_flour;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('BP-WATER', 'BP Water', current_setting('bp.category_id')::uuid, 0, 10000, 'g', 0, 'finished', TRUE)
    RETURNING id INTO v_water;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('BP-SALT', 'BP Salt', current_setting('bp.category_id')::uuid, 0, 10000, 'g', 5, 'finished', TRUE)
    RETURNING id INTO v_salt;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active)
    VALUES ('BP-YEAST', 'BP Yeast', current_setting('bp.category_id')::uuid, 0, 10000, 'g', 50, 'finished', TRUE)
    RETURNING id INTO v_yeast;

  INSERT INTO bp_ids(k, v) VALUES
    ('prod',  v_prod),
    ('flour', v_flour),
    ('water', v_water),
    ('salt',  v_salt),
    ('yeast', v_yeast);
END $seed$;

-- ---------------------------------------------------------------------------
-- T1 — is_baker_percentage=TRUE + baker_percentage=NULL is rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $sql$
    INSERT INTO recipes (product_id, material_id, quantity, unit, is_active, is_baker_percentage, baker_percentage)
    VALUES (
      (SELECT v FROM bp_ids WHERE k='prod'),
      (SELECT v FROM bp_ids WHERE k='flour'),
      1, 'g', TRUE, TRUE, NULL
    )
  $sql$,
  '23514',
  NULL,
  'T1 — required-when-on check rejects is_baker_percentage=TRUE with NULL baker_percentage'
);

-- ---------------------------------------------------------------------------
-- T2 — Flat-mode row accepted (is_baker_percentage=FALSE, baker_percentage=NULL).
-- ---------------------------------------------------------------------------
DO $t2$
DECLARE
  v_row_id UUID;
BEGIN
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active, is_baker_percentage, baker_percentage)
    VALUES (
      (SELECT v FROM bp_ids WHERE k='prod'),
      (SELECT v FROM bp_ids WHERE k='flour'),
      500, 'g', TRUE, FALSE, NULL
    )
    RETURNING id INTO v_row_id;
  -- Clean up so T3 can re-insert with baker mode on the same (product, flour).
  DELETE FROM recipes WHERE id = v_row_id;
END $t2$;

SELECT pass('T2 — flat-mode row insert with is_baker_percentage=FALSE, baker_percentage=NULL accepted');

-- ---------------------------------------------------------------------------
-- T3 — convert_baker_recipe_to_absolute_v1 returns expected absolute qtys.
-- Pivot 100% flour + 70% water + 2% salt + 5% yeast, target 1000g.
-- ---------------------------------------------------------------------------
DO $t3_seed$
BEGIN
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active, is_baker_percentage, baker_percentage)
  VALUES
    ((SELECT v FROM bp_ids WHERE k='prod'), (SELECT v FROM bp_ids WHERE k='flour'), 1000, 'g', TRUE, TRUE, 100.00),
    ((SELECT v FROM bp_ids WHERE k='prod'), (SELECT v FROM bp_ids WHERE k='water'),  700, 'g', TRUE, TRUE,  70.00),
    ((SELECT v FROM bp_ids WHERE k='prod'), (SELECT v FROM bp_ids WHERE k='salt'),    20, 'g', TRUE, TRUE,   2.00),
    ((SELECT v FROM bp_ids WHERE k='prod'), (SELECT v FROM bp_ids WHERE k='yeast'),   50, 'g', TRUE, TRUE,   5.00);
END $t3_seed$;

SELECT is(
  (
    SELECT jsonb_object_agg(elem->>'material_name', (elem->>'absolute_qty')::numeric)
    FROM jsonb_array_elements(
      (
        convert_baker_recipe_to_absolute_v1(
          (SELECT v FROM bp_ids WHERE k='prod'),
          1000
        )->'rows'
      )
    ) AS elem
  ),
  jsonb_build_object(
    'BP Flour', 1000::numeric,
    'BP Water',  700::numeric,
    'BP Salt',    20::numeric,
    'BP Yeast',   50::numeric
  ),
  'T3 — convert_baker_recipe_to_absolute_v1 yields {flour:1000, water:700, salt:20, yeast:50} for target=1000'
);

-- ---------------------------------------------------------------------------
-- T4 — Product with baker rows but no pivot raises pivot_not_found.
-- We move the pivot off 100 (down to 99) so the pivot detection fails.
-- ---------------------------------------------------------------------------
DO $t4_break$
BEGIN
  UPDATE recipes
    SET baker_percentage = 99.00
    WHERE product_id = (SELECT v FROM bp_ids WHERE k='prod')
      AND material_id = (SELECT v FROM bp_ids WHERE k='flour');
END $t4_break$;

SELECT throws_ok(
  $sql$
    SELECT convert_baker_recipe_to_absolute_v1(
      (SELECT v FROM bp_ids WHERE k='prod'),
      1000
    )
  $sql$,
  'P0002',
  NULL,
  'T4 — convert_baker_recipe_to_absolute_v1 raises pivot_not_found when no row has baker_percentage=100'
);

SELECT * FROM finish();

ROLLBACK;
