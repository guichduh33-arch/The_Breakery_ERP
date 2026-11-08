-- Régression de précision : fixtures synthétiques et séquences temporaires sous ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='60s';
-- Fixture PIN réservée au propriétaire de la transaction, jamais à un client.
-- À inclure après BEGIN ; le ROLLBACK supprime sessions et fonction temporaire.
\ir helpers/pin_session.sql


DO $isolate$ DECLARE n bigint; BEGIN SELECT last_value+1000 INTO n FROM public.production_records_seq; EXECUTE format('CREATE TEMP SEQUENCE production_records_seq START WITH %s',n); END $isolate$;
DO $batch_sequence$ DECLARE n bigint; BEGIN SELECT last_value+1000 INTO n FROM public.production_batches_seq; EXECUTE format('CREATE TEMP SEQUENCE production_batches_seq START WITH %s',n); END $batch_sequence$;
CREATE TEMP TABLE _precision_red_result (value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _precision_red_tap (n serial, assertion text) ON COMMIT DROP;
INSERT INTO _precision_red_tap(assertion) SELECT plan(12);
DO $red$
DECLARE
  a uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); category uuid:=gen_random_uuid();
  station uuid:=gen_random_uuid(); yeast uuid:=gen_random_uuid(); starter uuid:=gen_random_uuid();
  product uuid:=gen_random_uuid(); failure text; failure_state text; v_second uuid:=gen_random_uuid(); v_items jsonb; v_detail text; v_required numeric; v_before numeric; v_blocked_records int; v_blocked_batches int; v_key uuid:=gen_random_uuid(); v_result jsonb; v_replay jsonb;
BEGIN
  IF 'production_records_seq'::regclass='public.production_records_seq'::regclass THEN
    RAISE EXCEPTION 'fixture_sequence_not_isolated';
  END IF;
  INSERT INTO auth.users(id) VALUES(a);
  INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
  VALUES(profile,a,'PREC-RED-'||left(profile::text,8),'Precision RED fixture','SUPER_ADMIN',hash_pin('358247'),true);
  PERFORM pg_temp.authenticate_pin(a);
  INSERT INTO categories(id,name,slug,category_type) VALUES(category,'Precision RED','prec-red-'||category,'raw_material');
  INSERT INTO sections(id,code,name,kind) VALUES(station,'PREC-RED-'||left(station::text,8),'Precision RED','production');
  INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock,default_shelf_life_hours) VALUES
    (yeast,'PREC-RED-'||left(yeast::text,8),'Precision yeast',category,0,0,1000000,'kg','finished',true,true,false,NULL),
    (starter,'PREC-RED-'||left(starter::text,8),'Precision starter',category,0,0,0,'kg','finished',true,false,true,NULL),
    (product,'PREC-RED-'||left(product::text,8),'Precision finished',category,0,0,0,'pcs','finished',true,true,true,NULL);
  PERFORM record_stock_movement_v2(p_product_id:=yeast,p_movement_type:='incoming',p_quantity:=0.000000003,p_reason:='Precision batch initial stock');
  INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,is_active,track_inventory,deduct_stock,default_shelf_life_hours)
VALUES(v_second,'PREC-RED-'||left(v_second::text,8),'Second precision finished',category,0,0,0,'pcs','finished',true,true,true,NULL);
INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES(starter,yeast,0.003,'gr',true),(product,starter,0.5,'kg',true),(v_second,starter,0.5,'kg',true);
v_items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity_produced',0.001,'idempotency_key',gen_random_uuid()),jsonb_build_object('product_id',v_second,'quantity_produced',0.001,'idempotency_key',gen_random_uuid()));
BEGIN
 PERFORM record_batch_production_v14(jsonb_build_object('section_id',station,'idempotency_key',v_key),v_items);
EXCEPTION WHEN OTHERS THEN failure:=SQLERRM; GET STACKED DIAGNOSTICS v_detail=PG_EXCEPTION_DETAIL;
END;
v_required:=(v_detail::jsonb->0->>'required')::numeric;
SELECT current_stock INTO v_before FROM products WHERE id=yeast;
SELECT count(*) INTO v_blocked_records FROM production_records WHERE product_id IN(product,v_second);
SELECT count(*) INTO v_blocked_batches FROM production_batches WHERE idempotency_key=v_key;
PERFORM record_stock_movement_v2(p_product_id:=yeast,p_movement_type:='incoming',p_quantity:=0.000000001,p_reason:='Precision batch complement');
v_result:=record_batch_production_v14(jsonb_build_object('section_id',station,'idempotency_key',v_key),v_items);
v_replay:=record_batch_production_v14(jsonb_build_object('section_id',station,'idempotency_key',v_key),v_items);
INSERT INTO _precision_red_result VALUES(jsonb_build_object('observed_at',clock_timestamp(),'shortage',failure,'required',v_required,'before',v_before,'blocked_records',v_blocked_records,'blocked_batches',v_blocked_batches,
 'after',(SELECT current_stock FROM products WHERE id=yeast),
 'out_count',(SELECT count(*) FROM stock_movements WHERE product_id=yeast AND movement_type='production_out'),
 'out_sum',(SELECT sum(quantity) FROM stock_movements WHERE product_id=yeast AND movement_type='production_out'),
 'each_out',(SELECT bool_and(quantity=-0.000000002) FROM stock_movements WHERE product_id=yeast AND movement_type='production_out'),
 'finished',(SELECT bool_and(current_stock=0.001) FROM products WHERE id IN(product,v_second)),
 'replay',v_replay->>'idempotent_replay',
 'ledger_equal',(SELECT current_stock=(SELECT sum(quantity) FROM stock_movements WHERE product_id=yeast) FROM products WHERE id=yeast)));
END $red$;
INSERT INTO _precision_red_tap(assertion)
SELECT is((SELECT value->>'shortage' FROM _precision_red_result),'insufficient_stock','batch refuses combined rounded consumption')
UNION ALL SELECT is((SELECT (value->>'required')::numeric FROM _precision_red_result),0.000000004::numeric,'batch requires sum of two rounded lines')
UNION ALL SELECT is((SELECT (value->>'before')::numeric FROM _precision_red_result),0.000000003::numeric,'refused batch keeps stock unchanged')
UNION ALL SELECT is((SELECT (value->>'blocked_records')::int FROM _precision_red_result),0,'refused batch creates no production')
UNION ALL SELECT is((SELECT (value->>'blocked_batches')::int FROM _precision_red_result),0,'refused batch creates no batch')
UNION ALL SELECT is((SELECT (value->>'after')::numeric FROM _precision_red_result),0::numeric,'sufficient exact stock is fully consumed')
UNION ALL SELECT is((SELECT (value->>'out_count')::int FROM _precision_red_result),2,'two production lines emit two consumptions')
UNION ALL SELECT is((SELECT (value->>'out_sum')::numeric FROM _precision_red_result),-0.000000004::numeric,'ledger consumption equals batch requirement')
UNION ALL SELECT is((SELECT (value->>'each_out')::boolean FROM _precision_red_result),true,'each line emits its rounded two nano units')
UNION ALL SELECT is((SELECT (value->>'finished')::boolean FROM _precision_red_result),true,'both fractional finished outputs are recorded')
UNION ALL SELECT is((SELECT value->>'replay' FROM _precision_red_result),'true','batch retry is idempotent')
UNION ALL SELECT is((SELECT (value->>'ledger_equal')::boolean FROM _precision_red_result),true,'cache equals the full synthetic ledger');
INSERT INTO _precision_red_tap(assertion) SELECT * FROM finish();
SELECT jsonb_build_object('target','ikcyvlovptebroadgtvd','result',(SELECT value FROM _precision_red_result),'tap',(SELECT jsonb_agg(assertion ORDER BY n) FROM _precision_red_tap));
ROLLBACK;
