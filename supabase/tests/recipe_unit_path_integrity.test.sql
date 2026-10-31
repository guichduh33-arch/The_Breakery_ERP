-- Conversions par chemin et par niveau ; fixtures autonomes, aucune donnée conservée.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions,pg_catalog;
\ir helpers/pin_session.sql
SELECT plan(37);
CREATE TEMP TABLE unit_fixture(root uuid,nested uuid,material uuid,intermediate uuid,station uuid,production_key uuid,batch_key uuid,production jsonb,replay jsonb,batch jsonb,batch_replay jsonb);
DO $$
DECLARE a uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid(); station uuid:=gen_random_uuid();
 m uuid:=gen_random_uuid(); ra uuid:=gen_random_uuid(); rb uuid:=gen_random_uuid(); rc uuid:=gen_random_uuid(); root uuid:=gen_random_uuid(); nested uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(profile,a,'UNIT-'||left(profile::text,8),'Unit fixture','SUPER_ADMIN',hash_pin('438271'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO categories(id,name,slug,category_type) VALUES(cat,'Unit fixture','unit-'||cat,'raw_material');
 INSERT INTO sections(id,code,name,kind) VALUES(station,'UNIT-'||left(station::text,8),'Unit station','production');
 INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock) VALUES
 (m,'UNIT-'||left(m::text,8),'Unit material',cat,0,100,100,'kg','finished',true,true,true),
 (ra,'UNIT-'||left(ra::text,8),'Unit stage A',cat,0,0,0,'kg','finished',true,false,true),
 (rb,'UNIT-'||left(rb::text,8),'Unit stage B',cat,0,0,0,'kg','finished',true,false,true),
 (rc,'UNIT-'||left(rc::text,8),'Unit stage C',cat,0,0,0,'kg','finished',true,false,true),
 (root,'UNIT-'||left(root::text,8),'Unit root',cat,200,0,0,'pcs','finished',true,true,true),
 (nested,'UNIT-'||left(nested::text,8),'Unit nested',cat,200,0,0,'pcs','finished',true,true,true);
 INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES
 (ra,m,500,'g',true),(rb,m,0.5,'kg',true),(rc,m,200,'g',true),
 (root,ra,1,'kg',true),(root,rb,1,'kg',true),(nested,rc,500,'g',true);
 INSERT INTO unit_fixture VALUES(root,nested,m,rc,station,gen_random_uuid(),gen_random_uuid(),NULL,NULL,NULL,NULL);
END $$;
SELECT is((SELECT count(*)::int FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.root,1) r),1,'convergent leaf is returned once');
SELECT is((SELECT r.qty_base FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.root,1) r),1::numeric,'500 g plus 0.5 kg consumes one base kg');
SELECT is((SELECT r.unit FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.root,1) r),'kg','resolver reports the base unit');
SELECT is((SELECT r.qty_base FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.nested,1) r),0.1::numeric,'500 g of non-stocked intermediate scales its kg recipe by 0.5');
SELECT is((SELECT count(*)::int FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b),1,'BOM aggregates convergent paths once');
SELECT is((SELECT b.recipe_unit FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b),'g','BOM preserves its recipe display unit');
SELECT is((SELECT b.qty_per_unit FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b),1000::numeric,'BOM sums converted quantities in its displayed unit');
SELECT is((SELECT b.qty_in_base FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b),1::numeric,'BOM base quantity equals resolver quantity');
SELECT is((SELECT b.line_cost FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b),100::numeric,'BOM line cost uses the full base quantity');
SELECT is((SELECT b.qty_per_unit FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.nested) b),100::numeric,'nested BOM returns one hundred recipe grams');
SELECT is((SELECT b.qty_in_base FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.nested) b),0.1::numeric,'nested BOM converts each recursive level');
SELECT is((SELECT b.line_cost FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.nested) b),10::numeric,'nested BOM cost is ten');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),100::numeric,'resolver and BOM reads have no stock effect');
UPDATE unit_fixture f SET production=record_production_v8(p_product_id:=f.nested,p_quantity_produced:=10,p_section_id:=f.station,p_idempotency_key:=f.production_key);
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),99::numeric,'unit production deducts one kg for ten nested products');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.nested),10::numeric,'unit production credits ten finished pieces');
SELECT is((SELECT s.quantity FROM stock_movements s,unit_fixture f WHERE s.metadata->>'production_id'=f.production->>'production_id' AND s.movement_type='production_out'),(-1)::numeric,'production movement carries the converted base quantity');
SELECT is((SELECT s.unit FROM stock_movements s,unit_fixture f WHERE s.metadata->>'production_id'=f.production->>'production_id' AND s.movement_type='production_out'),'kg','production movement carries base unit');
SELECT is((SELECT (production->>'materials_cost')::numeric FROM unit_fixture),100::numeric,'production material cost matches the converted consumption');
SELECT ok(NOT EXISTS(SELECT 1 FROM journal_entries j JOIN stock_movements s ON s.id=j.reference_id CROSS JOIN unit_fixture f WHERE s.metadata->>'production_id'=f.production->>'production_id' AND j.total_debit<>j.total_credit),'production journals remain balanced');
UPDATE unit_fixture f SET replay=record_production_v8(p_product_id:=f.nested,p_quantity_produced:=10,p_section_id:=f.station,p_idempotency_key:=f.production_key);
SELECT ok((SELECT replay->>'production_id'=production->>'production_id' AND (replay->>'idempotent_replay')::boolean FROM unit_fixture),'unit production replay returns original production');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),99::numeric,'unit replay has no second stock deduction');
UPDATE unit_fixture f SET batch=record_batch_production_v10(jsonb_build_object('section_id',f.station,'idempotency_key',f.batch_key),jsonb_build_array(jsonb_build_object('product_id',f.nested,'quantity_produced',10)));
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),98::numeric,'batch preflight and production agree on one kg');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.nested),20::numeric,'batch credits only its ten additional pieces');
SELECT is((SELECT jsonb_array_length(batch->'production_records') FROM unit_fixture),1,'batch returns one production record');
UPDATE unit_fixture f SET batch_replay=record_batch_production_v10(jsonb_build_object('section_id',f.station,'idempotency_key',f.batch_key),jsonb_build_array(jsonb_build_object('product_id',f.nested,'quantity_produced',10)));
SELECT ok((SELECT batch_replay->>'batch_id'=batch->>'batch_id' AND (batch_replay->>'idempotent_replay')::boolean FROM unit_fixture),'batch replay returns original batch');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),98::numeric,'batch replay keeps material stock unchanged');
UPDATE products p SET track_inventory=true FROM unit_fixture f WHERE p.id=f.intermediate;
SELECT ok((SELECT count(*)=1 AND bool_and(r.product_id=f.intermediate AND r.qty_base=0.5) FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.nested,1) r),'stocked intermediate is consumed in its own base unit');
SELECT ok(NOT EXISTS(SELECT 1 FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.nested,1) r WHERE r.product_id=f.material),'stocked intermediate prevents descent to raw material');
SELECT ok((SELECT count(*)=1 AND bool_and(b.material_id=f.intermediate AND b.qty_in_base=0.5) FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.nested) b),'BOM stops at the first stocked intermediate');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),98::numeric,'stocked intermediate previews remain read only');
INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) SELECT root,material,1,'pcs',true FROM unit_fixture;
SELECT throws_ok($q$SELECT * FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.root,1) r$q$,'P0002','unit_conversion_missing: Unit material (pcs -> kg)','incompatible convergent path fails the strict consumption resolver');
SELECT throws_like($q$SELECT * FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.root) b$q$,'unit_conversion_missing:%','BOM rejects an incompatible conversion explicitly');
SELECT is((SELECT p.current_stock FROM products p,unit_fixture f WHERE p.id=f.material),98::numeric,'failed conversion preview has no stock effect');
UPDATE products p SET track_inventory=false FROM unit_fixture f WHERE p.id=f.intermediate;
UPDATE recipes r SET unit='pcs' FROM unit_fixture f WHERE r.product_id=f.nested AND r.material_id=f.intermediate;
SELECT throws_ok($q$SELECT * FROM unit_fixture f CROSS JOIN LATERAL recipe_bom_full_v4(f.nested) b$q$,'P0002','unit_conversion_missing: pcs -> kg','BOM rejects incompatible conversion between recipe levels');
SELECT throws_ok($q$SELECT * FROM unit_fixture f CROSS JOIN LATERAL _resolve_recipe_consumption_v2(f.nested,1) r$q$,'P0002','unit_conversion_missing: pcs -> kg','consumption rejects incompatible conversion between recipe levels');
SELECT ok(NOT has_function_privilege('authenticated','public._resolve_recipe_consumption_v2(uuid,numeric,integer)','EXECUTE') AND has_function_privilege('service_role','public._resolve_recipe_consumption_v2(uuid,numeric,integer)','EXECUTE'),'internal resolver keeps service-only execution');
SELECT ok(to_regprocedure('public._resolve_recipe_consumption_v1(uuid,numeric,integer)') IS NULL AND to_regprocedure('public.recipe_bom_full_v2(uuid,integer)') IS NULL,'old resolver and BOM signatures removed');
SELECT * FROM finish();
ROLLBACK;
