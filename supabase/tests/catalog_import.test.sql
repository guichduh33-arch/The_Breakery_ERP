-- supabase/tests/catalog_import.test.sql
-- S41 -- pgTAP suite for import_catalog_v1 / export_catalog_v1 (T1-T24).
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK -- self-cleaning.
--
-- Covers:
--   T1  : CASHIER import -> 42501
--   T2  : MANAGER dry-run -> valid=true
--   T3  : dry-run writes nothing (product count unchanged)
--   T4  : commit -> ingredient hidden from POS
--   T5  : commit -> variant linked to parent
--   T6  : commit -> unit alternative created
--   T7  : commit -> BOM created (2 lines for S41-DOUGH)
--   T8  : replay same key -> idempotent_replay=true
--   T9  : upsert -> price updated
--   T10 : upsert -> BOM fully replaced (1 line)
--   T11 : unknown material -> valid=false + error code
--   T12 : cycle -> recipe_cycle detected
--   T13 : commit without key -> P0001
--   T14 : export CASHIER -> 42501
--   T15 : export MANAGER -> shape + S41 SKUs presents
--   T16 : BOM re-import -> recipe_versions +1 (trigger tr_recipes_snapshot_version)
--   T17 : sku_is_variant_in_db (S41-CROIS-ALM en feuille products -> erreur)
--   T18 : sku_is_standalone_in_db (S41-CROIS en feuille variants -> erreur)
--   T19 : REPLACE units -- g soft-deleted apres remplacement par sachet
--   T20 : REPLACE units -- sachet actif (deleted_at IS NULL)
--   T21 : invalid_context_unit -- recipe_unit='ghost' invalide
--   T22 : audit_logs row catalog.imported apres commit
--   T23 : T15 renforce -- dry-run S41-only valid=true
--   T24 : T15 renforce -- dry-run S41-only products.create=0
--
-- Seeded users:
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(31);

-- T1 : CASHIER -> 42501 on import
DO $t1$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM import_catalog_v1('{}'::jsonb, true);
    PERFORM set_config('breakery.t1', 'no_error', true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('breakery.t1', '42501', true);
  END;
END $t1$;
SELECT is(current_setting('breakery.t1'), '42501', 'T1 import CASHIER rejected 42501');

-- Fixtures payload (happy path) stored in a GUC for reuse
DO $fix$ BEGIN
  PERFORM set_config('breakery.payload', '{
    "categories": [{"name": "S41 Test Cat", "dispatch_station": "kitchen"}],
    "ingredients": [
      {"sku": "S41-FLOUR", "name": "S41 Flour", "unit": "kg", "cost_price": 12000},
      {"sku": "S41-BUTTER", "name": "S41 Butter", "unit": "kg", "cost_price": 95000}
    ],
    "products": [
      {"sku": "S41-CROIS", "name": "S41 Croissant", "category": "S41 Test Cat", "unit": "pcs", "retail_price": 25000},
      {"sku": "S41-DOUGH", "name": "S41 Dough", "category": "S41 Test Cat", "unit": "kg", "retail_price": 0, "visible_on_pos": false}
    ],
    "units": [
      {"product_sku": "S41-FLOUR", "code": "g", "factor_to_base": 0.001, "tags": ["recipe"]}
    ],
    "variants": [
      {"parent_sku": "S41-CROIS", "variant_axis": "flavor", "variant_label": "Almond", "sku": "S41-CROIS-ALM", "retail_price": 28000}
    ],
    "recipes": [
      {"product_sku": "S41-DOUGH", "material_sku": "S41-FLOUR", "quantity": 500, "unit": "g"},
      {"product_sku": "S41-DOUGH", "material_sku": "S41-BUTTER", "quantity": 0.25, "unit": "kg"},
      {"product_sku": "S41-CROIS", "material_sku": "S41-DOUGH", "quantity": 0.08, "unit": "kg"}
    ]
  }', true);
END $fix$;

-- T2/T3 : MANAGER dry-run -> valid=true + zero write
DO $t23$
DECLARE v_before INT; v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT COUNT(*) INTO v_before FROM products;
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, true);
  PERFORM set_config('breakery.t2_valid', (v_rep->>'valid'), true);
  PERFORM set_config('breakery.t2_delta',
    ((SELECT COUNT(*) FROM products) - v_before)::text, true);
END $t23$;
SELECT is(current_setting('breakery.t2_valid'), 'true', 'T2 dry-run valid');
SELECT is(current_setting('breakery.t2_delta'), '0', 'T3 dry-run writes nothing');

-- T4/T5/T6/T7 : commit -> produits crees avec bons flags
DO $t47$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, false,
                             'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  PERFORM set_config('breakery.t3_valid', (v_rep->>'valid'), true);
END $t47$;
SELECT is(current_setting('breakery.t3_valid'), 'true', 'T4 commit valid');
SELECT is(
  (SELECT visible_on_pos FROM products WHERE sku = 'S41-FLOUR'), FALSE,
  'T4 ingredient hidden from POS');
SELECT is(
  (SELECT pp.sku FROM products v JOIN products pp ON pp.id = v.parent_product_id
    WHERE v.sku = 'S41-CROIS-ALM'), 'S41-CROIS',
  'T5 variant linked to parent');
SELECT is(
  (SELECT COUNT(*)::INT FROM product_unit_alternatives a
     JOIN products p ON p.id = a.product_id
    WHERE p.sku = 'S41-FLOUR' AND a.deleted_at IS NULL), 1,
  'T6 unit alternative created');
SELECT is(
  (SELECT COUNT(*)::INT FROM recipes r JOIN products p ON p.id = r.product_id
    WHERE p.sku = 'S41-DOUGH' AND r.is_active AND r.deleted_at IS NULL), 2,
  'T7 BOM created (2 lines)');

-- T8 : replay meme cle -> idempotent_replay
DO $t8$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(current_setting('breakery.payload')::jsonb, false,
                             'aaaaaaaa-0000-0000-0000-000000000001'::uuid);
  PERFORM set_config('breakery.t8', (v_rep->>'idempotent_replay'), true);
END $t8$;
SELECT is(current_setting('breakery.t8'), 'true', 'T8 idempotent replay');

-- T9/T10 : re-import upsert -- prix modifie + BOM remplacee
DO $t910$
DECLARE v_payload JSONB; v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_payload := jsonb_build_object(
    'products', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-CROIS', 'name', 'S41 Croissant', 'category', 'S41 Test Cat',
      'unit', 'pcs', 'retail_price', 27000)),
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-FLOUR', 'quantity', 600, 'unit', 'g'))
  );
  v_rep := import_catalog_v1(v_payload, false, 'aaaaaaaa-0000-0000-0000-000000000002'::uuid);
  PERFORM set_config('breakery.t9', (v_rep->>'valid'), true);
END $t910$;
SELECT is((SELECT retail_price FROM products WHERE sku = 'S41-CROIS'), 27000::NUMERIC,
  'T9 upsert price updated');
SELECT is(
  (SELECT COUNT(*)::INT FROM recipes r JOIN products p ON p.id = r.product_id
    WHERE p.sku = 'S41-DOUGH' AND r.is_active AND r.deleted_at IS NULL), 1,
  'T10 BOM fully replaced (1 line)');

-- T11 : materiau inconnu -> valid=false + code, zero ecriture
DO $t11$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-CROIS', 'material_sku', 'S41-GHOST', 'quantity', 1))),
    false, 'aaaaaaaa-0000-0000-0000-000000000003'::uuid);
  PERFORM set_config('breakery.t11_valid', (v_rep->>'valid'), true);
  PERFORM set_config('breakery.t11_code', (v_rep->'errors'->0->>'code'), true);
END $t11$;
SELECT is(current_setting('breakery.t11_valid'), 'false', 'T11 unknown material invalid');
SELECT is(current_setting('breakery.t11_code'), 'unknown_material', 'T11 error code');

-- T12 : cycle -> recipe_cycle (S41-DOUGH consomme S41-CROIS qui consomme S41-DOUGH)
DO $t12$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-CROIS', 'quantity', 1))),
    true);
  PERFORM set_config('breakery.t12',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'recipe_cycle'), true);
END $t12$;
SELECT is(current_setting('breakery.t12'), '1', 'T12 cycle detected');

-- T13 : commit sans cle -> P0001
DO $t13$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM import_catalog_v1('{}'::jsonb, false, NULL);
    PERFORM set_config('breakery.t13', 'no_error', true);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    PERFORM set_config('breakery.t13', 'P0001', true);
  END;
END $t13$;
SELECT is(current_setting('breakery.t13'), 'P0001', 'T13 missing idempotency key');

-- T14 : export CASHIER -> 42501
DO $t14$ BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM export_catalog_v1();
    PERFORM set_config('breakery.t14', 'no_error', true);
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM set_config('breakery.t14', '42501', true);
  END;
END $t14$;
SELECT is(current_setting('breakery.t14'), '42501', 'T14 export CASHIER rejected');

-- T15 : export MANAGER shape + keys presentes + S41 SKUs dans l'export
-- Note : le round-trip complet echoue si la DB de dev contient des recettes avec des
-- unites incompatibles (donnees pre-existantes, ex. ING-ALMOND en g vers BEV-008 base cup).
-- On valide donc la structure de l'export et la presence des SKUs S41 importes uniquement.
DO $t15$
DECLARE v_exp JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_exp := export_catalog_v1();
  PERFORM set_config('breakery.t15',
    CASE WHEN v_exp ? 'categories'
              AND v_exp ? 'ingredients'
              AND v_exp ? 'products'
              AND v_exp ? 'units'
              AND v_exp ? 'variants'
              AND v_exp ? 'recipes'
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_exp->'products') p WHERE p->>'sku' = 'S41-CROIS')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_exp->'ingredients') p WHERE p->>'sku' = 'S41-FLOUR')
         THEN 'ok' ELSE 'ko: shape invalid or S41 SKUs missing' END, true);
END $t15$;
SELECT is(current_setting('breakery.t15'), 'ok', 'T15 export shape + S41 SKUs presents');

-- =================== SPEC REVIEW -- T16-T24 ===================

-- T16 : BOM re-import -> recipe_versions +1 via trigger tr_recipes_snapshot_version
-- W7 soft-deletes old lines + inserts new ones -> trigger fires -> version_number increments.
DO $t16$
DECLARE v_ver_before INT; v_ver_after INT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SELECT COALESCE(MAX(rv.version_number), 0) INTO v_ver_before
    FROM recipe_versions rv
    JOIN products p ON p.id = rv.product_id
   WHERE p.sku = 'S41-DOUGH';

  PERFORM import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-FLOUR', 'quantity', 700, 'unit', 'g'))
  ), false, 'aaaaaaaa-0000-0000-0000-000000000010'::uuid);

  SELECT COALESCE(MAX(rv.version_number), 0) INTO v_ver_after
    FROM recipe_versions rv
    JOIN products p ON p.id = rv.product_id
   WHERE p.sku = 'S41-DOUGH';

  PERFORM set_config('breakery.t16',
    CASE WHEN v_ver_after > v_ver_before THEN 'ok' ELSE 'ko: version did not increment' END, true);
END $t16$;
SELECT is(current_setting('breakery.t16'), 'ok', 'T16 BOM re-import increments recipe_versions');

-- T17 : sku_is_variant_in_db -- S41-CROIS-ALM declare en feuille products -> erreur V4
-- S41-CROIS-ALM existe en DB avec parent_product_id IS NOT NULL (variant).
-- Le declarer dans la feuille "products" doit lever sku_is_variant_in_db.
DO $t17$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'products', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-CROIS-ALM', 'name', 'S41 Croissant Almond',
      'category', 'S41 Test Cat', 'unit', 'pcs', 'retail_price', 28000))
  ), true);
  PERFORM set_config('breakery.t17',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'sku_is_variant_in_db'), true);
END $t17$;
SELECT is(current_setting('breakery.t17'), '1', 'T17 sku_is_variant_in_db detected');

-- T18 : sku_is_standalone_in_db -- S41-CROIS declare en feuille variants -> erreur V10
-- S41-CROIS existe en DB avec parent_product_id IS NULL (standalone).
-- Le declarer dans "variants" doit lever sku_is_standalone_in_db.
DO $t18$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'variants', jsonb_build_array(jsonb_build_object(
      'parent_sku', 'S41-DOUGH', 'variant_axis', 'flavor',
      'variant_label', 'Classic', 'sku', 'S41-CROIS', 'retail_price', 25000))
  ), true);
  PERFORM set_config('breakery.t18',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'sku_is_standalone_in_db'), true);
END $t18$;
SELECT is(current_setting('breakery.t18'), '1', 'T18 sku_is_standalone_in_db detected');

-- T19/T20 : REPLACE semantics units -- sachet remplace g pour S41-FLOUR
-- payload contient uniquement "sachet" (factor 0.5) -> W5 soft-delete g, insert sachet.
-- Les contextes de S41-FLOUR sont tous kg (base unit) -> V14 non declenchee.
DO $t1920$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'units', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-FLOUR', 'code', 'sachet',
      'factor_to_base', 0.5, 'tags', jsonb_build_array('purchase', 'sales')))
  ), false, 'aaaaaaaa-0000-0000-0000-000000000011'::uuid);
  PERFORM set_config('breakery.t19_valid', (v_rep->>'valid'), true);
END $t1920$;
SELECT is(
  (SELECT COUNT(*)::INT FROM product_unit_alternatives a
     JOIN products p ON p.id = a.product_id
    WHERE p.sku = 'S41-FLOUR' AND a.code = 'g' AND a.deleted_at IS NOT NULL), 1,
  'T19 g unit soft-deleted after REPLACE');
SELECT is(
  (SELECT COUNT(*)::INT FROM product_unit_alternatives a
     JOIN products p ON p.id = a.product_id
    WHERE p.sku = 'S41-FLOUR' AND a.code = 'sachet' AND a.deleted_at IS NULL), 1,
  'T20 sachet unit active after REPLACE');

-- T21 : invalid_context_unit -- recipe_unit='ghost' invalide (ni base unit ni alternative)
-- Apres T19/T20, S41-FLOUR n'a plus g en alternatives ; kg et sachet sont les seules unites.
-- Declarer recipe_unit='ghost' doit declencher V13 invalid_context_unit.
DO $t21$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'ingredients', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-FLOUR', 'name', 'S41 Flour', 'unit', 'kg', 'cost_price', 12000,
      'recipe_unit', 'ghost'))
  ), true);
  PERFORM set_config('breakery.t21',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'invalid_context_unit'), true);
END $t21$;
SELECT is(current_setting('breakery.t21'), '1', 'T21 invalid_context_unit detected');

-- T22 : audit_logs -- au moins 1 row action='catalog.imported' apres les commits
-- Les commits T4 (_001), T9 (_002), T16 (_010), T19 (_011) ont insere dans audit_logs.
SELECT is(
  (SELECT COUNT(*)::INT FROM audit_logs
    WHERE action = 'catalog.imported'
      AND entity_type = 'catalog'
      AND actor_id = '00000000-0000-0000-0000-000000000004'::uuid) > 0,
  TRUE,
  'T22 audit_logs row catalog.imported exists');

-- T23/T24 : T15 renforce -- dry-run S41-only -> valid=true + creates=0
-- Payload minimal avec uniquement les fixtures S41 (deja en DB) -> products.create=0.
DO $t2324$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'categories', jsonb_build_array(jsonb_build_object(
      'name', 'S41 Test Cat', 'dispatch_station', 'kitchen')),
    'ingredients', jsonb_build_array(
      jsonb_build_object('sku', 'S41-FLOUR', 'name', 'S41 Flour', 'unit', 'kg', 'cost_price', 12000),
      jsonb_build_object('sku', 'S41-BUTTER', 'name', 'S41 Butter', 'unit', 'kg', 'cost_price', 95000)
    ),
    'products', jsonb_build_array(
      jsonb_build_object('sku', 'S41-CROIS', 'name', 'S41 Croissant',
        'category', 'S41 Test Cat', 'unit', 'pcs', 'retail_price', 27000),
      jsonb_build_object('sku', 'S41-DOUGH', 'name', 'S41 Dough',
        'category', 'S41 Test Cat', 'unit', 'kg', 'retail_price', 0)
    ),
    'variants', jsonb_build_array(jsonb_build_object(
      'parent_sku', 'S41-CROIS', 'variant_axis', 'flavor',
      'variant_label', 'Almond', 'sku', 'S41-CROIS-ALM', 'retail_price', 28000))
  ), true);
  PERFORM set_config('breakery.t23_valid', (v_rep->>'valid'), true);
  PERFORM set_config('breakery.t24_creates',
    (((v_rep->'summary'->'products'->>'create')::INT
      + (v_rep->'summary'->'ingredients'->>'create')::INT))::text, true);
END $t2324$;
SELECT is(current_setting('breakery.t23_valid'), 'true', 'T23 S41-only dry-run valid=true');
SELECT is(current_setting('breakery.t24_creates'), '0', 'T24 S41-only dry-run products+ingredients.create=0');

-- =================== DEV-S45-IMP-01 V19 -- T25/T26 ===================
-- V19 numeric magnitude: an over-range value is caught at dry-run as a structured
-- error instead of crashing the commit with a raw 22003 (opaque 400).
-- T25 : retail_price > NUMERIC(12,2) bound -> value_out_of_range, valid=false
DO $t25$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'products', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-OVF', 'name', 'S41 Overflow', 'category', 'S41 Test Cat',
      'unit', 'pcs', 'retail_price', 99999999999999::numeric))
  ), true);
  PERFORM set_config('breakery.t25',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t25$;
SELECT is(current_setting('breakery.t25'), '1', 'T25 over-range retail_price -> value_out_of_range');

-- T26 : exact NUMERIC(12,2) max (9,999,999,999.99) is NOT a false positive
DO $t26$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'products', jsonb_build_array(jsonb_build_object(
      'sku', 'S41-OVF-OK', 'name', 'S41 At Max', 'category', 'S41 Test Cat',
      'unit', 'pcs', 'retail_price', 9999999999.99::numeric))
  ), true);
  PERFORM set_config('breakery.t26',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t26$;
SELECT is(current_setting('breakery.t26'), '0', 'T26 boundary max retail_price -> no false positive');

-- T27 : recipes.quantity > NUMERIC(10,3) bound -> value_out_of_range (DEV-S45-IMP-01 follow-up)
DO $t27$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-DOUGH', 'material_sku', 'S41-FLOUR', 'quantity', 50000000::numeric, 'unit', 'g'))
  ), true);
  PERFORM set_config('breakery.t27',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t27$;
SELECT is(current_setting('breakery.t27'), '1', 'T27 over-range recipe quantity -> value_out_of_range');

-- T28 : product_unit_alternatives.factor_to_base > NUMERIC(20,10) bound -> value_out_of_range
DO $t28$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'units', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-FLOUR', 'code', 'megabag', 'factor_to_base', 99999999999::numeric, 'tags', jsonb_build_array('purchase')))
  ), true);
  PERFORM set_config('breakery.t28',
    (SELECT COUNT(*)::text FROM jsonb_array_elements(v_rep->'errors') e
      WHERE e->>'code' = 'value_out_of_range'), true);
END $t28$;
SELECT is(current_setting('breakery.t28'), '1', 'T28 over-range factor_to_base -> value_out_of_range');

-- T29 : commit a recipe whose COMPUTED cost_per_unit exceeds the old DECIMAL(14,4)
-- ceiling (~10^10). Quantity 1,000,000 is within recipes.quantity bound (V19), so it
-- is NOT rejected; before migration _015 the cost-walk (_calculate_recipe_cost_walk /
-- _snapshot_recipe_version) raised a raw 22003 at commit via tr_recipes_snapshot_version.
-- S41-FLOUR cost_price = 12000 -> 1,000,000 * 12000 = 1.2e10 > 10^10. Must now commit.
DO $t29$
DECLARE v_rep JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_rep := import_catalog_v1(jsonb_build_object(
    'recipes', jsonb_build_array(jsonb_build_object(
      'product_sku', 'S41-CROIS', 'material_sku', 'S41-FLOUR', 'quantity', 1000000::numeric, 'unit', 'kg'))
  ), false, 'aaaaaaaa-0000-0000-0000-000000000029'::uuid);
  PERFORM set_config('breakery.t29', (v_rep->>'valid'), true);
END $t29$;
SELECT is(current_setting('breakery.t29'), 'true', 'T29 large computed recipe cost commits (no 22003 from cost-walk)');

SELECT * FROM finish();
ROLLBACK;
