-- Corps de posting et apply copies depuis pg_get_functiondef sur dev le 2026-10-29.
CREATE OR REPLACE FUNCTION public._historical_import_document_v2(p_run uuid, p_source jsonb, p_plan jsonb, p_accounts jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
   'stock_mode',coalesce(p_source->>'stock_mode','legacy'),
   'stock_deferred',coalesce(p_source->>'stock_mode','legacy')='financial_only',
   'source_options_not_resolved_for_stock',coalesce(p_source->>'stock_mode','legacy')='financial_only',
   'stock_basis',CASE WHEN p_source->>'stock_mode'='financial_only' THEN 'deferred_to_opening_opname' WHEN v_run.kind='sales' THEN 'current_v3' ELSE 'source_receipt' END,'stock_basis_is_estimate',coalesce(p_source->>'stock_mode','legacy')<>'financial_only' AND v_run.kind='sales'));
 RETURN v_doc;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_historical_import_v2(p_payload jsonb, p_preview_hash text, p_client_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_actor uuid:=_historical_import_actor_v1(p_payload->>'kind'); v_existing historical_import_runs%ROWTYPE;
 v_plan jsonb; v_doc jsonb; v_source jsonb; v_payment jsonb; v_effect jsonb; v_run uuid;
 v_document historical_import_documents%ROWTYPE; v_stock historical_import_stock_effects%ROWTYPE;
 v_result jsonb; v_previous_context text:=current_setting('breakery.historical_import_run',true);
BEGIN
 IF p_client_key IS NULL OR coalesce(p_preview_hash,'') !~ '^[a-f0-9]{64}$' THEN
  RAISE EXCEPTION 'preview_and_idempotency_key_required' USING ERRCODE='22023';
 END IF;
 -- Serialise tous les imports ; les mutations normales sont protegees par les verrous de dependances.
 PERFORM pg_advisory_xact_lock(hashtextextended('financial-historical-import',0));
 SELECT * INTO v_existing FROM historical_import_runs WHERE client_key=p_client_key;
 IF FOUND THEN
  IF v_existing.actor_id<>v_actor OR v_existing.payload_hash<>_historical_import_hash_v1(p_payload)
   OR v_existing.preview_hash<>p_preview_hash OR v_existing.status<>'applied' THEN
   RAISE EXCEPTION 'idempotency_payload_conflict' USING ERRCODE='22023';
  END IF;
  RETURN v_existing.result||jsonb_build_object('idempotent_replay',true);
 END IF;
 IF EXISTS(SELECT 1 FROM historical_import_runs WHERE source_system=p_payload->>'source_system'
  AND kind=p_payload->>'kind' AND batch_reference=p_payload->>'batch_reference') THEN
  RAISE EXCEPTION 'historical_batch_reference_conflict' USING ERRCODE='22023';
 END IF;
 -- Le batch s'execute en fenetre controlee. Ce verrou conservateur bloque aussi les phantoms
 -- de recettes/conversions/mappings entre la revalidation et leur consommation.
 LOCK TABLE accounts,accounting_mappings,business_config,customer_categories,customers,display_stock,
  fiscal_periods,product_modifiers,products,recipes,suppliers,unit_conversions,units IN SHARE ROW EXCLUSIVE MODE;
 v_plan:=_historical_import_plan_v2(p_payload);
 IF v_plan->'valid' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'historical_import_not_reconciled' USING ERRCODE='22023',DETAIL=(v_plan->'errors')::text;
 END IF;
 IF v_plan->>'preview_hash'<>p_preview_hash THEN RAISE EXCEPTION 'historical_preview_stale' USING ERRCODE='22023'; END IF;
 INSERT INTO historical_import_runs(client_key,source_system,kind,batch_reference,payload_hash,preview_hash,actor_id,status)
 VALUES(p_client_key,p_payload->>'source_system',p_payload->>'kind',p_payload->>'batch_reference',
  v_plan->>'payload_hash',p_preview_hash,v_actor,'applying') RETURNING id INTO v_run;
 PERFORM set_config('breakery.historical_import_run',v_run::text,true);
 FOR v_doc IN SELECT value FROM jsonb_array_elements(v_plan->'documents') LOOP
  SELECT value INTO STRICT v_source FROM jsonb_array_elements(p_payload->'documents') WHERE value->>'source_reference'=v_doc->>'source_reference';
  PERFORM _historical_import_document_v2(v_run,v_source,v_doc,v_plan->'accounts');
 END LOOP;
 FOR v_effect IN SELECT value FROM jsonb_array_elements(v_plan->'stock_effects') LOOP
  SELECT * INTO STRICT v_document FROM historical_import_documents WHERE source_system=p_payload->>'source_system'
   AND kind=p_payload->>'kind' AND source_reference=v_effect->>'document_reference';
  INSERT INTO historical_import_stock_effects(run_id,document_id,product_id,movement_type,quantity,unit,unit_cost,effective_date,reference_type,reference_id,
   acquisition_amount,unit_cost_representation_delta,source_line_reference,effective_at,time_precision)
  VALUES(v_run,v_document.id,(v_effect->>'product_id')::uuid,(v_effect->>'movement_type')::movement_type,
   (v_effect->>'quantity')::numeric,v_effect->>'unit',(v_effect->>'unit_cost')::numeric,(v_effect->>'effective_date')::date,
   CASE WHEN p_payload->>'kind'='sales' THEN 'orders' ELSE 'purchase_order' END,v_document.entity_id,
   (v_effect->>'acquisition_amount')::numeric,(v_effect->>'unit_cost_representation_delta')::numeric,v_effect->>'source_line_reference',
   CASE WHEN p_payload->>'kind'='sales' THEN v_document.effective_at
    ELSE (v_effect->>'effective_date')::date::timestamp AT TIME ZONE 'Asia/Makassar' END,
   CASE WHEN p_payload->>'kind'='sales' THEN v_document.time_precision ELSE 'day' END);
 END LOOP;
 FOR v_stock IN SELECT * FROM historical_import_stock_effects WHERE run_id=v_run ORDER BY effective_date,document_id,product_id,id LOOP
  IF v_stock.movement_type='sale' THEN
   PERFORM _record_sale_stock_v1(v_stock.product_id,-v_stock.quantity,v_stock.reference_id,v_actor,
    'Historical sale (current V3 recipe estimate)','sale',v_stock.reference_type,v_stock.unit,
    (v_plan->'dependencies'->>'allow_negative_stock')::boolean);
  ELSE
   SELECT * INTO STRICT v_document FROM historical_import_documents WHERE id=v_stock.document_id;
   PERFORM record_stock_movement_v1(p_product_id:=v_stock.product_id,p_movement_type:='purchase',
    p_quantity:=v_stock.quantity,p_reason:='Historical purchase: '||v_document.source_reference,
    p_unit_cost:=v_stock.unit_cost,p_supplier_id:=v_document.counterparty_id,p_idempotency_key:=v_stock.id,p_unit:=v_stock.unit,
    p_metadata:=jsonb_build_object('reference_type',v_stock.reference_type,'reference_id',v_stock.reference_id,
     'financial_import_document_id',v_document.id));
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM historical_import_stock_effects WHERE run_id=v_run AND NOT consumed) THEN
  RAISE EXCEPTION 'historical_stock_effect_not_consumed' USING ERRCODE='P0002';
 END IF;
 IF EXISTS(SELECT 1 FROM historical_import_stock_effects e JOIN products p ON p.id=e.product_id
  WHERE e.run_id=v_run AND e.movement_type='sale' AND p.is_display_item AND e.display_movement_id IS NULL) THEN
  RAISE EXCEPTION 'historical_display_effect_not_consumed' USING ERRCODE='P0002';
 END IF;
 FOR v_payment IN SELECT p.value FROM jsonb_array_elements(v_plan->'payments') p
  ORDER BY (SELECT s.value->>'payment_date' FROM jsonb_array_elements(p_payload->'payments') s
   WHERE s.value->>'source_reference'=p.value->>'source_reference'),p.value->>'source_reference' LOOP
  SELECT value INTO STRICT v_source FROM jsonb_array_elements(p_payload->'payments') WHERE value->>'source_reference'=v_payment->>'source_reference';
  PERFORM _historical_import_payment_v1(v_run,v_source,v_payment);
 END LOOP;
 v_result:=jsonb_build_object('stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred',
  'source_options_not_resolved_for_stock',v_plan->'source_options_not_resolved_for_stock','run_id',v_run,'kind',p_payload->>'kind','batch_reference',p_payload->>'batch_reference',
  'payload_hash',v_plan->>'payload_hash','preview_hash',p_preview_hash,'idempotent_replay',false,
  'documents',(SELECT jsonb_agg(jsonb_build_object('document_id',d.id,'entity_id',d.entity_id,'source_reference',d.source_reference)
   ORDER BY d.source_reference) FROM historical_import_documents d WHERE d.source_system=p_payload->>'source_system'
    AND d.kind=p_payload->>'kind' AND d.source_reference IN (SELECT value->>'source_reference' FROM jsonb_array_elements(p_payload->'documents'))),
  'payments',(SELECT coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'source_reference',p.source_reference) ORDER BY p.source_reference),'[]')
   FROM historical_import_payments p WHERE p.run_id=v_run),
  'stock_effect_count',(SELECT count(*) FROM historical_import_stock_effects WHERE run_id=v_run),
  'stock_basis',v_plan->'stock_basis','stock_basis_is_estimate',v_plan->'stock_basis_is_estimate','recipe_snapshot_at',v_plan->'recipe_snapshot_at',
  'recipe_snapshot',v_plan->'recipe_snapshot','modifier_snapshots',v_plan->'modifier_snapshots',
  'inventory_cost_snapshot',v_plan->'inventory_cost_snapshot','dependencies',v_plan->'dependencies');
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'historical_import.applied','historical_import_runs',v_run,
  jsonb_build_object('source_system',p_payload->>'source_system','batch_reference',p_payload->>'batch_reference'),
  jsonb_build_object('payload_hash',v_plan->>'payload_hash','preview_hash',p_preview_hash,
   'stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred',
   'source_options_not_resolved_for_stock',v_plan->'source_options_not_resolved_for_stock','documents',v_result->'documents','payments',v_result->'payments','stock_effect_count',v_result->'stock_effect_count'));
 UPDATE historical_import_runs SET status='applied',result=v_result WHERE id=v_run;
 PERFORM set_config('breakery.historical_import_run',coalesce(v_previous_context,''),true);
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.preview_historical_import_v2(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 PERFORM _historical_import_actor_v1(p_payload->>'kind');
 RETURN _historical_import_plan_v2(p_payload);
END $function$;

REVOKE ALL ON FUNCTION public._historical_import_document_v2(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apply_historical_import_v2(jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_historical_import_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_historical_import_v2(jsonb,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_historical_import_v2(jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.preview_historical_import_v1(jsonb);
DROP FUNCTION public.apply_historical_import_v1(jsonb,text,uuid);
DROP FUNCTION public._historical_import_document_v1(uuid,jsonb,jsonb,jsonb);
DROP FUNCTION public._historical_import_plan_v1(jsonb);
