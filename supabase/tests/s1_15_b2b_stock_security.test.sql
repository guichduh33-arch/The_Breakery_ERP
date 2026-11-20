-- Écritures directes et créateur sans droit : aucune fuite de disponibilité.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE s115_security(name text,passed boolean);
DO $test$
DECLARE
 a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); denied uuid:=gen_random_uuid();
 c uuid; p uuid; o uuid; r jsonb; changed bigint; refused boolean;
BEGIN
 INSERT INTO auth.users(id) VALUES(u),(denied);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(a,u,'S115-S-'||left(a::text,8),'Stock security owner','SUPER_ADMIN',public.hash_pin('273849'),true),
 (gen_random_uuid(),denied,'S115-D-'||left(denied::text,8),'Stock denied cashier','CASHIER',public.hash_pin('273849'),true);
 PERFORM pg_temp.authenticate_pin(u);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Stock security fixture','b2b',NULL,0) RETURNING id INTO c;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
 VALUES('S115-S-'||gen_random_uuid(),'Pickup security',(SELECT id FROM public.categories LIMIT 1),10000,10,true,false,'pcs') RETURNING id INTO p;
 r:=public.create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)),NULL,NULL,gen_random_uuid());
 o:=(r->>'order_id')::uuid;
 refused:=false; changed:=0;
 BEGIN
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET b2b_delivered_at=now(),b2b_stock_consumed_at=now() WHERE id=o;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;
 EXCEPTION WHEN SQLSTATE 'P0003' OR insufficient_privilege THEN RESET ROLE; refused:=true;
 END;
 INSERT INTO s115_security SELECT 'client cannot simulate pickup',
  (refused OR changed=0) AND b2b_delivered_at IS NULL AND b2b_stock_consumed_at IS NULL FROM public.orders WHERE id=o;
 PERFORM public.update_b2b_pickup_v4(o,NULL,true);
 refused:=false; changed:=0;
 BEGIN
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET b2b_delivered_at=NULL,b2b_stock_consumed_at=NULL WHERE id=o;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RESET ROLE;
 EXCEPTION WHEN SQLSTATE 'P0003' OR insufficient_privilege THEN RESET ROLE; refused:=true;
 END;
 INSERT INTO s115_security SELECT 'client cannot clear consumed marker for a second pickup',
  (refused OR changed=0) AND b2b_delivered_at IS NOT NULL AND b2b_stock_consumed_at IS NOT NULL FROM public.orders WHERE id=o;
 INSERT INTO public.user_permission_overrides(user_profile_id,permission_code,is_granted,reason,granted_by)
 SELECT id,'b2b.order.create',false,'Stock security test',a FROM public.user_profiles WHERE auth_user_id=denied;
 PERFORM pg_temp.authenticate_pin(denied);
 INSERT INTO s115_security VALUES('denied actor has no creation permission',NOT public.has_permission(denied,'b2b.order.create'));
 BEGIN
  PERFORM public.check_b2b_stock_availability_v1(jsonb_build_array(jsonb_build_object('product_id',p,'quantity',1)));
  INSERT INTO s115_security VALUES('availability permission enforced',false);
 EXCEPTION WHEN SQLSTATE 'P0003' THEN INSERT INTO s115_security VALUES('availability permission enforced',true); END;
 BEGIN
  PERFORM public.update_b2b_pickup_v4(o,NULL,true);
  INSERT INTO s115_security VALUES('pickup permission enforced before replay',false);
 EXCEPTION WHEN SQLSTATE 'P0003' THEN INSERT INTO s115_security VALUES('pickup permission enforced before replay',true); END;
END $test$;
INSERT INTO s115_security VALUES('availability is not anonymous',NOT has_function_privilege('anon','public.check_b2b_stock_availability_v1(jsonb)','EXECUTE'));
CREATE TEMP TABLE s115_tap(seq serial,line text);
INSERT INTO s115_tap(line) SELECT plan((SELECT count(*)::integer FROM s115_security));
INSERT INTO s115_tap(line) SELECT ok(passed,name) FROM s115_security;
INSERT INTO s115_tap(line) SELECT * FROM finish();
SELECT line FROM s115_tap ORDER BY seq;
ROLLBACK;
