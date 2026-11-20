-- Stock au retrait, neutralité création/édition, recettes, replay et annulation.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE s115_checks(name text,passed boolean);
CREATE TEMP TABLE s115_fixture(auth_id uuid,actor uuid,customer uuid,product uuid,recipe uuid,material uuid,semi uuid,order_id uuid);
DO $test$
DECLARE
 a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); c uuid; p uuid; r uuid; m uuid; s uuid;
 o uuid; other_order uuid; line uuid; k uuid; rev timestamptz; delivered timestamptz;
 result jsonb; balance_before numeric;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(a,u,'S115-'||left(a::text,8),'Stock pickup fixture','SUPER_ADMIN',public.hash_pin('273849'),true);
 PERFORM pg_temp.authenticate_pin(u);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Stock pickup fixture','b2b',NULL,0) RETURNING id INTO c;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,cost_price,track_inventory,deduct_stock,is_display_item,unit)
 VALUES('S115-'||gen_random_uuid(),'Pickup tracked',(SELECT id FROM public.categories LIMIT 1),10000,2,1000,true,false,true,'pcs') RETURNING id INTO p;
 UPDATE public.display_stock SET quantity=0 WHERE product_id=p;
 UPDATE public.business_config SET allow_negative_stock=true;
 result:=public.check_b2b_stock_availability_v1(jsonb_build_array(jsonb_build_object('product_id',p,'quantity',4)));
 INSERT INTO s115_checks VALUES('availability returns a boolean without quantities',result='{"available":false}'::jsonb);
 k:=gen_random_uuid();
 result:=public.create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',4,'unit_price',1)),NULL,NULL,k);
 o:=(result->>'order_id')::uuid;
 INSERT INTO s115_checks SELECT 'creation accepts future stock and ignores client price',total=40000 AND tax_amount=0
  AND b2b_stock_consumed_at IS NULL FROM public.orders WHERE id=o;
 INSERT INTO s115_checks SELECT 'creation is stock neutral',current_stock=2
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=o) FROM public.products WHERE id=p;
 result:=public.create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',4)),NULL,NULL,k);
 INSERT INTO s115_checks VALUES('create response lost replay is stock neutral',(result->>'idempotent_replay')::boolean
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=o));
 SELECT id INTO line FROM public.order_items WHERE order_id=o;
 SELECT updated_at INTO rev FROM public.orders WHERE id=o;
 result:=public.edit_b2b_order_v4(o,jsonb_build_array(jsonb_build_object('id',line,'product_id',p,'quantity',6)),NULL,rev,gen_random_uuid());
 INSERT INTO s115_checks SELECT 'edit without stock changes financial amount only',total=60000
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=o) FROM public.orders WHERE id=o;
 PERFORM public.update_b2b_pickup_v4(o,current_date+1,false);
 INSERT INTO s115_checks SELECT 'scheduling does not consume stock',b2b_stock_consumed_at IS NULL
  AND b2b_delivered_at IS NULL FROM public.orders WHERE id=o;
 BEGIN
  PERFORM public.update_b2b_pickup_v4(o,NULL,true);
  INSERT INTO s115_checks VALUES('pickup rejects insufficient stock despite negative flag',false);
 EXCEPTION WHEN SQLSTATE 'P0002' THEN
  INSERT INTO s115_checks VALUES('pickup rejects insufficient stock despite negative flag',SQLERRM='insufficient_stock');
 END;
 INSERT INTO s115_checks SELECT 'failed pickup rolls back marker and snapshot',b2b_delivered_at IS NULL
  AND b2b_stock_consumed_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.b2b_order_stock_consumptions WHERE order_id=o)
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=o) FROM public.orders WHERE id=o;
 UPDATE public.products SET current_stock=10 WHERE id=p;
 INSERT INTO s115_checks VALUES('availability ignores empty vitrine',public.check_b2b_stock_availability_v1(
  jsonb_build_array(jsonb_build_object('product_id',p,'quantity',6)))='{"available":true}'::jsonb);
 balance_before:=(SELECT b2b_current_balance FROM public.customers WHERE id=c);
 PERFORM public.update_b2b_pickup_v4(o,NULL,true);
 delivered:=(SELECT b2b_delivered_at FROM public.orders WHERE id=o);
 INSERT INTO s115_checks SELECT 'pickup consumes exactly once and never pays invoice',current_stock=4
  AND (SELECT status='b2b_pending' AND paid_at IS NULL AND b2b_stock_consumed_at=b2b_delivered_at FROM public.orders WHERE id=o)
  FROM public.products WHERE id=p;
 INSERT INTO s115_checks SELECT 'pickup leaves customer receivable unchanged',b2b_current_balance=balance_before FROM public.customers WHERE id=c;
 INSERT INTO s115_checks SELECT 'COGS is emitted only at pickup',count(*)=1 AND sum(j.total_debit)=6000
  FROM public.stock_movements sm JOIN public.journal_entries j ON j.reference_type='stock_movement' AND j.reference_id=sm.id
  WHERE sm.reference_id=o;
 PERFORM public.update_b2b_pickup_v4(o,NULL,true);
 INSERT INTO s115_checks SELECT 'double pickup preserves timestamp and movement count',b2b_delivered_at=delivered
  AND (SELECT count(*)=1 FROM public.stock_movements WHERE reference_id=o)
  AND (SELECT count(*)=1 FROM public.audit_logs WHERE entity_id=o AND action='b2b.order.delivered') FROM public.orders WHERE id=o;
 INSERT INTO s115_checks SELECT 'vitrine remains empty without display movements',quantity=0
  AND NOT EXISTS(SELECT 1 FROM public.display_movements WHERE reference_id=o) FROM public.display_stock WHERE product_id=p;
 k:=gen_random_uuid();
 PERFORM public.cancel_b2b_order_v5(o,'Collected cancellation',k);
 INSERT INTO s115_checks SELECT 'collected cancellation restores actual stock',current_stock=10
  AND (SELECT sum(quantity)=0 FROM public.stock_movements WHERE reference_id=o) FROM public.products WHERE id=p;
 result:=public.cancel_b2b_order_v5(o,'Collected cancellation',k);
 INSERT INTO s115_checks VALUES('cancel replay never restores twice',(result->>'idempotent_replay')::boolean
  AND (SELECT count(*)=2 FROM public.stock_movements WHERE reference_id=o));
 result:=public.create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',p,'quantity',20)),NULL,NULL,gen_random_uuid());
 other_order:=(result->>'order_id')::uuid;
 PERFORM public.cancel_b2b_order_v5(other_order,'Uncollected cancellation',gen_random_uuid());
 INSERT INTO s115_checks SELECT 'uncollected cancellation has no stock restoration',current_stock=10
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=other_order) FROM public.products WHERE id=p;

 -- Ingrédient commun à une recette et à une ligne vendue directement ; arrêt sur
 -- le semi-fini suivi, sans reconsommer la matière de sa propre recette.
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,cost_price,track_inventory,deduct_stock,unit)
 VALUES('S115-'||gen_random_uuid(),'Pickup raw kg',(SELECT id FROM public.categories LIMIT 1),10000,10,1000,true,false,'kg') RETURNING id INTO m;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,cost_price,track_inventory,deduct_stock,is_display_item,unit)
 VALUES('S115-'||gen_random_uuid(),'Pickup semi',(SELECT id FROM public.categories LIMIT 1),10000,5,1000,true,true,true,'pcs') RETURNING id INTO s;
 UPDATE public.display_stock SET quantity=0 WHERE product_id=s;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
 VALUES('S115-'||gen_random_uuid(),'Pickup recipe',(SELECT id FROM public.categories LIMIT 1),10000,0,false,true,'pcs') RETURNING id INTO r;
 INSERT INTO public.recipes(product_id,material_id,quantity,unit) VALUES(s,m,100,'g'),(r,s,2,'pcs'),(r,m,50,'g');
 result:=public.create_b2b_order_v11(c,jsonb_build_array(jsonb_build_object('product_id',r,'quantity',2),
  jsonb_build_object('product_id',s,'quantity',1),jsonb_build_object('product_id',m,'quantity',1)),NULL,NULL,gen_random_uuid());
 o:=(result->>'order_id')::uuid;
 INSERT INTO s115_checks VALUES('recipe creation remains stock neutral',
  (SELECT current_stock=5 FROM public.products WHERE id=s) AND (SELECT current_stock=10 FROM public.products WHERE id=m));
 INSERT INTO s115_checks VALUES('availability aggregates shared direct and recipe requirements',public.check_b2b_stock_availability_v1(
  jsonb_build_array(jsonb_build_object('product_id',r,'quantity',2),jsonb_build_object('product_id',s,'quantity',2),
   jsonb_build_object('product_id',m,'quantity',1)))='{"available":false}'::jsonb);
 PERFORM public.update_b2b_pickup_v4(o,NULL,true);
 INSERT INTO s115_checks VALUES('shared lines aggregate and tracked semi stops cascade',
  (SELECT current_stock=0 FROM public.products WHERE id=s) AND (SELECT current_stock=8.9 FROM public.products WHERE id=m));
 INSERT INTO s115_checks SELECT 'snapshot contains only actual base-unit consumption',count(*)=2 AND sum(quantity)=6.1
  FROM public.b2b_order_stock_consumptions WHERE order_id=o;
 UPDATE public.recipes SET quantity=999 WHERE product_id=r;
 PERFORM public.cancel_b2b_order_v5(o,'Recipe changed after pickup',gen_random_uuid());
 INSERT INTO s115_checks VALUES('cancel uses snapshot despite changed recipe',
  (SELECT current_stock=5 FROM public.products WHERE id=s) AND (SELECT current_stock=10 FROM public.products WHERE id=m));
 INSERT INTO s115_checks SELECT 'recipe sale and return never touch vitrine',quantity=0
  AND NOT EXISTS(SELECT 1 FROM public.display_movements WHERE product_id=s) FROM public.display_stock WHERE product_id=s;
 INSERT INTO s115_checks SELECT 'audits use profile id',bool_and(actor_id=a)
  FROM public.audit_logs WHERE entity_id IN(o,other_order) AND action LIKE 'b2b.%';

 INSERT INTO s115_fixture VALUES(u,a,c,p,r,m,s,o);
END $test$;
INSERT INTO s115_checks VALUES('anonymous pickup denied',NOT has_function_privilege('anon','public.update_b2b_pickup_v4(uuid,date,boolean)','EXECUTE'));
INSERT INTO s115_checks VALUES('snapshot has no direct client privileges',NOT has_table_privilege('authenticated','public.b2b_order_stock_consumptions','SELECT,INSERT,UPDATE,DELETE'));
INSERT INTO s115_checks VALUES('snapshot has restrictive PIN policy',EXISTS(SELECT 1 FROM pg_policy
 WHERE polrelid='public.b2b_order_stock_consumptions'::regclass AND polname='pin_session_required' AND NOT polpermissive));
CREATE TEMP TABLE s115_tap(seq serial,line text);
INSERT INTO s115_tap(line) SELECT plan((SELECT count(*)::integer FROM s115_checks));
INSERT INTO s115_tap(line) SELECT ok(passed,name) FROM s115_checks;
INSERT INTO s115_tap(line) SELECT * FROM finish();
SELECT line FROM s115_tap ORDER BY seq;
ROLLBACK;
