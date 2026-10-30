-- Transaction indépendante extraite de combo_crud.test.sql.
BEGIN;
\ir helpers/combo_catalog.sql
\ir helpers/legacy_users.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE r jsonb; d jsonb;
BEGIN
  r := upsert_combo_v3('{"name":"DelMe","category_id":"c6170000-0000-4000-8000-000000000001","base_price":1000,"groups":[]}'::jsonb, NULL);
  PERFORM set_config('combo.del_id', r->>'combo_product_id', false);
  d := delete_combo_v2((r->>'combo_product_id')::uuid);
  PERFORM set_config('combo.del_res', d->>'deleted', false);
  d := delete_combo_v2((r->>'combo_product_id')::uuid);
  PERFORM set_config('combo.del_replay', d->>'deleted', false);
END $$;
SELECT plan(5);
SELECT is(current_setting('combo.del_res'), 'true', 'T13 SUPER_ADMIN delete returns deleted=true');
SELECT ok((SELECT deleted_at IS NOT NULL AND is_active=false FROM products WHERE id=current_setting('combo.del_id')::uuid), 'T13 row soft-deleted + inactive');
SELECT is(current_setting('combo.del_replay'), 'false', 'T15 replay on deleted returns deleted=false');
SELECT throws_ok($q$ SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true); SELECT delete_combo_v2('00000000-0000-0000-0000-0000000c0001'::uuid) $q$, 'P0003', NULL, 'T14 MANAGER delete denied P0003');
SELECT ok(NOT has_function_privilege('anon','delete_combo_v2(uuid)','EXECUTE'), 'T16 anon EXECUTE revoked');
SELECT * FROM finish();
ROLLBACK;
