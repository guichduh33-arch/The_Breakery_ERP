BEGIN;
\ir helpers/b2b_edit.sql
CREATE TEMP TABLE edit_checks(name text, passed boolean);
DO $test$
DECLARE
 v_uid uuid; v_denied uuid; v_customer uuid; v_product uuid; v_other uuid;
 v_order uuid; v_line uuid; v_key uuid := gen_random_uuid(); v_revision timestamptz;
 v_result jsonb; v_request jsonb;
 v_order_number text; v_invoice_number text; v_je_count bigint;
BEGIN
 SELECT auth_user_id INTO STRICT v_uid FROM public.user_profiles WHERE deleted_at IS NULL AND is_active
  AND public.has_permission(auth_user_id,'b2b.read') AND public.has_permission(auth_user_id,'pos.sale.create')
  AND public.has_permission(auth_user_id,'b2b.payment.record') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_uid::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_uid)::text,true);
 INSERT INTO public.customers(name,customer_type,b2b_credit_limit,b2b_current_balance)
  VALUES('B2B edit regression fixture','b2b',NULL,0) RETURNING id INTO v_customer;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
  VALUES('EDIT-'||gen_random_uuid(),'Edit tracked fixture',(SELECT id FROM public.categories LIMIT 1),10000,100,true,false,'pcs') RETURNING id INTO v_product;
 INSERT INTO public.products(sku,name,category_id,retail_price,current_stock,track_inventory,deduct_stock,unit)
  VALUES('EDIT-'||gen_random_uuid(),'Edit untracked fixture',(SELECT id FROM public.categories LIMIT 1),5000,0,false,false,'pcs') RETURNING id INTO v_other;
 v_result := pg_temp.create_b2b_edit_fixture(v_customer,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',2)),
  'Original note',current_date+1,gen_random_uuid());
 v_order := (v_result->>'order_id')::uuid;
 SELECT id INTO STRICT v_line FROM public.order_items WHERE order_id=v_order;
 SELECT updated_at,order_number,invoice_number INTO v_revision,v_order_number,v_invoice_number FROM public.orders WHERE id=v_order;
 v_request := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',3),
  jsonb_build_object('product_id',v_other,'quantity',2));
 v_result := public.edit_b2b_order_v3(v_order,v_request,'Updated note',v_revision,v_key);
 INSERT INTO edit_checks SELECT 'increase and add update total and notes',total=40000 AND subtotal=40000
  AND tax_amount=0 AND notes='Updated note' AND pickup_date=current_date+1 FROM public.orders WHERE id=v_order;
 INSERT INTO edit_checks SELECT 'order and invoice numbers remain unchanged',order_number=v_order_number AND invoice_number=v_invoice_number
  FROM public.orders WHERE id=v_order;
 INSERT INTO edit_checks SELECT 'stock deducted by quantity delta only',current_stock=97 FROM public.products WHERE id=v_product;
 INSERT INTO edit_checks SELECT 'untracked product does not move stock',current_stock=0 FROM public.products WHERE id=v_other;
 INSERT INTO edit_checks SELECT 'AR cache follows new total',b2b_current_balance=40000 FROM public.customers WHERE id=v_customer;
 INSERT INTO edit_checks SELECT 'one balanced delta journal',count(*)=1 AND bool_and(total_debit=20000 AND total_credit=20000)
  FROM public.journal_entries WHERE reference_id=v_order AND metadata->>'movement_type'='b2b_edit:'||v_key::text;
 INSERT INTO edit_checks SELECT 'AR and revenue journal lines have correct signs',sum(l.debit-l.credit)=40000
  FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
  WHERE j.reference_id=v_order AND l.account_id=public.resolve_mapping_account('B2B_AR');
 INSERT INTO edit_checks SELECT 'audit retains old and new note',payload->'before'->>'notes'='Original note'
  AND payload->'after'->>'notes'='Updated note' FROM public.audit_logs WHERE entity_id=v_order AND action='b2b.order.edited';
 SELECT count(*) INTO v_je_count FROM public.journal_entries WHERE reference_id=v_order;
 v_result := public.edit_b2b_order_v3(v_order,v_request,'Updated note',v_revision,v_key);
 INSERT INTO edit_checks VALUES('replay returns original result',v_result->>'idempotent_replay'='true' AND (v_result->>'total')::numeric=40000);
 INSERT INTO edit_checks SELECT 'replay does not duplicate stock or journals',current_stock=97 AND
  (SELECT count(*) FROM public.journal_entries WHERE reference_id=v_order)=v_je_count FROM public.products WHERE id=v_product;
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,v_request,'Different note',v_revision,v_key);
  INSERT INTO edit_checks VALUES('key reuse with different payload rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO edit_checks VALUES('key reuse with different payload rejected',SQLERRM='idempotency_key_conflict'); END;
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,v_request,'stale',v_revision-interval '1 second',gen_random_uuid());
  INSERT INTO edit_checks VALUES('stale editor rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO edit_checks VALUES('stale editor rejected',SQLERRM='order_changed_reload'); END;
 -- Baisse et retrait de ligne : restitution + contrepassation de la différence.
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_request := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',1));
 v_result := public.edit_b2b_order_v3(v_order,v_request,'Reduced',v_revision,gen_random_uuid());
 INSERT INTO edit_checks SELECT 'decrease restores stock and removes omitted product',current_stock=99
  AND (SELECT count(*) FROM public.order_items WHERE order_id=v_order)=1 FROM public.products WHERE id=v_product;
 INSERT INTO edit_checks SELECT 'decrease reconciles AR and GL',b2b_current_balance=10000 AND
  (SELECT sum(l.debit-l.credit) FROM public.journal_entry_lines l JOIN public.journal_entries j ON j.id=l.journal_entry_id
   WHERE j.reference_id=v_order AND l.account_id=public.resolve_mapping_account('B2B_AR'))=10000 FROM public.customers WHERE id=v_customer;
 -- Les tarifs clients ne sont jamais acceptés depuis le payload.
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 v_request := jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',1,'unit_price',1));
 v_result := public.edit_b2b_order_v3(v_order,v_request,'Notes only',v_revision,gen_random_uuid());
 INSERT INTO edit_checks SELECT 'notes-only edit keeps price and adds no stock movement',unit_price=10000 AND line_total=10000
  AND (SELECT count(*) FROM public.journal_entries WHERE reference_id=v_order)=v_je_count+1 FROM public.order_items WHERE id=v_line;
 UPDATE public.customers SET b2b_credit_limit=10000 WHERE id=v_customer;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',2)),
   'Over limit',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('credit limit checked against delta',false);
 EXCEPTION WHEN SQLSTATE 'P0011' THEN INSERT INTO edit_checks VALUES('credit limit checked against delta',SQLERRM='credit_limit_exceeded'); END;
 INSERT INTO edit_checks SELECT 'rejected edit is atomic',total=10000 AND notes='Notes only'
  AND (SELECT current_stock FROM public.products WHERE id=v_product)=99 FROM public.orders WHERE id=v_order;
 UPDATE public.customers SET b2b_credit_limit=NULL WHERE id=v_customer;
 UPDATE public.business_config SET allow_negative_stock=false;
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',200)),
   'Over stock',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('insufficient stock rejected without quantity leak',false);
 EXCEPTION WHEN SQLSTATE 'P0002' THEN INSERT INTO edit_checks VALUES('insufficient stock rejected without quantity leak',SQLERRM='insufficient_stock'); END;
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,'[]','Empty',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('empty order rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO edit_checks VALUES('empty order rejected',true); END;
 PERFORM pg_temp.pay_b2b_edit_fixture(v_customer,1000,'transfer',p_invoice_ids=>ARRAY[v_order],p_idempotency_key=>gen_random_uuid());
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,v_request,'After partial payment',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('partial payment blocks editing',false);
 EXCEPTION WHEN SQLSTATE 'P0011' THEN INSERT INTO edit_checks VALUES('partial payment blocks editing',SQLERRM='order_has_payments'); END;
 -- Le rejeu d'une opération réussie reste disponible même après règlement.
 v_result := public.edit_b2b_order_v3(v_order,
  jsonb_build_array(jsonb_build_object('id',v_line,'product_id',v_product,'quantity',3),jsonb_build_object('product_id',v_other,'quantity',2)),
  'Updated note',(SELECT (request->>'revision')::timestamptz FROM public.b2b_order_edit_keys WHERE idempotency_key=v_key),v_key);
 INSERT INTO edit_checks VALUES('replay survives later payment and edits',v_result->>'idempotent_replay'='true' AND (v_result->>'total')::numeric=40000);
 v_result := pg_temp.create_b2b_edit_fixture(v_customer,jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',1)),NULL,NULL,gen_random_uuid());
 v_order := (v_result->>'order_id')::uuid;
 SELECT updated_at INTO v_revision FROM public.orders WHERE id=v_order;
 SELECT jsonb_agg(jsonb_build_object('id',id,'product_id',product_id,'quantity',quantity)) INTO v_request FROM public.order_items WHERE order_id=v_order;
 PERFORM public.update_b2b_pickup_v2(v_order,NULL,true);
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,v_request,'After delivery',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('collected order blocks editing',false);
 EXCEPTION WHEN SQLSTATE 'P0001' THEN INSERT INTO edit_checks VALUES('collected order blocks editing',SQLERRM='order_not_editable'); END;
 SELECT auth_user_id INTO STRICT v_denied FROM public.user_profiles WHERE deleted_at IS NULL AND is_active
  AND NOT public.has_permission(auth_user_id,'b2b.read') LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',v_denied::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',v_denied)::text,true);
 BEGIN
  PERFORM public.edit_b2b_order_v3(v_order,v_request,'Forbidden',v_revision,gen_random_uuid());
  INSERT INTO edit_checks VALUES('unauthorized edit rejected',false);
 EXCEPTION WHEN SQLSTATE 'P0003' THEN INSERT INTO edit_checks VALUES('unauthorized edit rejected',true); END;
END $test$;
INSERT INTO edit_checks VALUES('anon cannot execute',NOT has_function_privilege('anon','public.edit_b2b_order_v3(uuid,jsonb,text,timestamptz,uuid)','EXECUTE'));
INSERT INTO edit_checks VALUES('authenticated cannot write idempotency ledger',NOT has_table_privilege('authenticated','public.b2b_order_edit_keys','INSERT'));
INSERT INTO edit_checks VALUES('authenticated cannot read saved edit requests',NOT has_table_privilege('authenticated','public.b2b_order_edit_keys','SELECT'));
INSERT INTO edit_checks SELECT 'recovery ledger has the restrictive PIN gate',EXISTS(
 SELECT 1 FROM pg_policy WHERE polrelid='public.b2b_order_edit_keys'::regclass
 AND polname='pin_session_required' AND NOT polpermissive AND polcmd='*'
 AND pg_get_expr(polqual,polrelid) LIKE '%request_has_active_pin_session_v1%');
SELECT plan((SELECT count(*)::integer FROM edit_checks));
SELECT ok(passed,name) FROM edit_checks;
SELECT * FROM finish();
ROLLBACK;
