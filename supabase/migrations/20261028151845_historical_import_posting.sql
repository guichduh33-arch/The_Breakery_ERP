-- Emetteur dedie : la vente cree la creance, le reglement ne recree aucun revenu.
CREATE FUNCTION public._historical_import_je_v1(p_reference_type text,p_reference_id uuid,p_date date,p_description text,p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_run uuid:=_historical_import_context_v1(); v_actor uuid; v_je uuid; v_line jsonb; v_dr numeric; v_cr numeric;
BEGIN
 IF v_run IS NULL THEN RAISE EXCEPTION 'historical_import_context_required' USING ERRCODE='P0003'; END IF;
 SELECT actor_id INTO v_actor FROM historical_import_runs WHERE id=v_run;
 SELECT sum((l->>'debit')::numeric),sum((l->>'credit')::numeric) INTO v_dr,v_cr FROM jsonb_array_elements(p_lines) l;
 IF v_dr IS NULL OR v_dr<>v_cr OR v_dr<0 THEN RAISE EXCEPTION 'historical_journal_unbalanced' USING ERRCODE='P0002'; END IF;
 IF v_dr=0 THEN RETURN NULL; END IF;
 PERFORM check_fiscal_period_open(p_date);
 INSERT INTO journal_entries(entry_number,entry_date,description,reference_type,reference_id,status,total_debit,total_credit,created_by,metadata)
 VALUES(next_journal_entry_number(p_date),p_date,p_description,p_reference_type,p_reference_id,'posted',v_dr,v_cr,v_actor,
  jsonb_build_object('financial_import_run_id',v_run,'source_date_precision','day')) RETURNING id INTO v_je;
 FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  IF (v_line->>'debit')::numeric=0 AND (v_line->>'credit')::numeric=0 THEN CONTINUE; END IF;
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=(v_line->>'account_id')::uuid AND is_active AND is_postable AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'historical_account_unavailable' USING ERRCODE='P0002';
  END IF;
  INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description)
  VALUES(v_je,(v_line->>'account_id')::uuid,(v_line->>'debit')::numeric,(v_line->>'credit')::numeric,p_description);
 END LOOP;
 RETURN v_je;
END $$;

CREATE FUNCTION public._historical_import_document_v1(p_run uuid,p_source jsonb,p_plan jsonb,p_accounts jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_run historical_import_runs%ROWTYPE; v_doc uuid; v_entity uuid:=gen_random_uuid(); v_grn uuid;
 v_date date:=(p_source->>'document_date')::date; v_receipt date:=(p_plan->>'receipt_date')::date;
 v_effective_at timestamptz:=(p_plan->>'effective_at')::timestamptz;
 v_total numeric:=(p_source->>'total_amount')::numeric; v_tax numeric:=(p_source->>'tax_amount')::numeric;
 v_line jsonb; v_product products%ROWTYPE; v_qty numeric; v_number text; v_corporate boolean;
BEGIN
 IF p_run IS DISTINCT FROM _historical_import_context_v1() THEN RAISE EXCEPTION 'historical_import_context_required' USING ERRCODE='P0003'; END IF;
 SELECT * INTO v_run FROM historical_import_runs WHERE id=p_run;
 SELECT id INTO v_doc FROM historical_import_documents WHERE source_system=v_run.source_system
  AND kind=v_run.kind AND source_reference=p_source->>'source_reference';
 IF FOUND THEN RETURN v_doc; END IF;
 INSERT INTO historical_import_documents(run_id,source_system,kind,source_reference,source_hash,source_payload,entity_id,
  document_date,effective_at,time_precision,receipt_date,counterparty_id,account_id,total_amount)
 VALUES(p_run,v_run.source_system,v_run.kind,p_source->>'source_reference',_historical_import_hash_v1(p_source),p_source,v_entity,
  v_date,v_effective_at,p_plan->>'time_precision',v_receipt,(p_plan->>'counterparty_id')::uuid,(p_plan->>'account_id')::uuid,v_total) RETURNING id INTO v_doc;
 v_number:='HI'||replace(v_entity::text,'-','');
 IF v_run.kind='sales' THEN
  v_corporate:=p_source->>'customer_treatment'='corporate';
  INSERT INTO orders(id,order_number,invoice_number,order_type,status,subtotal,tax_amount,total,discount_amount,
   customer_id,served_by,created_via,created_at,paid_at,is_historical_import,import_reference,financial_import_document_id,recipe_consumption_revision,
   b2b_delivered_at)
  VALUES(v_entity,v_number,CASE WHEN v_corporate THEN p_source->>'source_reference' END,
   CASE WHEN v_corporate THEN 'b2b'::order_type ELSE 'dine_in'::order_type END,
   CASE WHEN v_corporate THEN 'b2b_pending'::order_status ELSE 'pending_payment'::order_status END,
   (SELECT sum((l->>'line_total')::numeric) FROM jsonb_array_elements(p_source->'lines') l),v_tax,v_total,
   (p_source->>'discount_amount')::numeric,(p_plan->>'counterparty_id')::uuid,NULL,'import',v_effective_at,NULL,
   false,v_run.source_system||':'||(p_source->>'source_reference'),v_doc,2,NULL);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_source->'lines') LOOP
   SELECT * INTO STRICT v_product FROM products WHERE id=(v_line->>'product_id')::uuid;
   v_qty:=(v_line->>'quantity')::numeric;
   INSERT INTO order_items(order_id,product_id,name_snapshot,unit_price,quantity,line_total,created_at,
    modifiers,modifiers_total,kitchen_status,is_locked,served_at,client_line_id)
   VALUES(v_entity,v_product.id,coalesce(nullif(v_line->>'name_snapshot',''),v_product.name),(v_line->>'unit_price')::numeric,
    v_qty,(v_line->>'line_total')::numeric,v_effective_at,
    (SELECT coalesce(jsonb_agg(jsonb_build_object('modifier_id',m.id,'group_name',m.group_name,'option_label',m.option_label) ORDER BY m.id),'[]')
      FROM product_modifiers m WHERE to_jsonb(m.id::text) IN (SELECT value FROM jsonb_array_elements(coalesce(v_line->'modifier_ids','[]')))),
    coalesce((v_line->>'addon_amount')::numeric,0),'served',true,NULL,v_line->>'source_reference');
  END LOOP;
  PERFORM _historical_import_je_v1(CASE WHEN v_corporate THEN 'b2b_order' ELSE 'pos_outstanding' END,v_entity,v_date,
   'Historical sale: '||(p_source->>'source_reference'),jsonb_build_array(
    jsonb_build_object('account_id',p_plan->>'account_id','debit',v_total,'credit',0),
    jsonb_build_object('account_id',p_accounts->>CASE WHEN v_corporate THEN 'b2b_revenue' ELSE 'revenue' END,'debit',0,'credit',v_total-v_tax),
    jsonb_build_object('account_id',p_accounts->>'tax','debit',0,'credit',v_tax)));
  IF v_corporate THEN
   UPDATE customers SET b2b_current_balance=coalesce(b2b_current_balance,0)+v_total WHERE id=(p_plan->>'counterparty_id')::uuid;
  END IF;
 ELSE
  INSERT INTO purchase_orders(id,po_number,supplier_id,status,payment_terms,subtotal,vat_amount,total_amount,
   order_date,received_date,created_by,received_by,created_at,metadata,is_historical_import,import_reference,financial_import_document_id)
  VALUES(v_entity,v_number,(p_plan->>'counterparty_id')::uuid,'received','credit',(p_source->>'net_amount')::numeric,v_tax,v_total,
   v_date,v_receipt,v_run.actor_id,v_run.actor_id,v_effective_at,
   jsonb_build_object('financial_import_document_id',v_doc,'source_payment_terms',p_source->'payment_terms'),false,
   v_run.source_system||':'||(p_source->>'source_reference'),v_doc);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_source->'lines') LOOP
   SELECT * INTO STRICT v_product FROM products WHERE id=(v_line->>'product_id')::uuid;
   v_qty:=convert_quantity((v_line->>'received_quantity')::numeric,v_line->>'received_unit',v_product.unit);
   INSERT INTO purchase_order_items(po_id,product_id,quantity,received_quantity,unit,unit_cost,unit_factor_to_base,notes,created_at)
   VALUES(v_entity,v_product.id,(v_line->>'quantity')::numeric,(v_line->>'quantity')::numeric,v_line->>'unit',
    (v_line->>'invoice_net_amount')::numeric/(v_line->>'quantity')::numeric,
    v_qty/(v_line->>'quantity')::numeric,'Historical net receipt and acquisition allocation retained in source registry',v_effective_at);
  END LOOP;
  INSERT INTO goods_receipt_notes(grn_number,po_id,received_by,received_date,payment_terms,subtotal,vat_amount,total,metadata,created_at)
  VALUES('HIGRN'||replace(v_entity::text,'-',''),v_entity,v_run.actor_id,v_receipt,'credit',
   (p_source->>'net_amount')::numeric,v_tax,v_total,
   jsonb_build_object('financial_import_document_id',v_doc,'source_lines',p_source->'lines'),v_receipt::timestamptz) RETURNING id INTO v_grn;
  PERFORM _historical_import_je_v1('purchase',v_grn,v_receipt,'Historical purchase: '||(p_source->>'source_reference'),
   jsonb_build_array(jsonb_build_object('account_id',p_accounts->>'inventory','debit',v_total,'credit',0),
    jsonb_build_object('account_id',p_accounts->>'payable','debit',0,'credit',v_total)));
 END IF;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_run.actor_id,'historical_import.document','historical_import_documents',v_doc,
  jsonb_build_object('run_id',p_run,'source_system',v_run.source_system,'source_reference',p_source->>'source_reference'),
  jsonb_build_object('kind',v_run.kind,'source_hash',_historical_import_hash_v1(p_source),'entity_id',v_entity,
   'document_date',v_date,'receipt_date',v_receipt,'total_amount',v_total,'tax_amount',v_tax,
   'stock_basis',CASE WHEN v_run.kind='sales' THEN 'current_v3' ELSE 'source_receipt' END,'stock_basis_is_estimate',v_run.kind='sales'));
 RETURN v_doc;
END $$;

CREATE FUNCTION public._historical_import_payment_v1(p_run uuid,p_source jsonb,p_plan jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_run historical_import_runs%ROWTYPE; v_pay uuid; v_allocation jsonb; v_doc historical_import_documents%ROWTYPE;
 v_date date:=(p_source->>'payment_date')::date; v_amount numeric; v_paid numeric; v_native uuid; v_je uuid; v_type text;
 v_effective_at timestamptz:=(p_plan->>'effective_at')::timestamptz;
BEGIN
 IF p_run IS DISTINCT FROM _historical_import_context_v1() THEN RAISE EXCEPTION 'historical_import_context_required' USING ERRCODE='P0003'; END IF;
 SELECT * INTO v_run FROM historical_import_runs WHERE id=p_run;
 SELECT id INTO v_pay FROM historical_import_payments WHERE source_system=v_run.source_system
  AND kind=v_run.kind AND source_reference=p_source->>'source_reference';
 IF FOUND THEN RETURN v_pay; END IF;
 INSERT INTO historical_import_payments(run_id,source_system,kind,source_reference,source_hash,source_payload,payment_date,effective_at,time_precision,amount,method)
 VALUES(p_run,v_run.source_system,v_run.kind,p_source->>'source_reference',_historical_import_hash_v1(p_source),p_source,v_date,
  v_effective_at,p_plan->>'time_precision',(p_source->>'amount')::numeric,(p_source->>'method')::payment_method) RETURNING id INTO v_pay;
 FOR v_allocation IN SELECT value FROM jsonb_array_elements(p_source->'allocations') LOOP
  SELECT * INTO STRICT v_doc FROM historical_import_documents WHERE source_system=v_run.source_system AND kind=v_run.kind
   AND source_reference=v_allocation->>'document_reference' FOR UPDATE;
  v_amount:=(v_allocation->>'amount')::numeric;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM historical_import_allocations WHERE document_id=v_doc.id;
  IF v_paid+v_amount>v_doc.total_amount THEN RAISE EXCEPTION 'historical_overpayment' USING ERRCODE='P0002'; END IF;
  IF v_run.kind='purchases' THEN
   INSERT INTO purchase_payments(purchase_order_id,amount,method,paid_at,paid_by,reference,idempotency_key,created_at)
   VALUES(v_doc.entity_id,v_amount,p_source->>'method',v_effective_at,v_run.actor_id,p_source->>'source_reference',gen_random_uuid(),now()) RETURNING id INTO v_native;
   v_type:='purchase_payment';
  ELSIF (v_doc.source_payload->>'customer_treatment')='corporate' THEN
   INSERT INTO b2b_payments(payment_number,customer_id,amount,method,reference,paid_at,created_by,idempotency_key,allocation)
   VALUES('HIPAY'||replace(gen_random_uuid()::text,'-',''),v_doc.counterparty_id,v_amount,(p_source->>'method')::payment_method,
    p_source->>'source_reference',v_effective_at,v_run.actor_id,gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('invoice_id',v_doc.entity_id,'amount',v_amount))) RETURNING id INTO v_native;
   INSERT INTO b2b_payment_allocations(payment_id,invoice_id,amount_applied) VALUES(v_native,v_doc.entity_id,v_amount);
   UPDATE customers SET b2b_current_balance=coalesce(b2b_current_balance,0)-v_amount WHERE id=v_doc.counterparty_id;
   v_type:='b2b_payment';
  ELSE
   INSERT INTO order_payments(order_id,method,amount,paid_at,reference)
   VALUES(v_doc.entity_id,(p_source->>'method')::payment_method,v_amount,v_effective_at,p_source->>'source_reference') RETURNING id INTO v_native;
   v_type:='pos_outstanding_payment';
  END IF;
  v_je:=_historical_import_je_v1(v_type,v_native,v_date,'Historical payment: '||(p_source->>'source_reference'),
   CASE WHEN v_run.kind='sales' THEN jsonb_build_array(
    jsonb_build_object('account_id',p_plan->>'account_id','debit',v_amount,'credit',0),
    jsonb_build_object('account_id',v_doc.account_id,'debit',0,'credit',v_amount))
   ELSE jsonb_build_array(jsonb_build_object('account_id',v_doc.account_id,'debit',v_amount,'credit',0),
    jsonb_build_object('account_id',p_plan->>'account_id','debit',0,'credit',v_amount)) END);
  INSERT INTO historical_import_allocations(payment_id,document_id,amount,native_payment_id,journal_entry_id)
  VALUES(v_pay,v_doc.id,v_amount,v_native,v_je);
  IF v_type='b2b_payment' THEN UPDATE b2b_payments SET journal_entry_id=v_je WHERE id=v_native; END IF;
  IF v_run.kind='sales' AND v_paid+v_amount=v_doc.total_amount THEN
   UPDATE orders SET status='paid',paid_at=(SELECT max(p.effective_at) FROM historical_import_allocations a
    JOIN historical_import_payments p ON p.id=a.payment_id WHERE a.document_id=v_doc.id) WHERE id=v_doc.entity_id;
  END IF;
 END LOOP;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_run.actor_id,'historical_import.payment','historical_import_payments',v_pay,
  jsonb_build_object('run_id',p_run,'source_system',v_run.source_system,'source_reference',p_source->>'source_reference'),
  jsonb_build_object('payment_date',v_date,'amount',p_source->'amount','method',p_source->'method','allocations',p_source->'allocations'));
 RETURN v_pay;
END $$;

REVOKE ALL ON FUNCTION public._historical_import_je_v1(text,uuid,date,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_document_v1(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_payment_v1(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
