-- Fixtures transactionnelles : aucun droit ni mouvement ne subsiste après le test.
BEGIN;
SELECT plan(39);
CREATE TEMP TABLE kitchen_fixture (profile uuid, uid uuid, section uuid, other_section uuid, product uuid, material uuid, request jsonb, receipt jsonb);
DO $$
DECLARE u uuid := gen_random_uuid(); p uuid := gen_random_uuid(); s uuid := gen_random_uuid();
  other_s uuid := gen_random_uuid(); fin uuid := gen_random_uuid(); mat uuid := gen_random_uuid(); cat uuid;
BEGIN
  INSERT INTO auth.users(id, email) VALUES (u, u::text || '@kitchen.invalid');
  INSERT INTO roles(code,name) VALUES ('KITCHEN_TEST','Kitchen test');
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code)
    VALUES(p,u,'KT-' || p,'Kitchen test','not-a-login-hash','KITCHEN_TEST');
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    VALUES(p,'inventory.production.kitchen',true,'transaction test');
  INSERT INTO sections(id,code,name,kind) VALUES(s,'KT-'||s,'Kitchen test','production'),(other_s,'KT-'||other_s,'Other kitchen','production');
  INSERT INTO kitchen_user_sections VALUES(p,s);
  SELECT id INTO cat FROM categories LIMIT 1;
  INSERT INTO products(id,sku,name,category_id,retail_price,unit,current_stock,cost_price,deduct_stock)
    VALUES(mat,'KT-'||mat,'Kitchen flour',cat,0,'kg',100,1000,false),
      (fin,'KT-'||fin,'Kitchen bread',cat,1000,'pcs',0,0,true);
  INSERT INTO recipes(product_id,material_id,quantity,unit) VALUES(fin,mat,0.1,'kg');
  INSERT INTO product_sections(product_id,section_id) VALUES(fin,s);
  INSERT INTO product_unit_alternatives(product_id,code,factor_to_base) VALUES(fin,'dozen',12);
  INSERT INTO kitchen_fixture VALUES(p,u,s,other_s,fin,mat,jsonb_build_object(
    'idempotency_key',gen_random_uuid(),'section_id',s,'day',CURRENT_DATE,
    'items',jsonb_build_array(jsonb_build_object('product_id',fin,'unit','dozen','quantity_produced',1,
      'quantity_waste',0,'waste_reason','','note','Chef note'))),NULL);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
END $$;
SELECT is(jsonb_array_length(get_kitchen_stations_v1()),1,'Only assigned stations');
SELECT is(jsonb_array_length(get_kitchen_products_v1((SELECT section FROM kitchen_fixture))),1,'Assigned producible products');
SELECT ok(NOT (get_kitchen_products_v1((SELECT section FROM kitchen_fixture))->0 ? 'cost_price'),'No product cost');
SELECT throws_ok(format('SELECT get_kitchen_products_v1(%L)',(SELECT other_section FROM kitchen_fixture)), 'P0003','kitchen_section_forbidden','Foreign station refused');
SELECT throws_ok(format('SELECT record_production_v6(%L,1,%L)',(SELECT product FROM kitchen_fixture),(SELECT section FROM kitchen_fixture)), 'P0003','forbidden','Direct unit production refused');
SELECT throws_ok(format('SELECT record_batch_production_v8(%L::jsonb,%L::jsonb)',
  jsonb_build_object('section_id',(SELECT section FROM kitchen_fixture)),'[]'),'P0003','forbidden','Direct batch refused');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT request || jsonb_build_object('day',CURRENT_DATE-1) FROM kitchen_fixture)),'P0001','kitchen_today_only','Backdating refused');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT request || '{"force_negative":true}'::jsonb FROM kitchen_fixture)),'P0001','invalid_kitchen_request','Forcing refused');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(request,'{items,0,product_id}',to_jsonb(material)) FROM kitchen_fixture)), 'P0003','kitchen_product_forbidden','Foreign product refused');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(request,'{items,0,quantity_waste}','1') FROM kitchen_fixture)),'P0001','waste_reason_required','Waste needs reason');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(request,'{items,0,quantity_produced}','1000') FROM kitchen_fixture)),'P0002','insufficient_stock','Stock shortage blocks');
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product FROM kitchen_fixture)),0::numeric,'Failed submissions have no stock effect');
UPDATE kitchen_fixture SET receipt=record_kitchen_production_v1(request);
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product FROM kitchen_fixture)),12::numeric,'Alternative unit resolved server-side');
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT material FROM kitchen_fixture)),98.8::numeric,'Ingredients deducted');
SELECT is((SELECT staff_id FROM production_records WHERE batch_id=(SELECT (receipt->>'batch_id')::uuid FROM kitchen_fixture)),
  (SELECT profile FROM kitchen_fixture),'Author is profile, not auth UUID');
SELECT is((SELECT notes FROM production_records WHERE batch_id=(SELECT (receipt->>'batch_id')::uuid FROM kitchen_fixture)),'Chef note','Line note retained');
SELECT is((record_kitchen_production_v1((SELECT request FROM kitchen_fixture))->>'idempotent_replay')::boolean,true,'Retry is idempotent');
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product FROM kitchen_fixture)),12::numeric,'Retry does not duplicate stock');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(request,'{items,0,quantity_produced}','2') FROM kitchen_fixture)),'P0001','idempotency_payload_mismatch','Changed payload cannot reuse key');
SELECT is(jsonb_array_length(get_kitchen_history_v1((SELECT section FROM kitchen_fixture),CURRENT_DATE)),1,'History includes production');
SELECT is((get_kitchen_history_v1((SELECT section FROM kitchen_fixture),CURRENT_DATE)->0->>'author'),'Kitchen test','History includes author');
SELECT ok(NOT ((SELECT receipt FROM kitchen_fixture) ? 'production_records'),'Receipt omits financial core results');
GRANT SELECT ON kitchen_fixture TO authenticated;
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM products WHERE id=(SELECT product FROM kitchen_fixture)),0,'Direct product reads cannot leak costs');
SELECT is((SELECT count(*)::integer FROM production_records WHERE section_id=(SELECT section FROM kitchen_fixture)),0,'Direct records cannot leak other stations');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon','public.record_kitchen_production_v1(jsonb)','EXECUTE'),'Anonymous submission denied');
SELECT ok(NOT has_function_privilege('authenticated','public._kitchen_context_v1(uuid,uuid)','EXECUTE'),'Private context not callable');
SELECT throws_ok(format('SELECT set_user_kitchen_access_v1(%L,true,ARRAY[%L]::uuid[],%L)',
  (SELECT profile FROM kitchen_fixture),(SELECT section FROM kitchen_fixture),'test access'),'P0003','forbidden','Chef cannot grant access');
SELECT throws_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(request || jsonb_build_object('idempotency_key',gen_random_uuid()),'{items,0,unit}','"invalid"') FROM kitchen_fixture)),
  'P0001','invalid_kitchen_unit','Unknown unit refused');
-- Le lot historique reste utilisable sans accorder inventory.receive au chef.
UPDATE products SET default_shelf_life_hours=24 WHERE id=(SELECT product FROM kitchen_fixture);
SELECT lives_ok(format('SELECT record_kitchen_production_v1(%L::jsonb)',
  (SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(request || jsonb_build_object('idempotency_key',gen_random_uuid()),
    '{items,0,unit}','"pcs"'),'{items,0,quantity_waste}','1'),'{items,0,waste_reason}','"mis_baked"'),'{items,0,quantity_produced}','1')
    FROM kitchen_fixture)),'Production with waste and legacy shelf metadata succeeds');
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT product FROM kitchen_fixture)),13::numeric,'Only sellable production enters stock');
SELECT is((SELECT current_stock FROM products WHERE id=(SELECT material FROM kitchen_fixture)),98.6::numeric,'Waste also consumes ingredients');
SELECT ok(EXISTS (SELECT 1 FROM journal_entries je WHERE je.metadata->>'movement_type'='production_waste'
  AND (je.metadata->>'production_id')::uuid IN (SELECT id FROM production_records WHERE section_id=(SELECT section FROM kitchen_fixture))),
  'Waste accounting still posts');
DELETE FROM kitchen_user_sections WHERE user_profile_id=(SELECT profile FROM kitchen_fixture);
SELECT throws_ok(format('SELECT get_kitchen_products_v1(%L)',(SELECT section FROM kitchen_fixture)),'P0003','kitchen_section_forbidden','Removed assignment takes effect');
UPDATE user_permission_overrides SET is_granted=false WHERE user_profile_id=(SELECT profile FROM kitchen_fixture);
SELECT throws_ok('SELECT get_kitchen_stations_v1()','P0003','kitchen_forbidden','Removed permission takes effect');
-- Les habilitations sont modifiées par un SUPER_ADMIN et auditées avec son profil.
CREATE TEMP TABLE kitchen_admin_fixture (profile uuid, uid uuid);
DO $$
DECLARE u uuid := gen_random_uuid(); p uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,email) VALUES(u,u::text || '@kitchen.invalid');
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,pin_hash,role_code)
    VALUES(p,u,'KA-' || p,'Kitchen admin test','not-a-login-hash','SUPER_ADMIN');
  INSERT INTO kitchen_admin_fixture VALUES(p,u);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
END $$;
SELECT lives_ok(format('SELECT set_user_kitchen_access_v1(%L,true,ARRAY[%L]::uuid[],%L)',
  (SELECT profile FROM kitchen_fixture),(SELECT section FROM kitchen_fixture),'Tablet chef assignment'),'Super admin assigns kitchen access');
SELECT is((get_user_kitchen_access_v1((SELECT profile FROM kitchen_fixture))->>'enabled')::boolean,true,'Permission is granted');
SELECT is((SELECT count(*)::integer FROM kitchen_user_sections WHERE user_profile_id=(SELECT profile FROM kitchen_fixture)),1,'Assigned station is persisted');
SELECT ok(EXISTS(SELECT 1 FROM audit_logs WHERE actor_id=(SELECT profile FROM kitchen_admin_fixture)
  AND entity_id=(SELECT profile FROM kitchen_fixture) AND action='user.kitchen_sections_set'),'Assignment audit uses actor profile');
SELECT lives_ok(format('SELECT set_user_kitchen_access_v1(%L,false,ARRAY[]::uuid[],%L)',
  (SELECT profile FROM kitchen_fixture),'Tablet access removed'),'Super admin removes access');
SELECT * FROM finish();
ROLLBACK;
