-- Imports financiers : aucune déduction, reprise ou marque de retrait.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE s115_checks(name text,passed boolean);
DO $test$
DECLARE a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); c uuid; run uuid; doc uuid; other_order uuid;
BEGIN
 INSERT INTO auth.users(id) VALUES(u);
 INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,pin_hash,is_active)
 VALUES(a,u,'S115-I-'||left(a::text,8),'Stock import fixture','SUPER_ADMIN',public.hash_pin('273849'),true);
 PERFORM pg_temp.authenticate_pin(u);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
 VALUES('Stock import fixture','b2b',NULL,0) RETURNING id INTO c;
 -- Import financier : marqueur réel, sans aucune remise en stock fictive.
 run:=gen_random_uuid(); doc:=gen_random_uuid(); other_order:=gen_random_uuid();
 INSERT INTO public.historical_import_runs(id,client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status)
 VALUES(run,gen_random_uuid(),'S115-'||run,'sales','fixture',repeat('a',64),repeat('b',64),a,'applying');
 PERFORM set_config('breakery.historical_import_run',run::text,true);
 INSERT INTO public.historical_import_documents(id,run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
  document_date,effective_at,time_precision,account_id,total_amount)
 VALUES(doc,run,'S115-'||run,'sales','S115-import',repeat('a',64),'{}',other_order,current_date,now(),'day',public.resolve_mapping_account('SALE_B2B_REVENUE'),10000);
 INSERT INTO public.orders(id,order_number,customer_id,order_type,status,total,subtotal,tax_amount,served_by,financial_import_document_id)
 VALUES(other_order,'S115-'||other_order,c,'b2b','b2b_pending',10000,10000,0,a,doc);
 UPDATE public.historical_import_runs SET status='applied' WHERE id=run;
 PERFORM set_config('breakery.historical_import_run','',true);
 BEGIN
  PERFORM public.update_b2b_pickup_v4(other_order,NULL,true);
  INSERT INTO s115_checks VALUES('financial import pickup explicitly refused',false);
 EXCEPTION WHEN SQLSTATE 'P0003' THEN INSERT INTO s115_checks VALUES('financial import pickup explicitly refused',SQLERRM='financial_import_requires_dedicated_workflow'); END;
 INSERT INTO s115_checks SELECT 'financial import is untouched',b2b_delivered_at IS NULL AND b2b_stock_consumed_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.stock_movements WHERE reference_id=other_order) FROM public.orders WHERE id=other_order;

END $test$;
CREATE TEMP TABLE s115_tap(seq serial,line text);
INSERT INTO s115_tap(line) SELECT plan((SELECT count(*)::integer FROM s115_checks));
INSERT INTO s115_tap(line) SELECT ok(passed,name) FROM s115_checks;
INSERT INTO s115_tap(line) SELECT * FROM finish();
SELECT line FROM s115_tap ORDER BY seq;
ROLLBACK;
