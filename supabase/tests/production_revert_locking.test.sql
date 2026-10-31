-- Contrepassations et gardes de l'annulation ; fixtures autonomes sous rollback.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions,pg_catalog;
\ir helpers/pin_session.sql
SELECT plan(18);
CREATE TEMP TABLE revert_fixture(product uuid, material uuid, production uuid, consumed uuid, old_production uuid, result jsonb);
DO $$
DECLARE
 a uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); category uuid:=gen_random_uuid();
 station uuid:=gen_random_uuid(); material uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
 consumed_product uuid:=gen_random_uuid(); old_product uuid:=gen_random_uuid();
 production uuid; consumed uuid; old_production uuid; result jsonb;
BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(profile,a,'REVERT-'||left(profile::text,8),'Revert fixture','SUPER_ADMIN',public.hash_pin('358247'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO public.categories(id,name,slug,category_type)
 VALUES(category,'Revert fixture','revert-'||category,'raw_material');
 INSERT INTO public.sections(id,code,name,kind)
 VALUES(station,'REVERT-'||left(station::text,8),'Revert station','production');
 INSERT INTO public.products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock)
 VALUES(material,'REVERT-'||left(material::text,8),'Revert material',category,0,100,100,'kg','finished',true,true,true),
 (product,'REVERT-'||left(product::text,8),'Revert finished',category,200,0,0,'pcs','finished',true,true,true),
 (consumed_product,'REVERT-'||left(consumed_product::text,8),'Revert consumed',category,200,0,0,'pcs','finished',true,true,true),
 (old_product,'REVERT-'||left(old_product::text,8),'Revert old',category,200,0,0,'pcs','finished',true,true,true);
 INSERT INTO public.recipes(product_id,material_id,quantity,unit,is_active)
 VALUES(product,material,0.1,'kg',true),(consumed_product,material,0.1,'kg',true),(old_product,material,0.1,'kg',true);
 production:=(public.record_production_v8(p_product_id:=product,p_quantity_produced:=10,p_section_id:=station)->>'production_id')::uuid;
 consumed:=(public.record_production_v8(p_product_id:=consumed_product,p_quantity_produced:=10,p_section_id:=station)->>'production_id')::uuid;
 old_production:=(public.record_production_v8(p_product_id:=old_product,p_quantity_produced:=10,p_section_id:=station)->>'production_id')::uuid;
 PERFORM public.record_stock_movement_v1(p_product_id:=consumed_product,p_movement_type:='waste',p_quantity:=-1,p_reason:='Revert consumed fixture');
 UPDATE public.production_records SET production_date=now()-interval '25 hours' WHERE id=old_production;
 result:=public.revert_production_v3(production,'Revert nominal fixture');
 INSERT INTO revert_fixture VALUES(product,material,production,consumed,old_production,result);
END $$;
SELECT ok(to_regprocedure('public.revert_production_v2(uuid,text)') IS NULL,'superseded revert is absent');
SELECT ok(NOT has_function_privilege('anon','public.revert_production_v3(uuid,text)','EXECUTE'),'anon cannot inherit revert execution');
SELECT ok(has_function_privilege('authenticated','public.revert_production_v3(uuid,text)','EXECUTE') AND has_function_privilege('service_role','public.revert_production_v3(uuid,text)','EXECUTE'),'existing caller grants retained');
SELECT is((SELECT (result->>'reverse_movements_count')::int FROM revert_fixture),2,'two original movements reversed once');
SELECT is((SELECT p.current_stock FROM products p,revert_fixture f WHERE p.id=f.product),0::numeric,'finished stock restored');
SELECT is((SELECT p.current_stock FROM products p,revert_fixture f WHERE p.id=f.material),98::numeric,'only nominal production material returned');
SELECT ok((SELECT p.reverted_at IS NOT NULL AND NOT p.materials_consumed AND NOT p.stock_updated AND NOT p.je_posted FROM production_records p,revert_fixture f WHERE p.id=f.production),'production reversal flags updated');
SELECT is((SELECT count(*)::int FROM stock_movements s,revert_fixture f WHERE s.metadata->>'production_id'=f.production::text AND s.metadata->>'reverse_of_production'='true'),2,'one counter-movement per original');
SELECT ok(NOT EXISTS(SELECT 1 FROM stock_movements s,revert_fixture f WHERE s.metadata->>'production_id'=f.production::text AND s.metadata->>'reverse_of_production'='true' AND (s.from_section_id IS NOT NULL OR s.to_section_id IS NOT NULL)),'counter-movements keep global stock semantics');
SELECT is((SELECT count(*)::int FROM audit_logs a,revert_fixture f WHERE a.entity_id=f.production AND a.action='production.revert'),1,'one reversal audit');
SELECT ok(NOT EXISTS(SELECT 1 FROM journal_entries j,revert_fixture f WHERE j.reference_type='production' AND j.reference_id=f.production AND j.total_debit<>j.total_credit),'counter-entries balanced');
SELECT throws_ok($q$SELECT revert_production_v3(production,'Repeat reversal fixture') FROM revert_fixture$q$,'P0001','already_reverted','sequential second reversal refused');
SELECT throws_ok($q$SELECT revert_production_v3(consumed,'Consumed reversal fixture') FROM revert_fixture$q$,'P0001','already_consumed','outgoing stock blocks reversal');
SELECT ok((SELECT p.reverted_at IS NULL AND p.stock_updated FROM production_records p,revert_fixture f WHERE p.id=f.consumed),'consumed production left intact');
SELECT throws_ok($q$SELECT revert_production_v3(old_production,'Old reversal fixture') FROM revert_fixture$q$,'P0001','production_too_old','24 hour rule retained');
SELECT throws_ok($q$SELECT revert_production_v3(gen_random_uuid(),'Missing reversal fixture')$q$,'P0002','production_not_found','missing production refused');
SELECT throws_ok($q$SELECT revert_production_v3(production,'') FROM revert_fixture$q$,'P0001','reason_required','reason still required');
SELECT is((SELECT count(*)::int FROM stock_movements s,revert_fixture f WHERE s.metadata->>'production_id'=f.production::text AND s.metadata->>'reverse_of_production'='true'),2,'all refused attempts leave original reversal unchanged');
SELECT * FROM finish();
ROLLBACK;
