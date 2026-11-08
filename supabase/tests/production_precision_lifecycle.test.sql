-- Précision du ledger, annulation, comptage indépendant et déclaration : DEV sous ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='60s';
\ir helpers/pin_session.sql
DO $isolate$ DECLARE n bigint; BEGIN
  SELECT last_value+1000 INTO n FROM public.production_records_seq;
  EXECUTE format('CREATE TEMP SEQUENCE production_records_seq START WITH %s',n);
END $isolate$;
CREATE TEMP TABLE precision_lifecycle_results(n serial,tap text) ON COMMIT DROP;
INSERT INTO precision_lifecycle_results(tap) SELECT plan(29);
DO $test$
DECLARE
  owner_auth uuid:=gen_random_uuid(); owner_profile uuid:=gen_random_uuid();
  counter_auth uuid:=gen_random_uuid(); counter_profile uuid:=gen_random_uuid();
  role_name text:='PREC-'||left(gen_random_uuid()::text,8);
  category uuid:=gen_random_uuid(); station uuid:=gen_random_uuid();
  material uuid:=gen_random_uuid(); starter uuid:=gen_random_uuid(); product uuid:=gen_random_uuid();
  count_id uuid:=gen_random_uuid(); item_id uuid; declaration_id uuid; production_id uuid;
  movement_id uuid; request_key uuid:=gen_random_uuid(); result jsonb; replay jsonb;
BEGIN
  INSERT INTO auth.users(id) VALUES(owner_auth),(counter_auth);
  INSERT INTO roles(code,name) VALUES(role_name,'Transactional precision counter');
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active) VALUES
    (owner_profile,owner_auth,'PREC-LIFE-'||left(owner_profile::text,8),'Precision owner','SUPER_ADMIN',hash_pin('358247'),true),
    (counter_profile,counter_auth,'PREC-LIFE-'||left(counter_profile::text,8),'Precision counter',role_name,hash_pin('358247'),true);
  INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
    SELECT counter_profile,p,true,'Transactional precision fixture'
    FROM unnest(ARRAY['inventory.opname.create','inventory.adjust']) p;
  PERFORM pg_temp.authenticate_pin(owner_auth);
  INSERT INTO categories(id,name,slug,category_type) VALUES(category,'Precision lifecycle','prec-life-'||category,'raw_material');
  INSERT INTO sections(id,code,name,kind) VALUES(station,'PREC-LIFE-'||left(station::text,8),'Precision lifecycle','production');
  INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock,default_shelf_life_hours) VALUES
    (material,'PREC-LIFE-'||left(material::text,8),'Precision lifecycle material',category,0,0,1000000,'kg','finished',true,true,false,NULL),
    (starter,'PREC-LIFE-'||left(starter::text,8),'Precision lifecycle starter',category,0,0,0,'kg','finished',true,false,true,NULL),
    (product,'PREC-LIFE-'||left(product::text,8),'Precision lifecycle finished',category,0,0,0,'pcs','finished',true,true,true,NULL);
  PERFORM record_stock_movement_v2(p_product_id:=material,p_movement_type:='incoming',p_quantity:=1,p_reason:='Precision lifecycle seed');
  INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES
    (starter,material,0.002,'kg',true),(product,starter,0.083,'kg',true);
  result:=record_production_v12(p_product_id:=product,p_quantity_produced:=1,p_section_id:=station);
  production_id:=(result->>'production_id')::uuid;
  PERFORM revert_production_v4(production_id,'Precision lifecycle exact reversal');
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT current_stock FROM products WHERE id=material),1::numeric,'revert restores exact ingredient stock')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=product),0::numeric,'revert removes exact finished output')
    UNION ALL SELECT is((SELECT sum(quantity) FROM stock_movements WHERE product_id=material),1::numeric,'revert preserves full ledger equality')
    UNION ALL SELECT ok(EXISTS(SELECT 1 FROM stock_movements WHERE product_id=material AND quantity=0.000166 AND metadata->>'reverse_of_production'='true'),'revert writes the exact fractional counter-movement');
  PERFORM record_production_v12(p_product_id:=product,p_quantity_produced:=1,p_section_id:=station);
  PERFORM pg_temp.authenticate_pin(counter_auth);
  INSERT INTO inventory_counts(id,count_number,created_by) VALUES(count_id,'PREC-LIFE-'||count_id,counter_profile);
  result:=add_opname_item_v4(count_id,material);
  item_id:=(result->>'item_id')::uuid;
  INSERT INTO precision_lifecycle_results(tap)
    SELECT ok(result->'expected_qty'='null'::jsonb,'non-owner cannot see expected stock in response')
    UNION ALL SELECT is((SELECT expected_qty FROM inventory_count_items WHERE id=item_id),0.999834::numeric,'stored count expectation retains residue')
    UNION ALL SELECT throws_ok(format('SELECT record_production_v12(p_product_id:=%L,p_quantity_produced:=1,p_section_id:=%L)',product,station),'P0003','forbidden','active PIN session without production permission is refused');
  PERFORM set_opname_count_v3(item_id,1);
  PERFORM validate_opname_v2(count_id);
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT variance FROM inventory_count_items WHERE id=item_id),0.000166::numeric,'generated count variance retains residue')
    UNION ALL SELECT throws_ok(format('SELECT finalize_opname_v6(%L)',count_id),'P0003','forbidden','non-owner cannot finalize count')
    UNION ALL SELECT throws_ok(format('SELECT set_opname_count_v3(%L,1.0001)',item_id),'P0001','counted_qty_invalid','human count precision remains three decimals');
  PERFORM pg_temp.authenticate_pin(owner_auth);
  result:=finalize_opname_v6(count_id);
  replay:=finalize_opname_v6(count_id);
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT current_stock FROM products WHERE id=material),1::numeric,'opname closes the exact fractional gap')
    UNION ALL SELECT is((SELECT quantity FROM stock_movements WHERE reference_type='opname' AND reference_id=count_id),0.000166::numeric,'opname ledger movement retains fractional gap')
    UNION ALL SELECT is((SELECT count(*) FROM stock_movements WHERE reference_type='opname' AND reference_id=count_id),1::bigint,'opname replay creates no second movement')
    UNION ALL SELECT is(replay->>'idempotent_replay','true','opname replay returns existing result')
    UNION ALL SELECT is((SELECT actor_id FROM audit_logs WHERE entity_id=count_id AND action='opname.finalize'),owner_profile,'opname audit records profile distinct from auth');
  PERFORM record_production_v12(p_product_id:=product,p_quantity_produced:=1,p_section_id:=station);
  PERFORM pg_temp.authenticate_pin(counter_auth);
  result:=submit_stock_declaration_v2('adjust',material,1,'Precision lifecycle declaration',gen_random_uuid());
  declaration_id:=(result->>'declaration_id')::uuid;
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT baseline_quantity FROM stock_declarations WHERE id=declaration_id),0.999834::numeric,'declaration baseline retains fractional stock');
  PERFORM pg_temp.authenticate_pin(owner_auth);
  result:=approve_stock_declaration_v4(declaration_id);
  replay:=approve_stock_declaration_v4(declaration_id);
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is(result->>'status','approved','unchanged fractional baseline is not falsely stale')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=material),1::numeric,'approval applies exact fractional delta')
    UNION ALL SELECT is((SELECT quantity FROM stock_movements WHERE idempotency_key=declaration_id),0.000166::numeric,'approved adjustment ledger retains residue')
    UNION ALL SELECT is(replay->>'idempotent_replay','true','declaration approval replay stays idempotent');
  result:=record_stock_movement_v2(p_product_id:=material,p_movement_type:='waste',p_quantity:=-0.0000000015,p_reason:='Precision signed tie',p_idempotency_key:=request_key);
  movement_id:=(result->>'movement_id')::uuid;
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT quantity FROM stock_movements WHERE id=movement_id),-0.000000002::numeric,'negative half quantum rounds once away from zero')
    UNION ALL SELECT is((SELECT current_stock FROM products WHERE id=material),0.999999998::numeric,'cache uses the same signed quantity as ledger')
    UNION ALL SELECT is((SELECT (metadata->>'quantity')::numeric FROM audit_logs WHERE entity_id=movement_id AND action='stock.movement'),-0.000000002::numeric,'audit uses the effective rounded quantity');
  PERFORM record_stock_movement_v2(p_product_id:=material,p_movement_type:='incoming',p_quantity:=0.25,p_reason:='Precision intervening movement');
  replay:=record_stock_movement_v2(p_product_id:=material,p_movement_type:='waste',p_quantity:=-0.0000000015,p_reason:='Precision signed tie',p_idempotency_key:=request_key);
  INSERT INTO precision_lifecycle_results(tap)
    SELECT is((SELECT current_stock FROM products WHERE id=material),1.249999998::numeric,'primitive replay preserves intervening movement')
    UNION ALL SELECT is((SELECT count(*) FROM stock_movements WHERE idempotency_key=request_key),1::bigint,'primitive retry emits one movement')
    UNION ALL SELECT throws_ok(format('SELECT record_stock_movement_v2(%L,''waste'',-0.0000000001,''Precision below quantum'')',material),'P0001','quantity_below_stock_precision','positive magnitude below storage precision fails instead of being skipped')
    UNION ALL SELECT ok(NOT has_function_privilege('anon','public.record_production_v12(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,public.waste_reason)','EXECUTE'),'anon cannot inherit production execute')
    UNION ALL SELECT ok(NOT has_function_privilege('authenticated','public.record_stock_movement_v2(uuid,public.movement_type,numeric,text,numeric,uuid,uuid,text,uuid,uuid,jsonb,uuid,boolean)','EXECUTE'),'client cannot execute primitive directly')
    UNION ALL SELECT is((SELECT current_stock=(SELECT sum(quantity) FROM stock_movements WHERE product_id=material) FROM products WHERE id=material),true,'final cache equals complete synthetic ledger');
END $test$;
INSERT INTO precision_lifecycle_results(tap) SELECT * FROM finish();
SELECT jsonb_build_object('target','ikcyvlovptebroadgtvd','observed_at',clock_timestamp(),'tap',(SELECT jsonb_agg(tap ORDER BY n) FROM precision_lifecycle_results));
ROLLBACK;
