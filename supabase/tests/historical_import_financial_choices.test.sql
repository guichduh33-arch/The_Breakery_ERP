BEGIN;
\ir helpers/pin_session.sql
SELECT plan(5);
\ir helpers/historical_import.sql
INSERT INTO product_modifiers(product_id,group_name,group_required,group_type,option_label,price_adjustment,ingredients_to_deduct)
 SELECT product,'Current option',true,'single_select','HOT',0,'[]' FROM historical_fixture;
INSERT INTO historical_tap(result) SELECT is(_historical_import_financial_choices_v1(f.product,jsonb_build_array(m.id),jsonb_build_array(m.id))->'errors',
 '[]'::jsonb,'supplied modifier UUID is validated') FROM historical_fixture f JOIN product_modifiers m ON m.product_id=f.product;
INSERT INTO historical_tap(result) SELECT is(jsonb_array_length(_historical_import_financial_choices_v1(f.product,jsonb_build_array(m.id),NULL)->'modifier_snapshot'),
 1,'supplied modifier snapshot is retained') FROM historical_fixture f JOIN product_modifiers m ON m.product_id=f.product;
INSERT INTO products(sku,name,parent_product_id,category_id,variant_axis,variant_label,unit,retail_price,current_stock)
 SELECT 'HIST-CHILD-'||f.product,'Current child variant',f.product,p.category_id,'size','Current size','pcs',100,0
 FROM historical_fixture f JOIN products p ON p.id=f.product;
UPDATE historical_fixture SET payload=jsonb_set(jsonb_set(jsonb_set(payload,'{stock_mode}','"financial_only"'),
 '{documents,0,stock_mode}','"financial_only"'),'{documents,0,lines,0,name_snapshot}','"Historical parent, original option"');
SET LOCAL ROLE authenticated;
UPDATE historical_fixture SET preview=preview_historical_import_v3(payload);
INSERT INTO historical_tap(result) SELECT is(preview->'errors','[]'::jsonb,'confirmed parent SKU needs no invented variant') FROM historical_fixture;
UPDATE historical_fixture SET result=apply_historical_import_v3(payload,preview->>'preview_hash',client_key);
RESET ROLE;
INSERT INTO historical_tap(result) SELECT is((SELECT i.product_id FROM order_items i JOIN historical_import_documents d ON d.entity_id=i.order_id
 WHERE d.run_id=(f.result->>'run_id')::uuid),f.product,'native line keeps confirmed parent product ID') FROM historical_fixture f;
INSERT INTO historical_tap(result) SELECT is((SELECT i.name_snapshot FROM order_items i JOIN historical_import_documents d ON d.entity_id=i.order_id
 WHERE d.run_id=(f.result->>'run_id')::uuid),'Historical parent, original option','native line keeps source option text') FROM historical_fixture f;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_build_object('executed',(SELECT count(*) FROM historical_tap),
 'failures',(SELECT coalesce(jsonb_agg(result),'[]') FROM historical_tap WHERE result LIKE 'not ok%'),
 'tap_finish',(SELECT coalesce(jsonb_agg(result),'[]') FROM finish() result)) AS test_result;
ROLLBACK;
