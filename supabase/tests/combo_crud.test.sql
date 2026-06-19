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
