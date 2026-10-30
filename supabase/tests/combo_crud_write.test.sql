-- Transaction indépendante extraite de combo_crud.test.sql.
BEGIN;
\ir helpers/combo_catalog.sql
\ir helpers/legacy_users.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
DO $$
DECLARE r jsonb;
BEGIN
  r := upsert_combo_v3($json$
    {"name":"Test Platter","category_id":"c6170000-0000-4000-8000-000000000001","base_price":100000,
     "groups":[{"name":"Drinks","group_type":"single","is_required":true,"min_select":1,"max_select":1,"sort_order":0,
       "options":[{"component_product_id":"c6170000-0000-4000-8000-000000000002","surcharge":0,"is_default":true,"sort_order":0},
                  {"component_product_id":"c6170000-0000-4000-8000-000000000003","surcharge":10000,"is_default":false,"sort_order":1}]}]}
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
SELECT throws_ok($q$ SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true); SELECT upsert_combo_v3('{"name":"X","category_id":"c6170000-0000-4000-8000-000000000001","base_price":1,"groups":[]}'::jsonb, NULL) $q$, 'P0003', NULL, 'T8 CASHIER create denied P0003');
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT throws_ok($q$ SELECT upsert_combo_v3('{"name":"Y","category_id":"c6170000-0000-4000-8000-000000000001","base_price":1,"groups":[{"name":"G","group_type":"single","is_required":true,"options":[{"component_product_id":"c6170000-0000-4000-8000-000000000002","is_default":false}]}]}'::jsonb, NULL) $q$, 'P0001', NULL, 'T9 single-required 0 defaults rejected');
DO $$
DECLARE r jsonb;
BEGIN
  r := upsert_combo_v3(('{"combo_product_id":"'||current_setting('combo.t7_id')||'","name":"Test Platter v2","category_id":"c6170000-0000-4000-8000-000000000001","base_price":120000,"groups":[]}')::jsonb, NULL);
END $$;
SELECT is((SELECT count(*)::int FROM combo_groups WHERE combo_product_id = current_setting('combo.t7_id')::uuid), 0, 'T10 REPLACE removed groups');
DO $$
DECLARE r1 jsonb; r2 jsonb; k uuid := '11111111-2222-3333-4444-555555555555';
BEGIN
  r1 := upsert_combo_v3('{"name":"Idem","category_id":"c6170000-0000-4000-8000-000000000001","base_price":5000,"groups":[]}'::jsonb, k);
  r2 := upsert_combo_v3('{"name":"Idem AGAIN","category_id":"c6170000-0000-4000-8000-000000000001","base_price":9999,"groups":[]}'::jsonb, k);
  PERFORM set_config('combo.t11', (r1->>'combo_product_id' = r2->>'combo_product_id' AND r2->>'idempotent_replay'='true')::text, false);
END $$;
SELECT ok(current_setting('combo.t11')='true', 'T11 idempotency replay returns same id');
SELECT ok(NOT has_function_privilege('anon','upsert_combo_v3(jsonb,uuid)','EXECUTE'), 'T12 anon EXECUTE revoked');
SELECT * FROM finish();
ROLLBACK;
