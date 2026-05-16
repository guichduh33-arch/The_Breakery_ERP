-- supabase/tests/allergens.test.sql
-- Session 15 / Phase 5.C — Allergens pgTAP suite.
--
-- Coverage matrix :
--   T1 — INSERT product with allergens {milk, eggs} -> SELECT returns those.
--   T2 — INSERT enum value not in the list -> fails (invalid_text_representation).
--   T3 — Recursive cascade : product B uses A (with milk) -> resolved={milk}.
--   T4 — Multi-level : C uses B uses A (with milk) -> C resolved={milk}.
--   T5 — Multi-allergen : D own={gluten} + uses E (with milk) -> {gluten,milk}.
--
-- Runner : execute via MCP execute_sql under BEGIN..ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

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

  PERFORM set_config('al.admin_uid',   v_admin_uid::text,   false);
  PERFORM set_config('al.category_id', v_category_id::text, false);
  PERFORM set_config('request.jwt.claim.sub', v_admin_uid::text, false);
END $boot$;

CREATE TEMP TABLE al_ids (
  k TEXT PRIMARY KEY,
  v UUID NOT NULL
);

-- Seed : 5 products + 3 recipe edges.
--   A  -> own={milk, eggs}                  (T1 anchor + T3 leaf)
--   B  -> uses A                            (T3 expects {milk, eggs})
--   C  -> uses B                            (T4 multi-level expects {milk, eggs})
--   D  -> own={gluten}, uses E              (T5 multi-allergen)
--   E  -> own={milk}                        (T5 leaf)
DO $seed$
DECLARE
  v_a UUID; v_b UUID; v_c UUID; v_d UUID; v_e UUID;
BEGIN
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES ('ALG-A', 'Allergen A milk+eggs', current_setting('al.category_id')::uuid, 0, 100, 'g', 1, 'finished', TRUE, ARRAY['milk','eggs']::allergen_type[])
    RETURNING id INTO v_a;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES ('ALG-B', 'Allergen B uses A', current_setting('al.category_id')::uuid, 0, 100, 'g', 1, 'finished', TRUE, ARRAY[]::allergen_type[])
    RETURNING id INTO v_b;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES ('ALG-C', 'Allergen C uses B', current_setting('al.category_id')::uuid, 0, 100, 'g', 1, 'finished', TRUE, ARRAY[]::allergen_type[])
    RETURNING id INTO v_c;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES ('ALG-D', 'Allergen D own gluten + uses E', current_setting('al.category_id')::uuid, 0, 100, 'g', 1, 'finished', TRUE, ARRAY['gluten']::allergen_type[])
    RETURNING id INTO v_d;
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES ('ALG-E', 'Allergen E milk', current_setting('al.category_id')::uuid, 0, 100, 'g', 1, 'finished', TRUE, ARRAY['milk']::allergen_type[])
    RETURNING id INTO v_e;

  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_b, v_a, 100, 'g', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_c, v_b, 100, 'g', TRUE);
  INSERT INTO recipes (product_id, material_id, quantity, unit, is_active)
    VALUES (v_d, v_e, 100, 'g', TRUE);

  INSERT INTO al_ids(k, v) VALUES
    ('a', v_a), ('b', v_b), ('c', v_c), ('d', v_d), ('e', v_e);
END $seed$;

-- ---------------------------------------------------------------------------
-- T1 — Self-declared allergens stored on products round-trip cleanly.
-- ---------------------------------------------------------------------------
SELECT set_eq(
  $sql$ SELECT unnest(allergens)::text FROM products WHERE sku='ALG-A' $sql$,
  $sql$ VALUES ('milk'), ('eggs') $sql$,
  'T1 — products.allergens stores {milk, eggs} on direct insert'
);

-- ---------------------------------------------------------------------------
-- T2 — Invalid enum value rejected.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $sql$
    INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price, product_type, is_active, allergens)
    VALUES (
      'ALG-BAD', 'Bad enum', (SELECT current_setting('al.category_id'))::uuid,
      0, 0, 'pcs', 0, 'finished', TRUE,
      ARRAY['cocoa']::allergen_type[]
    )
  $sql$,
  '22P02',
  NULL,
  'T2 — invalid allergen_type value (e.g. "cocoa") is rejected'
);

-- ---------------------------------------------------------------------------
-- T3 — Recursive cascade : B uses A (milk+eggs) -> resolved={eggs, milk}.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT allergens FROM view_product_allergens_resolved
   WHERE product_id = (SELECT v FROM al_ids WHERE k='b')),
  ARRAY['eggs','milk']::allergen_type[],
  'T3 — view propagates A''s allergens to B via the recipe edge'
);

-- ---------------------------------------------------------------------------
-- T4 — Multi-level : C uses B uses A (milk+eggs) -> resolved={eggs, milk}.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT allergens FROM view_product_allergens_resolved
   WHERE product_id = (SELECT v FROM al_ids WHERE k='c')),
  ARRAY['eggs','milk']::allergen_type[],
  'T4 — view propagates allergens through 2 recipe hops (C -> B -> A)'
);

-- ---------------------------------------------------------------------------
-- T5 — Multi-allergen : D own={gluten} + uses E (milk) -> {gluten, milk}.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT allergens FROM view_product_allergens_resolved
   WHERE product_id = (SELECT v FROM al_ids WHERE k='d')),
  ARRAY['gluten','milk']::allergen_type[],
  'T5 — view unions own allergens with cascade allergens, sorted'
);

SELECT * FROM finish();

ROLLBACK;
