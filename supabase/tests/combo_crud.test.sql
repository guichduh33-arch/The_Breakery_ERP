-- supabase/tests/combo_crud.test.sql  (guard section)
-- Session 47 / Wave A — combo choice-group schema guards.
-- UUIDs: combo product  = 00000000-0000-0000-0000-0000000c0001
--         finished prod  = 00000000-0000-0000-0000-0000000f0001
--         group          = 00000000-0000-0000-0000-0000000a0001
BEGIN;
SELECT plan(6);
-- seed a combo product + a finished product in this tx
INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  SELECT '00000000-0000-0000-0000-0000000c0001','T-COMBO','T Combo', c.id, 0, 'combo'
  FROM categories c LIMIT 1;
INSERT INTO products (id, sku, name, category_id, retail_price, product_type)
  SELECT '00000000-0000-0000-0000-0000000f0001','T-FIN','T Fin', c.id, 1000, 'finished'
  FROM categories c LIMIT 1;

-- T1 single => max_select must be 1
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type, max_select)
  VALUES ('00000000-0000-0000-0000-0000000c0001','G','single',2) $$,
  '23514', NULL, 'single group rejects max_select<>1');
-- T2 required => min_select>=1
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type, is_required, min_select)
  VALUES ('00000000-0000-0000-0000-0000000c0001','G','single',true,0) $$,
  '23514', NULL, 'required group rejects min_select 0');
-- T3 parent must be combo
SELECT throws_ok($$
  INSERT INTO combo_groups (combo_product_id, name, group_type)
  VALUES ('00000000-0000-0000-0000-0000000f0001','G','single') $$,
  '23514', NULL, 'parent must be combo');
-- T4 valid group inserts
PREPARE g AS INSERT INTO combo_groups (id, combo_product_id, name, group_type, is_required, min_select, max_select)
  VALUES ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000c0001','Drinks','single',true,1,1);
SELECT lives_ok('EXECUTE g', 'valid single group inserts');
-- T5 option cannot be a combo
SELECT throws_ok($$
  INSERT INTO combo_group_options (group_id, component_product_id)
  VALUES ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000c0001') $$,
  '23514', NULL, 'option cannot be a combo');
-- T6 valid option inserts
SELECT lives_ok($$
  INSERT INTO combo_group_options (group_id, component_product_id, surcharge, is_default)
  VALUES ('00000000-0000-0000-0000-0000000a0001','00000000-0000-0000-0000-0000000f0001',0,true) $$,
  'valid option inserts');
SELECT * FROM finish();
ROLLBACK;

-- ============================================================================
-- RPC section — upsert_combo_v1 (Task A2). Run as a second transaction.
-- Auth simulated via set_config('request.jwt.claim.sub', <auth_user_id>).
-- UUIDs reference V3-dev seed: MANAGER ...0004, CASHIER ...0002,
-- category 9c751b3c…, finished products c47193c9… / 551c75ec….
-- ============================================================================
BEGIN;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$
DECLARE r jsonb;
BEGIN
  r := upsert_combo_v1($json$
    {"name":"Test Platter","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":100000,
     "groups":[{"name":"Drinks","group_type":"single","is_required":true,"min_select":1,"max_select":1,"sort_order":0,
       "options":[{"component_product_id":"c47193c9-0742-457c-b2bd-a6fdf65a1ad0","surcharge":0,"is_default":true,"sort_order":0},
                  {"component_product_id":"551c75ec-5ea0-468e-ac29-945eaa94e523","surcharge":10000,"is_default":false,"sort_order":1}]}]}
  $json$::jsonb, NULL);
  PERFORM set_config('combo.t7_id', r->>'combo_product_id', false);
  PERFORM set_config('combo.t7_replay', r->>'idempotent_replay', false);
  PERFORM set_config('combo.t7_sku', r->>'sku', false);
END $$;
SELECT plan(9);
SELECT ok(current_setting('combo.t7_id') IS NOT NULL AND current_setting('combo.t7_replay')='false', 'T7 MANAGER create returns id, not replay');
SELECT ok(current_setting('combo.t7_sku') LIKE 'COMBO-%', 'T7 auto SKU COMBO-prefixed');
SELECT is((SELECT count(*)::int FROM combo_groups WHERE combo_product_id = current_setting('combo.t7_id')::uuid), 1, 'T7 one group persisted');
SELECT is((SELECT count(*)::int FROM combo_group_options o JOIN combo_groups g ON g.id=o.group_id WHERE g.combo_product_id = current_setting('combo.t7_id')::uuid), 2, 'T7 two options persisted');
SELECT throws_ok($q$ SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true); SELECT upsert_combo_v1('{"name":"X","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":1,"groups":[]}'::jsonb, NULL) $q$, 'P0003', NULL, 'T8 CASHIER create denied P0003');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT throws_ok($q$ SELECT upsert_combo_v1('{"name":"Y","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":1,"groups":[{"name":"G","group_type":"single","is_required":true,"options":[{"component_product_id":"c47193c9-0742-457c-b2bd-a6fdf65a1ad0","is_default":false}]}]}'::jsonb, NULL) $q$, 'P0001', NULL, 'T9 single-required 0 defaults rejected');
DO $$
DECLARE r jsonb;
BEGIN
  r := upsert_combo_v1(('{"combo_product_id":"'||current_setting('combo.t7_id')||'","name":"Test Platter v2","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":120000,"groups":[]}')::jsonb, NULL);
END $$;
SELECT is((SELECT count(*)::int FROM combo_groups WHERE combo_product_id = current_setting('combo.t7_id')::uuid), 0, 'T10 REPLACE removed groups');
DO $$
DECLARE r1 jsonb; r2 jsonb; k uuid := '11111111-2222-3333-4444-555555555555';
BEGIN
  r1 := upsert_combo_v1('{"name":"Idem","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":5000,"groups":[]}'::jsonb, k);
  r2 := upsert_combo_v1('{"name":"Idem AGAIN","category_id":"9c751b3c-2cbf-49a9-a442-cc6a4b5ffc4a","base_price":9999,"groups":[]}'::jsonb, k);
  PERFORM set_config('combo.t11', (r1->>'combo_product_id' = r2->>'combo_product_id' AND r2->>'idempotent_replay'='true')::text, false);
END $$;
SELECT ok(current_setting('combo.t11')='true', 'T11 idempotency replay returns same id');
SELECT ok(NOT has_function_privilege('anon','upsert_combo_v1(jsonb,uuid)','EXECUTE'), 'T12 anon EXECUTE revoked');
SELECT * FROM finish();
ROLLBACK;
