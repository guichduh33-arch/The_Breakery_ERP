-- Ventes de part et d'autre de la bascule : calcul choisi, replays et restitutions.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path=public,extensions,pg_catalog;
\ir helpers/pin_session.sql
\ir helpers/complete_order_before_units.sql
\ir helpers/pay_order_before_units.sql
\ir helpers/create_b2b_before_units.sql
CREATE TEMP TABLE unit_compat_tap(line text);
INSERT INTO unit_compat_tap SELECT plan(65);
CREATE TEMP TABLE unit_compat_fixture(auth_id uuid,profile_id uuid,session_id uuid,customer_id uuid,root uuid,material uuid);
CREATE TEMP TABLE unit_compat_cases(mode text,path text,order_id uuid,client_key uuid,consumed numeric);
DO $fixture$
DECLARE a uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 cat uuid:=gen_random_uuid(); customer_cat uuid:=gen_random_uuid(); root uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); x uuid:=gen_random_uuid(); y uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id) VALUES(a);
 INSERT INTO user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(p,a,'COMPAT-'||left(p::text,8),'Unit compatibility','SUPER_ADMIN',hash_pin('438271'),true);
 PERFORM pg_temp.authenticate_pin(a);
 INSERT INTO categories(id,name,slug,category_type) VALUES(cat,'Unit compatibility','compat-'||cat,'raw_material');
 INSERT INTO products(id,sku,name,category_id,retail_price,current_stock,cost_price,unit,product_type,track_inventory,deduct_stock) VALUES
 (m,'COMPAT-'||left(m::text,8),'Compatibility material',cat,0,100,100,'kg','finished',true,true),
 (x,'COMPAT-'||left(x::text,8),'Compatibility stage A',cat,0,0,0,'kg','finished',false,true),
 (y,'COMPAT-'||left(y::text,8),'Compatibility stage B',cat,0,0,0,'kg','finished',false,true),
 (root,'COMPAT-'||left(root::text,8),'Compatibility root',cat,2000,0,0,'pcs','finished',false,true);
 INSERT INTO recipes(product_id,material_id,quantity,unit,is_active) VALUES
 (root,x,1,'kg',true),(root,y,1,'kg',true),(x,m,500,'g',true),(y,m,0.5,'kg',true);
 INSERT INTO customer_categories(id,name,slug) VALUES(customer_cat,'Unit compatibility','unit-compat-'||customer_cat);
 INSERT INTO customers(id,name,customer_type,category_id,b2b_company_name,b2b_credit_limit,b2b_current_balance)
 VALUES(c,'Compatibility B2B','b2b',customer_cat,'Compatibility B2B',NULL,0);
 INSERT INTO pos_sessions(id,opened_by,opening_cash,status) VALUES(s,p,0,'open');
 UPDATE business_config SET allow_negative_stock=false;
 INSERT INTO unit_compat_fixture VALUES(a,p,s,c,root,m);
END $fixture$;
DO $sales$
DECLARE f record; mode text; path text; result jsonb; replay jsonb; k uuid; oid uuid; count_before bigint; marker smallint;
 items jsonb; pay jsonb; expected numeric;
BEGIN
 SELECT * INTO f FROM unit_compat_fixture;
 items:=jsonb_build_array(jsonb_build_object('product_id',f.root,'quantity',4,'unit_price',2000,'modifiers','[]'::jsonb));
 pay:=jsonb_build_object('method','cash','amount',8000,'cash_received',8000);
 FOREACH mode IN ARRAY ARRAY['legacy','new'] LOOP
  FOREACH path IN ARRAY ARRAY['complete','existing','b2b'] LOOP
   k:=gen_random_uuid(); expected:=CASE WHEN mode='legacy' THEN 2.002 ELSE 4 END;
   IF path='existing' THEN
    result:=fire_counter_order_v11(p_client_uuid:=gen_random_uuid(),p_session_id:=f.session_id,p_items:=items,p_order_type:='dine_in',p_table_number:='COMPAT-'||left(k::text,8));
    oid:=(result->>'order_id')::uuid;
    IF (SELECT recipe_consumption_revision FROM orders WHERE id=oid) IS NOT NULL THEN RAISE EXCEPTION 'fire marked sale prematurely'; END IF;
    IF mode='legacy' THEN result:=pg_temp.pay_order_before_units(p_order_id:=oid,p_payment:=pay,p_idempotency_key:=k);
    ELSE result:=pay_existing_order_v22(p_order_id:=oid,p_payment:=pay,p_idempotency_key:=k); END IF;
   ELSIF path='b2b' THEN
    IF mode='legacy' THEN result:=pg_temp.create_b2b_before_units(f.customer_id,items,NULL,NULL,k);
    ELSE result:=create_b2b_order_v8(f.customer_id,items,NULL,NULL,k); END IF;
    oid:=(result->>'order_id')::uuid;
   ELSE
    IF mode='legacy' THEN result:=pg_temp.complete_order_before_units(p_session_id:=f.session_id,p_order_type:='take_out',p_items:=items,p_payment:=pay,p_idempotency_key:=k);
    ELSE result:=complete_order_with_payment_v30(p_session_id:=f.session_id,p_order_type:='take_out',p_items:=items,p_payment:=pay,p_idempotency_key:=k); END IF;
    oid:=(result->>'order_id')::uuid;
   END IF;
   SELECT recipe_consumption_revision INTO marker FROM orders WHERE id=oid;
   INSERT INTO unit_compat_tap SELECT is(marker,CASE WHEN mode='legacy' THEN NULL::smallint ELSE 2::smallint END,mode||' '||path||' revision');
   INSERT INTO unit_compat_tap SELECT is((SELECT -sum(quantity) FROM stock_movements WHERE reference_id=oid AND movement_type='sale'),expected,mode||' '||path||' exact consumption');
   SELECT count(*) INTO count_before FROM stock_movements WHERE reference_id=oid;
   IF path='existing' THEN replay:=pay_existing_order_v22(p_order_id:=oid,p_payment:=pay,p_idempotency_key:=k);
   ELSIF path='b2b' THEN replay:=create_b2b_order_v8(f.customer_id,items,NULL,NULL,k);
   ELSE replay:=complete_order_with_payment_v30(p_session_id:=f.session_id,p_order_type:='take_out',p_items:=items,p_payment:=pay,p_idempotency_key:=k); END IF;
   INSERT INTO unit_compat_tap SELECT is((replay->>'order_id')::uuid,oid,mode||' '||path||' replay original order');
   INSERT INTO unit_compat_tap SELECT is((SELECT recipe_consumption_revision FROM orders WHERE id=oid),marker,mode||' '||path||' replay keeps revision');
   INSERT INTO unit_compat_tap SELECT is((SELECT count(*) FROM stock_movements WHERE reference_id=oid),count_before,mode||' '||path||' replay no movements');
   INSERT INTO unit_compat_tap SELECT ok((replay->>'idempotent_replay')::boolean,mode||' '||path||' replay confirmed');
   INSERT INTO unit_compat_cases VALUES(mode,path,oid,k,expected);
  END LOOP;
 END LOOP;
END $sales$;
DO $returns$
DECLARE f record; c record; r jsonb; again jsonb; k uuid; count_before bigint; item uuid; lines jsonb; tenders jsonb;
BEGIN
 SELECT * INTO f FROM unit_compat_fixture;
 FOR c IN SELECT * FROM unit_compat_cases LOOP
  k:=gen_random_uuid();
  IF c.path='complete' THEN
   r:=void_order_rpc_v13(c.order_id,'Unit compatibility void',f.profile_id,f.auth_id,k);
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(quantity) FROM stock_movements WHERE reference_id=c.order_id AND movement_type='sale_void'),c.consumed,c.mode||' void restores original calculation');
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(quantity) FROM stock_movements WHERE reference_id=c.order_id),0::numeric,c.mode||' void nets zero');
   SELECT count(*) INTO count_before FROM stock_movements WHERE reference_id=c.order_id;
   again:=void_order_rpc_v13(c.order_id,'Unit compatibility void',f.profile_id,f.auth_id,k);
   INSERT INTO unit_compat_tap SELECT ok((again->>'idempotent_replay')::boolean AND (SELECT count(*) FROM stock_movements WHERE reference_id=c.order_id)=count_before,c.mode||' void replay no movements');
  ELSIF c.path='b2b' THEN
   r:=cancel_b2b_order_v3(c.order_id,'Unit compatibility cancel',k);
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(quantity) FROM stock_movements WHERE reference_id=c.order_id AND movement_type='sale_void'),c.consumed,c.mode||' B2B cancellation restores original calculation');
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(quantity) FROM stock_movements WHERE reference_id=c.order_id),0::numeric,c.mode||' B2B cancellation nets zero');
   SELECT count(*) INTO count_before FROM stock_movements WHERE reference_id=c.order_id;
   again:=cancel_b2b_order_v3(c.order_id,'Unit compatibility cancel',k);
   INSERT INTO unit_compat_tap SELECT ok((again->>'idempotent_replay')::boolean AND (SELECT count(*) FROM stock_movements WHERE reference_id=c.order_id)=count_before,c.mode||' B2B cancellation replay no movements');
  ELSE
   SELECT id INTO item FROM order_items WHERE order_id=c.order_id;
   lines:=jsonb_build_array(jsonb_build_object('order_item_id',item,'qty',2));
   tenders:=jsonb_build_array(jsonb_build_object('method','cash','amount',4000));
   r:=refund_order_rpc_v14(c.order_id,lines,tenders,'Unit compatibility partial',f.profile_id,k,f.auth_id);
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(quantity) FROM stock_movements WHERE reference_id=(r->>'refund_id')::uuid),c.consumed/2,c.mode||' partial refund retains original calculation');
   INSERT INTO unit_compat_tap SELECT throws_like(format('SELECT void_order_rpc_v13(%L,%L,%L,%L)',c.order_id,'Unit compatibility refused void',f.profile_id,f.auth_id),'Cannot void order%partial refund%',c.mode||' void after partial remains refused');
   SELECT count(*) INTO count_before FROM stock_movements WHERE reference_id=(r->>'refund_id')::uuid;
   again:=refund_order_rpc_v14(c.order_id,lines,tenders,'Unit compatibility partial',f.profile_id,k,f.auth_id);
   INSERT INTO unit_compat_tap SELECT ok(again->>'refund_id'=r->>'refund_id' AND (SELECT count(*) FROM stock_movements WHERE reference_id=(r->>'refund_id')::uuid)=count_before,c.mode||' partial refund replay no movements');
   again:=refund_order_rpc_v14(c.order_id,lines,tenders,'Unit compatibility remainder',f.profile_id,gen_random_uuid(),f.auth_id);
   INSERT INTO unit_compat_tap SELECT is((SELECT sum(s.quantity) FROM stock_movements s WHERE s.reference_id=c.order_id OR s.reference_id IN(SELECT id FROM refunds WHERE order_id=c.order_id)),0::numeric,c.mode||' final refund nets zero');
  END IF;
 END LOOP;
END $returns$;
DO $client_revision$
DECLARE target uuid; after_revision smallint; changed_rows bigint:=0; denied boolean:=false;
BEGIN
 SELECT order_id INTO target FROM unit_compat_cases WHERE mode='new' AND path='complete';
 BEGIN
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET recipe_consumption_revision=NULL WHERE id=target;
  GET DIAGNOSTICS changed_rows=ROW_COUNT;
  RESET ROLE;
 EXCEPTION WHEN insufficient_privilege THEN
  RESET ROLE;
  denied:=true;
 END;
 SELECT recipe_consumption_revision INTO after_revision FROM public.orders WHERE id=target;
 INSERT INTO unit_compat_tap SELECT ok((denied OR changed_rows=0) AND after_revision=2,'client cannot change sale calculation revision');
END $client_revision$;
INSERT INTO unit_compat_tap SELECT throws_ok($q$SELECT * FROM _resolve_order_recipe_restoration_v1(gen_random_uuid(),gen_random_uuid(),1)$q$,'P0002','order_not_found','restoration requires original order');
INSERT INTO unit_compat_tap SELECT throws_ok($q$UPDATE orders SET recipe_consumption_revision=3 WHERE id=(SELECT order_id FROM unit_compat_cases LIMIT 1)$q$,'23514',NULL,'unknown revisions refused');
INSERT INTO unit_compat_tap SELECT ok((SELECT count(*)=8 AND bool_and(NOT has_function_privilege('authenticated',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('service_role',p.oid,'EXECUTE')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('_resolve_recipe_consumption_v2','_resolve_recipe_consumption_legacy_v1','_resolve_order_recipe_restoration_v1','_record_order_item_waste_v2','refund_order_rpc_v14','void_order_rpc_v13','cancel_order_item_rpc_v7','cancel_unpaid_order_v2')),'internal and reversal functions retain service-only ACL');
DO $failed_consumption$
DECLARE f record; k uuid:=gen_random_uuid(); before_count bigint; failed boolean:=false;
BEGIN
 SELECT * INTO f FROM unit_compat_fixture;
 SELECT count(*) INTO before_count FROM stock_movements WHERE product_id=f.material;
 UPDATE products SET current_stock=0 WHERE id=f.material;
 BEGIN
  PERFORM complete_order_with_payment_v30(p_session_id:=f.session_id,p_order_type:='take_out',p_items:=jsonb_build_array(jsonb_build_object('product_id',f.root,'quantity',4,'unit_price',2000)),p_payment:='{"method":"cash","amount":8000,"cash_received":8000}',p_idempotency_key:=k);
 EXCEPTION WHEN OTHERS THEN failed:=SQLSTATE='P0002' AND (lower(SQLERRM) LIKE '%insufficient stock%' OR lower(SQLERRM) LIKE '%insufficient_stock%'); END;
 INSERT INTO unit_compat_tap SELECT ok(failed AND NOT EXISTS(SELECT 1 FROM orders WHERE idempotency_key=k),'failed consumption leaves no order or marker');
 INSERT INTO unit_compat_tap SELECT is((SELECT count(*) FROM stock_movements WHERE product_id=f.material),before_count,'failed consumption leaves no movement');
 UPDATE products SET current_stock=100 WHERE id=f.material;
END $failed_consumption$;
CREATE FUNCTION pg_temp.reject_unit_compat_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action='order.complete' AND NEW.actor_id=(SELECT profile_id FROM unit_compat_fixture) THEN RAISE EXCEPTION 'compatibility_after_consumption'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER test_reject_unit_compat_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_unit_compat_audit();
DO $failed_after_consumption$
DECLARE f record; k uuid:=gen_random_uuid(); before_count bigint; failed boolean:=false;
BEGIN
 SELECT * INTO f FROM unit_compat_fixture;
 SELECT count(*) INTO before_count FROM stock_movements WHERE product_id=f.material;
 BEGIN
  PERFORM complete_order_with_payment_v30(p_session_id:=f.session_id,p_order_type:='take_out',p_items:=jsonb_build_array(jsonb_build_object('product_id',f.root,'quantity',4,'unit_price',2000)),p_payment:='{"method":"cash","amount":8000,"cash_received":8000}',p_idempotency_key:=k);
 EXCEPTION WHEN OTHERS THEN failed:=SQLERRM='compatibility_after_consumption'; END;
 INSERT INTO unit_compat_tap SELECT ok(failed AND NOT EXISTS(SELECT 1 FROM orders WHERE idempotency_key=k),'failure after consumption rolls back order and revision');
 INSERT INTO unit_compat_tap SELECT is((SELECT count(*) FROM stock_movements WHERE product_id=f.material),before_count,'failure after consumption rolls back movements');
END $failed_after_consumption$;
DROP TRIGGER test_reject_unit_compat_audit ON public.audit_logs;
SET CONSTRAINTS ALL IMMEDIATE;
INSERT INTO unit_compat_tap SELECT ok(NOT EXISTS(SELECT 1 FROM journal_entries j WHERE (j.reference_id IN(SELECT order_id FROM unit_compat_cases) OR j.reference_id IN(SELECT r.id FROM refunds r JOIN unit_compat_cases c ON c.order_id=r.order_id)) AND j.total_debit<>j.total_credit),'all scenario journals remain balanced');
INSERT INTO unit_compat_tap SELECT * FROM finish();
SELECT line FROM unit_compat_tap;
ROLLBACK;
