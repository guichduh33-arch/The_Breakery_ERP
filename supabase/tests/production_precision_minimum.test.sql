-- Régression de précision : fixtures synthétiques et séquences temporaires sous ROLLBACK.
BEGIN;
SET LOCAL statement_timeout='60s';
-- Fixture PIN réservée au propriétaire de la transaction, jamais à un client.
-- À inclure après BEGIN ; le ROLLBACK supprime sessions et fonction temporaire.
\ir helpers/pin_session.sql


DO $isolate$ DECLARE n bigint; BEGIN SELECT last_value+1000 INTO n FROM public.production_records_seq; EXECUTE format('CREATE TEMP SEQUENCE production_records_seq START WITH %s',n); END $isolate$;
CREATE TEMP TABLE _precision_red_result (value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE _precision_red_tap (n serial, assertion text) ON COMMIT DROP;
INSERT INTO _precision_red_tap(assertion) SELECT plan(10);
DO $red$
DECLARE
  a uuid:=gen_random_uuid(); profile uuid:=gen_random_uuid(); category uuid:=gen_random_uuid();
  station uuid:=gen_random_uuid(); yeast uuid:=gen_random_uuid(); starter uuid:=gen_random_uuid();
  product uuid:=gen_random_uuid(); failure text; failure_state text; v_key uuid:=gen_random_uuid(); v_result jsonb; v_replay jsonb;
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
    (yeast,'PREC-RED-'||left(yeast::text,8),'Precision yeast',category,0,0,1000000000,'kg','finished',true,true,false,NULL),
    (starter,'PREC-RED-'||left(starter::text,8),'Precision starter',category,0,0,0,'kg','finished',true,false,true,NULL),
    (product,'PREC-RED-'||left(product::text,8),'Precision finished',category,0,0,0,'pcs','finished',true,true,true,NULL);
  PERFORM record_stock_movement_v2(p_product_id:=yeast,p_movement_type:='incoming',p_quantity:=1,p_reason:='Precision RED stock');
  INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES
    (product,yeast,0.09,'gr',true);
  BEGIN
    v_result:=record_production_v12(p_product_id:=product,p_quantity_produced:=0.001,p_section_id:=station,p_idempotency_key:=v_key); v_replay:=record_production_v12(p_product_id:=product,p_quantity_produced:=0.001,p_section_id:=station,p_idempotency_key:=v_key);
  EXCEPTION WHEN OTHERS THEN
    failure:=SQLERRM; failure_state:=SQLSTATE;
  END;
  INSERT INTO _precision_red_result VALUES(jsonb_build_object(
    'observed_at',clock_timestamp(),'failure',failure,'sqlstate',failure_state,
    'required',0.00009::numeric*0.001,'stock',(SELECT current_stock FROM products WHERE id=yeast),
    'production_count',(SELECT count(*) FROM production_records WHERE product_id=product),
    'outgoing_count',(SELECT count(*) FROM stock_movements WHERE product_id=yeast AND movement_type='production_out'),
    'stock_scale',(SELECT numeric_scale FROM information_schema.columns WHERE table_schema='public' AND table_name='stock_movements' AND column_name='quantity'),
    'actor_is_profile',(SELECT staff_id=profile FROM production_records WHERE id=(v_result->>'production_id')::uuid), 'replay',v_replay->>'idempotent_replay', 'same_production',(v_replay->>'production_id')=(v_result->>'production_id'), 'ledger_quantity',(SELECT quantity FROM stock_movements WHERE product_id=yeast AND movement_type='production_out'), 'je_count',(SELECT count(*) FROM journal_entries j JOIN stock_movements m ON m.id=j.reference_id WHERE m.metadata->>'production_id'=v_result->>'production_id'), 'je_balanced',NOT EXISTS(SELECT 1 FROM journal_entries j JOIN stock_movements m ON m.id=j.reference_id WHERE m.metadata->>'production_id'=v_result->>'production_id' AND j.total_debit<>j.total_credit)));
END $red$;
INSERT INTO _precision_red_tap(assertion)
SELECT is((SELECT value->>'failure' FROM _precision_red_result),NULL::text,'one piece must produce without a zero-quantity error')
UNION ALL SELECT is((SELECT (value->>'required')::numeric FROM _precision_red_result),0.00000009::numeric,'minimum observed input needs exactly 9e-8 kg')
UNION ALL SELECT is((SELECT (value->>'stock')::numeric FROM _precision_red_result),0.99999991::numeric,'minimum observed input preserves exact cache')
UNION ALL SELECT is((SELECT (value->>'production_count')::int FROM _precision_red_result),1,'one production record after replay')
UNION ALL SELECT is((SELECT (value->>'outgoing_count')::int FROM _precision_red_result),1,'one consumption movement after replay')
UNION ALL SELECT is((SELECT (value->>'ledger_quantity')::numeric FROM _precision_red_result),-0.00000009::numeric,'ledger preserves the nine-decimal requirement')
UNION ALL SELECT is((SELECT value->>'replay' FROM _precision_red_result),'true','retry returns the first result')
UNION ALL SELECT is((SELECT (value->>'actor_is_profile')::boolean FROM _precision_red_result),true,'production audit resolves the profile distinct from auth')
UNION ALL SELECT is((SELECT (value->>'je_count')::int FROM _precision_red_result),2,'two nonzero production journal entries are emitted')
UNION ALL SELECT is((SELECT (value->>'je_balanced')::boolean FROM _precision_red_result),true,'production journal entries remain balanced');
INSERT INTO _precision_red_tap(assertion) SELECT * FROM finish();
SELECT jsonb_build_object('target','ikcyvlovptebroadgtvd','result',(SELECT value FROM _precision_red_result),'tap',(SELECT jsonb_agg(assertion ORDER BY n) FROM _precision_red_tap));
ROLLBACK;
