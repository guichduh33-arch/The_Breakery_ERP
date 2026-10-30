CREATE OR REPLACE FUNCTION public._historical_import_plan_v4(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_financial boolean:=p_payload->>'stock_mode'='financial_only';
 v_mode text:=coalesce(p_payload->>'stock_mode','legacy');
 v_errors jsonb:=_historical_import_envelope_errors_v1(p_payload); v_kind text:=p_payload->>'kind';
 v_doc jsonb; v_line jsonb; v_payment jsonb; v_allocation jsonb; v_stock jsonb:='[]';
 v_docs jsonb:='[]'; v_pays jsonb:='[]'; v_accounts jsonb:='{}'; v_existing historical_import_documents%ROWTYPE;
 v_old_payment historical_import_payments%ROWTYPE; v_product products%ROWTYPE; v_customer customers%ROWTYPE;
 v_account uuid; v_counterparty uuid; v_ref text; v_path text; v_date date; v_receipt date; v_effective_at timestamptz;
 v_qty numeric; v_cost numeric; v_acquisition numeric; v_sum numeric; v_invoice_sum numeric; v_amount numeric; v_old_paid numeric;
 v_cons record; v_need record; v_allow_negative boolean; v_snapshot jsonb; v_result jsonb;
 v_customer_advance boolean; v_advance_count integer:=0; v_advance_amount numeric:=0;
 v_application_date date;
 v_prepayments integer:=0;
 v_is_prepayment boolean;
 v_modifier_plan jsonb; v_modifier_effect jsonb; v_modifier_snapshots jsonb:='[]';
BEGIN
 IF v_mode NOT IN ('legacy','financial_only') THEN
  v_errors:=v_errors||jsonb_build_object('path','stock_mode','code','invalid_stock_mode');
 END IF;
 IF jsonb_typeof(p_payload->'documents')='array' THEN
  FOR v_doc IN SELECT value FROM jsonb_array_elements(p_payload->'documents') LOOP
   IF (v_mode='financial_only' AND v_doc->>'stock_mode' IS DISTINCT FROM v_mode)
    OR (v_mode='legacy' AND coalesce(v_doc->>'stock_mode','legacy')<>v_mode) THEN
    v_errors:=v_errors||jsonb_build_object('path',v_doc->>'source_reference','code','document_stock_mode_mismatch');
   END IF;
  END LOOP;
 END IF;
 IF v_errors<>'[]'::jsonb THEN RETURN jsonb_build_object('valid',false,'errors',v_errors); END IF;
 SELECT allow_negative_stock INTO v_allow_negative FROM business_config WHERE id=1;
 IF v_allow_negative IS NULL THEN
  v_errors:=v_errors||jsonb_build_object('code','business_config_required');
 END IF;
 BEGIN
  v_accounts:=jsonb_build_object('tax',resolve_mapping_account('SALE_PB1_TAX'), 'revenue',resolve_mapping_account('SALE_POS_REVENUE'),'b2b_revenue',resolve_mapping_account('SALE_B2B_REVENUE'), 'inventory',resolve_mapping_account('INVENTORY_GENERAL'),'payable',resolve_mapping_account('PURCHASE_PAYABLE'));
 EXCEPTION WHEN SQLSTATE 'P0002' THEN v_errors:=v_errors||jsonb_build_object('code','account_mapping_missing'); END;
 FOR v_doc IN SELECT value FROM jsonb_array_elements(p_payload->'documents') LOOP
  v_ref:=v_doc->>'source_reference'; v_path:='documents.'||v_ref;
  v_date:=(v_doc->>'document_date')::date; v_receipt:=NULL; v_counterparty:=NULL; v_account:=NULL;
  v_effective_at:=_historical_import_timestamp_v1(v_doc->'document_timestamp',v_date,v_doc->>'document_time_precision');
  IF v_effective_at IS NULL THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_document_timestamp_precision'); END IF;
  SELECT * INTO v_existing FROM historical_import_documents WHERE source_system=p_payload->>'source_system'
   AND kind=v_kind AND source_reference=v_ref;
  IF FOUND AND v_existing.source_hash<>_historical_import_hash_v1(v_doc) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','document_source_conflict');
  END IF;
  IF v_existing.id IS NULL THEN
   BEGIN PERFORM check_fiscal_period_open(v_date);
   EXCEPTION WHEN SQLSTATE 'P0004' THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','fiscal_period_closed_or_missing'); END;
  END IF;
  IF v_kind='sales' THEN
   IF v_doc->>'customer_treatment' IS NULL OR v_doc->>'customer_treatment' NOT IN ('retail','staff','corporate') THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_treatment_required');
   END IF;
   IF v_doc->>'customer_id' IS NOT NULL THEN
    IF (v_doc->>'customer_id') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
     v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_customer');
    ELSE
     v_counterparty:=(v_doc->>'customer_id')::uuid;
     SELECT * INTO v_customer FROM customers WHERE id=v_counterparty AND deleted_at IS NULL;
     IF NOT FOUND THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_not_found');
     ELSIF EXISTS(SELECT 1 FROM customer_categories WHERE id=v_customer.category_id AND (slug IN ('owner','mamat','owner-mamat') OR name ILIKE '%mamat%')) THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','owner_accounting_pending');
     ELSIF v_doc->>'customer_treatment'='corporate' AND v_customer.customer_type<>'b2b' THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','corporate_customer_not_b2b');
     ELSIF v_doc->>'customer_treatment'<>'corporate' AND v_customer.customer_type='b2b' THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','b2b_customer_treatment_mismatch');
     END IF;
    END IF;
   ELSIF v_doc->>'customer_treatment' IN ('staff','corporate') THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_required');
   END IF;
   SELECT id INTO v_account FROM accounts WHERE code=CASE WHEN v_doc->>'customer_treatment'='corporate' THEN '1132' ELSE '1131' END
    AND is_active AND is_postable AND deleted_at IS NULL;
  ELSE
   IF coalesce(v_doc->>'supplier_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_supplier');
   ELSE
    v_counterparty:=(v_doc->>'supplier_id')::uuid;
    IF NOT EXISTS(SELECT 1 FROM suppliers WHERE id=v_counterparty AND is_active AND deleted_at IS NULL) THEN
     v_errors:=v_errors||jsonb_build_object('path',v_path,'code','supplier_not_found');
    END IF;
   END IF;
   v_receipt:=_historical_import_date_v1(v_doc->'receipt_date');
   IF v_receipt IS NULL OR v_receipt<v_date OR v_receipt NOT BETWEEN (p_payload->>'period_start')::date AND (p_payload->>'period_end')::date THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','receipt_date_required');
   ELSIF v_existing.id IS NULL THEN
    BEGIN PERFORM check_fiscal_period_open(v_receipt);
    EXCEPTION WHEN SQLSTATE 'P0004' THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','receipt_period_closed_or_missing'); END;
   END IF;
   v_account:=(v_accounts->>'payable')::uuid;
   IF (v_doc->>'discount_amount')::numeric<>0 OR coalesce((v_doc->>'rounding_amount')::numeric,0)<>0 THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','purchase_cost_allocation_required');
   END IF;
  END IF;
  IF v_account IS NULL THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','receivable_or_payable_account_missing'); END IF;
  v_docs:=v_docs||jsonb_build_object('source_reference',v_ref,'existing_id',v_existing.id,'entity_id',v_existing.entity_id, 'source_hash',_historical_import_hash_v1(v_doc),'account_id',v_account,'counterparty_id',v_counterparty, 'document_date',v_date,'effective_at',v_effective_at,'time_precision',coalesce(v_doc->>'document_time_precision','day'), 'receipt_date',v_receipt,'total_amount',(v_doc->>'total_amount')::numeric);
  IF v_existing.id IS NOT NULL THEN CONTINUE; END IF;
  IF NOT coalesce(v_financial,false) AND (v_doc->'stock_reconciled' IS DISTINCT FROM 'true'::jsonb OR v_doc->>'stock_basis' IS DISTINCT FROM (CASE WHEN v_kind='sales' THEN 'current_v3' ELSE 'source_receipt' END)) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','stock_basis_reconciliation_required');
  END IF;
  v_sum:=0; v_invoice_sum:=0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_doc->'lines') LOOP
   SELECT * INTO v_product FROM products WHERE id=(v_line->>'product_id')::uuid AND deleted_at IS NULL;
   IF NOT FOUND THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','product_not_found'); CONTINUE; END IF;
   IF NOT coalesce(v_financial,false) AND (v_product.product_type='combo' OR EXISTS(SELECT 1 FROM products WHERE parent_product_id=v_product.id AND deleted_at IS NULL)) THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','product_choices_not_represented'); CONTINUE;
   END IF;
   BEGIN
    IF v_kind='sales' THEN
     v_qty:=CASE WHEN v_financial THEN (v_line->>'quantity')::numeric
      ELSE convert_quantity((v_line->>'quantity')::numeric,v_line->>'unit',v_product.unit) END;
     IF v_qty IS NULL OR v_qty<=0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='P0002'; END IF;
     IF (v_line->>'quantity')::numeric<>round((v_line->>'quantity')::numeric,3)
      OR (v_line->>'quantity')::numeric>=1e7 OR (v_line->>'line_total')::numeric>=1e10 THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','sale_line_not_representable');
     END IF;
     IF _historical_import_number_v1(v_line->'unit_price') IS NULL OR _historical_import_number_v1(coalesce(v_line->'addon_amount','0')) IS NULL THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','source_unit_price_required');
      CONTINUE;
     END IF;
     IF (v_line->>'unit_price')::numeric>=1e10 OR coalesce((v_line->>'addon_amount')::numeric,0)>=1e10 THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','sale_price_not_representable');
      CONTINUE;
     END IF;
     IF v_financial THEN
      v_modifier_plan:=_historical_import_financial_choices_v1(v_product.id,v_line->'modifier_ids',v_line->'addon_modifier_ids');
     ELSE
      v_modifier_plan:=_historical_import_modifier_plan_v1(v_product.id,(v_line->>'quantity')::numeric,v_line->'modifier_ids',coalesce((v_line->>'addon_amount')::numeric,0),
      v_line->'addon_modifier_ids',v_line->'addon_identity_reconciled'='true'::jsonb);
     END IF;
     v_errors:=v_errors||(v_modifier_plan->'errors');
     v_modifier_snapshots:=v_modifier_snapshots||jsonb_build_object('document_reference',v_ref,'line_reference',v_line->>'source_reference', 'snapshot',v_modifier_plan->'modifier_snapshot');
     FOR v_modifier_effect IN SELECT value FROM jsonb_array_elements(v_modifier_plan->'effects') LOOP
      v_stock:=v_stock||(v_modifier_effect||jsonb_build_object('document_reference',v_ref,'effective_date',v_date));
     END LOOP;
     IF v_financial THEN
      NULL; -- Le stock historique sera initialise par un opname distinct.
     ELSIF v_product.track_inventory OR v_product.is_display_item THEN
      v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_product.id,'quantity',-v_qty, 'unit',v_product.unit,'unit_cost',NULL,'movement_type','sale','effective_date',v_date);
     ELSIF v_product.deduct_stock THEN
      IF EXISTS(WITH RECURSIVE walk AS (
       SELECT r.material_id id,1 depth,ARRAY[v_product.id,r.material_id] path,r.material_id=v_product.id cycle
        FROM recipes r WHERE r.product_id=v_product.id AND r.is_active AND r.deleted_at IS NULL
       UNION ALL
       SELECT r.material_id,w.depth+1,w.path||r.material_id,r.material_id=ANY(w.path)
        FROM walk w JOIN products p ON p.id=w.id JOIN recipes r ON r.product_id=w.id AND r.is_active AND r.deleted_at IS NULL
        WHERE NOT p.track_inventory AND NOT w.cycle AND w.depth<5)
       SELECT 1 FROM walk w JOIN products p ON p.id=w.id WHERE NOT p.track_inventory AND
        (w.cycle OR w.depth>=5 OR NOT EXISTS(SELECT 1 FROM recipes r WHERE r.product_id=w.id AND r.is_active AND r.deleted_at IS NULL))) THEN
       v_errors:=v_errors||jsonb_build_object('path',v_path,'code','recipe_depth_cycle_or_leaf_unresolved');
       CONTINUE;
      END IF;
      v_amount:=0;
      FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v2(v_product.id,v_qty) LOOP
       v_amount:=v_amount+1;
       v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_cons.product_id,'quantity',-v_cons.qty_base, 'unit',v_cons.unit,'unit_cost',NULL,'movement_type','sale','effective_date',v_date);
      END LOOP;
      IF v_amount=0 THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','recipe_consumption_unresolved'); END IF;
     END IF;
    ELSE
     -- Quantite nette de CETTE reception ; aucune conversion piece/poids globale.
     v_qty:=_historical_import_number_v1(v_line->'received_quantity',6);
     IF v_qty IS NULL OR v_qty<=0 OR coalesce(v_line->>'received_unit','')='' THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','net_receipt_quantity_required'); CONTINUE;
     END IF;
     v_qty:=convert_quantity(v_qty,v_line->>'received_unit',v_product.unit);
     v_acquisition:=_historical_import_number_v1(v_line->'acquisition_amount');
     IF v_acquisition IS NULL THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','acquisition_allocation_required'); CONTINUE; END IF;
     v_sum:=v_sum+v_acquisition; v_cost:=v_acquisition/v_qty;
     IF _historical_import_number_v1(v_line->'invoice_net_amount') IS NULL THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invoice_net_line_required');
     ELSE
      v_invoice_sum:=v_invoice_sum+(v_line->>'invoice_net_amount')::numeric;
      IF round((v_line->>'quantity')::numeric,3)<>(v_line->>'quantity')::numeric
       OR round((v_line->>'quantity')::numeric*((v_line->>'invoice_net_amount')::numeric/(v_line->>'quantity')::numeric),2)<>(v_line->>'invoice_net_amount')::numeric
       OR (v_line->'invoice_unit_cost' IS NOT NULL AND (_historical_import_unit_price_v1(v_line->'invoice_unit_cost') IS NULL
        OR _historical_import_unit_price_v1(v_line->'invoice_unit_cost')<>(v_line->>'invoice_net_amount')::numeric/(v_line->>'quantity')::numeric)) THEN
       v_errors:=v_errors||jsonb_build_object('path',v_path,'code','purchase_invoice_line_not_representable');
      END IF;
     END IF;
     v_cost:=round(v_cost,2);
     IF v_cost>=1e12 THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','purchase_unit_cost_overflow'); END IF;
     IF v_qty<>round(v_qty,3) OR v_qty>=1e7 THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','receipt_quantity_not_representable');
     END IF;
     IF NOT coalesce(v_financial,false) THEN
     v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_product.id,'quantity',v_qty, 'unit',v_product.unit,'unit_cost',v_cost,'movement_type','purchase','effective_date',v_receipt, 'source_line_reference',v_line->>'source_reference','acquisition_amount',v_acquisition, 'invoice_unit_cost',(v_line->>'invoice_net_amount')::numeric/(v_line->>'quantity')::numeric, 'unit_cost_representation_delta',round(v_qty*v_cost,2)-v_acquisition);
     END IF;
    END IF;
   EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','unit_or_recipe_resolution_failed');
   END;
  END LOOP;
  IF v_kind='purchases' AND v_sum<>(v_doc->>'total_amount')::numeric THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','acquisition_total_mismatch');
  END IF;
  IF v_kind='purchases' AND v_invoice_sum<>(v_doc->>'net_amount')::numeric THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invoice_net_total_mismatch');
  END IF;
 END LOOP;
 FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payload->'payments') LOOP
  v_path:='payments.'||(v_payment->>'source_reference');
  IF _historical_import_timestamp_v1(v_payment->'payment_timestamp',(v_payment->>'payment_date')::date,v_payment->>'payment_time_precision') IS NULL THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','invalid_payment_timestamp_precision');
  END IF;
  SELECT * INTO v_old_payment FROM historical_import_payments WHERE source_system=p_payload->>'source_system'
   AND kind=v_kind AND source_reference=v_payment->>'source_reference';
  IF FOUND AND v_old_payment.source_hash<>_historical_import_hash_v1(v_payment) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','payment_source_conflict');
  END IF;
  IF v_old_payment.id IS NULL THEN
   BEGIN PERFORM check_fiscal_period_open((v_payment->>'payment_date')::date);
   EXCEPTION WHEN SQLSTATE 'P0004' THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','payment_period_closed_or_missing'); END;
  END IF;
  BEGIN
   v_account:=resolve_mapping_account(CASE WHEN v_kind='sales' THEN _sale_payment_mapping_key_v1(v_payment->>'method')
    WHEN v_payment->>'method'='cash' THEN 'PURCHASE_CASH_OUT' ELSE 'PURCHASE_PAYMENT_BANK' END);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
   v_account:=NULL; v_errors:=v_errors||jsonb_build_object('path',v_path,'code','payment_account_missing');
  END;
  v_customer_advance:=coalesce(v_payment->'customer_advance'='true'::jsonb,false);
  IF v_customer_advance THEN
   v_advance_count:=v_advance_count+1;
   v_advance_amount:=v_advance_amount+(v_payment->>'amount')::numeric;
   IF v_kind<>'sales' OR v_mode<>'financial_only'
    OR p_payload->'allow_customer_advances' IS DISTINCT FROM 'true'::jsonb THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_advance_not_enabled');
   END IF;
   BEGIN
    v_accounts:=v_accounts||jsonb_build_object('customer_advances',resolve_mapping_account('CUSTOMER_ADVANCES'));
   EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_advance_account_missing');
   END;
  END IF;
  v_is_prepayment:=false;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_payment->'allocations') LOOP
   SELECT value INTO v_doc FROM jsonb_array_elements(p_payload->'documents') WHERE value->>'source_reference'=v_allocation->>'document_reference';
   IF v_customer_advance THEN
    v_application_date:=_historical_import_date_v1(v_allocation->'application_date');
    IF v_doc->>'customer_treatment' IS DISTINCT FROM 'corporate'
     OR v_payment->>'customer_id' IS NULL OR v_payment->>'customer_id' IS DISTINCT FROM v_doc->>'customer_id' THEN
     v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_advance_customer_mismatch');
    END IF;
    IF v_application_date IS NULL OR v_application_date<>(v_doc->>'document_date')::date
     OR (v_payment->>'payment_date')::date>=v_application_date THEN
     v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_advance_application_date_invalid');
    ELSE
     BEGIN PERFORM check_fiscal_period_open(v_application_date);
     EXCEPTION WHEN SQLSTATE 'P0004' THEN
      v_errors:=v_errors||jsonb_build_object('path',v_path,'code','customer_advance_application_period_closed');
     END;
    END IF;
   END IF;
   IF NOT v_customer_advance AND (v_payment->>'payment_date')::date<(v_doc->>'document_date')::date THEN
    IF v_kind='purchases' AND v_mode='financial_only'
     AND p_payload->'allow_supplier_prepayments'='true'::jsonb
     AND v_payment->'supplier_prepayment'='true'::jsonb THEN
     v_is_prepayment:=true;
    ELSE
     v_errors:=v_errors||jsonb_build_object('path',v_path,'code','payment_precedes_document');
    END IF;
   END IF;
  END LOOP;
  IF v_is_prepayment THEN v_prepayments:=v_prepayments+1; END IF;
  v_pays:=v_pays||jsonb_build_object('customer_advance',v_customer_advance, 'advance_account_id',v_accounts->>'customer_advances', 'applications',CASE WHEN v_customer_advance THEN v_payment->'allocations' ELSE '[]'::jsonb END,'supplier_prepayment',v_is_prepayment,'source_reference',v_payment->>'source_reference','existing_id',v_old_payment.id, 'source_hash',_historical_import_hash_v1(v_payment),'account_id',v_account, 'effective_at',_historical_import_timestamp_v1(v_payment->'payment_timestamp',(v_payment->>'payment_date')::date,v_payment->>'payment_time_precision'), 'time_precision',coalesce(v_payment->>'payment_time_precision','day'));
 END LOOP;
 -- Solde cumule : seuls les nouveaux paiements s'ajoutent aux allocations deja appliquees.
 FOR v_doc IN SELECT value FROM jsonb_array_elements(v_docs) LOOP
  SELECT coalesce(sum(a.amount),0) INTO v_old_paid FROM historical_import_allocations a WHERE a.document_id=(v_doc->>'existing_id')::uuid;
  SELECT coalesce(sum((a->>'amount')::numeric),0) INTO v_amount FROM jsonb_array_elements(p_payload->'payments') p,
   jsonb_array_elements(p->'allocations') a WHERE a->>'document_reference'=v_doc->>'source_reference'
    AND NOT EXISTS(SELECT 1 FROM historical_import_payments h WHERE h.source_system=p_payload->>'source_system'
     AND h.kind=v_kind AND h.source_reference=p->>'source_reference');
  IF v_old_paid+v_amount>(v_doc->>'total_amount')::numeric THEN
   v_errors:=v_errors||jsonb_build_object('path',v_doc->>'source_reference','code','document_overallocated');
  END IF;
 END LOOP;
 FOR v_need IN SELECT (s->>'product_id')::uuid id, -sum((s->>'quantity')::numeric) qty FROM jsonb_array_elements(v_stock) s
  WHERE s->>'movement_type'='sale' GROUP BY 1 LOOP
  SELECT * INTO v_product FROM products WHERE id=v_need.id;
  IF v_product.is_display_item AND coalesce((SELECT quantity FROM display_stock WHERE product_id=v_need.id),0)<v_need.qty THEN
   v_errors:=v_errors||jsonb_build_object('path',v_need.id,'code','insufficient_display_stock');
  ELSIF NOT coalesce(v_allow_negative,false) AND v_product.track_inventory AND coalesce(v_product.current_stock,0)<v_need.qty THEN
   v_errors:=v_errors||jsonb_build_object('path',v_need.id,'code','insufficient_stock');
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_stock) s WHERE (s->>'quantity')::numeric<>round((s->>'quantity')::numeric,3)
  OR abs((s->>'quantity')::numeric)>=1e7) THEN v_errors:=v_errors||jsonb_build_object('code','stock_quantity_not_representable'); END IF;
 -- Empreinte conservatrice : toute dependance mutable sera relue sous verrou a l'application.
 v_snapshot:=jsonb_build_object( 'products',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM products p)), 'recipes',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM recipes r)), 'display',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY product_id),'[]') FROM display_stock d)), 'accounts',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM accounts a)), 'mappings',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY mapping_key),'[]') FROM accounting_mappings m)), 'periods',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id),'[]') FROM fiscal_periods f)), 'units',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY code),'[]') FROM units u)), 'conversions',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY from_unit,to_unit),'[]') FROM unit_conversions c)), 'modifiers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM product_modifiers m)), 'categories',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM customer_categories c)), 'customers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM customers c)), 'suppliers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM suppliers s)), 'allow_negative_stock',v_allow_negative);
 v_result:=jsonb_build_object('customer_advance_count',v_advance_count,'customer_advance_amount',v_advance_amount, 'allow_customer_advances',coalesce(p_payload->'allow_customer_advances'='true'::jsonb,false),'allow_supplier_prepayments',coalesce(p_payload->'allow_supplier_prepayments'='true'::jsonb,false), 'supplier_prepayment_count',v_prepayments,'stock_mode',v_mode,'stock_deferred',coalesce(v_financial,false), 'source_options_not_resolved_for_stock',coalesce(v_financial,false),'valid',v_errors='[]'::jsonb,'errors',v_errors,'kind',v_kind, 'payload_hash',_historical_import_hash_v1(p_payload),'documents',v_docs,'payments',v_pays,'stock_effects',v_stock, 'accounts',v_accounts,'dependencies',v_snapshot,'source_date_precision','per_source_record','stock_basis',CASE WHEN v_financial THEN 'deferred_to_opening_opname' WHEN v_kind='sales' THEN 'current_v3' ELSE 'source_receipt' END, 'stock_basis_is_estimate',NOT coalesce(v_financial,false) AND v_kind='sales','modifier_snapshots',v_modifier_snapshots, 'inventory_cost_snapshot',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',id,'unit',unit,'cost_price',cost_price) ORDER BY id),'[]') FROM products), 'recipe_snapshot',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM recipes r WHERE is_active AND deleted_at IS NULL));
 RETURN v_result||jsonb_build_object('preview_hash',_historical_import_hash_v1(v_result),'recipe_snapshot_at',transaction_timestamp());
END $function$;

REVOKE ALL ON FUNCTION public._historical_import_plan_v4(jsonb) FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._historical_import_payment_v2(p_run uuid, p_source jsonb, p_plan jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_run historical_import_runs%ROWTYPE; v_pay uuid; v_allocation jsonb; v_doc historical_import_documents%ROWTYPE;
 v_date date:=(p_source->>'payment_date')::date; v_amount numeric; v_paid numeric; v_native uuid; v_je uuid; v_type text;
 v_advance boolean:=coalesce(p_plan->'customer_advance'='true'::jsonb,false);
 v_receipt_je uuid; v_application_date date; v_links jsonb:='[]';
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
  IF v_advance THEN
   v_application_date:=(v_allocation->>'application_date')::date;
   v_receipt_je:=_historical_import_je_v1('customer_advance_receipt',v_native,v_date, 'Historical customer advance: '||(p_source->>'source_reference'),jsonb_build_array(
     jsonb_build_object('account_id',p_plan->>'account_id','debit',v_amount,'credit',0),
     jsonb_build_object('account_id',p_plan->>'advance_account_id','debit',0,'credit',v_amount)));
   v_je:=_historical_import_je_v1('customer_advance_application',v_native,v_application_date, 'Historical customer advance application: '||v_doc.source_reference,jsonb_build_array(
     jsonb_build_object('account_id',p_plan->>'advance_account_id','debit',v_amount,'credit',0),
     jsonb_build_object('account_id',v_doc.account_id,'debit',0,'credit',v_amount)));
   v_links:=v_links||jsonb_build_object('document_id',v_doc.id,'native_payment_id',v_native, 'receipt_journal_entry_id',v_receipt_je,'application_journal_entry_id',v_je, 'received_at',v_effective_at,'application_date',v_application_date,'application_time_precision','day');
  ELSE
  v_je:=_historical_import_je_v1(v_type,v_native,v_date,'Historical payment: '||(p_source->>'source_reference'),
   CASE WHEN v_run.kind='sales' THEN jsonb_build_array(
    jsonb_build_object('account_id',p_plan->>'account_id','debit',v_amount,'credit',0),
    jsonb_build_object('account_id',v_doc.account_id,'debit',0,'credit',v_amount))
   ELSE jsonb_build_array(jsonb_build_object('account_id',v_doc.account_id,'debit',v_amount,'credit',0),
    jsonb_build_object('account_id',p_plan->>'account_id','debit',0,'credit',v_amount)) END);
  END IF;
  INSERT INTO historical_import_allocations(payment_id,document_id,amount,native_payment_id,journal_entry_id)
  VALUES(v_pay,v_doc.id,v_amount,v_native,v_je);
  IF v_type='b2b_payment' THEN UPDATE b2b_payments SET journal_entry_id=CASE WHEN v_advance THEN v_receipt_je ELSE v_je END WHERE id=v_native; END IF;
  IF v_run.kind='sales' AND v_paid+v_amount=v_doc.total_amount THEN
   UPDATE orders SET status='paid',paid_at=(SELECT max(CASE WHEN p.source_payload->'customer_advance'='true'::jsonb THEN
     (SELECT (source_allocation->>'application_date')::date::timestamp AT TIME ZONE 'Asia/Makassar'
      FROM jsonb_array_elements(p.source_payload->'allocations') source_allocation
      WHERE source_allocation->>'document_reference'=v_doc.source_reference)
     ELSE p.effective_at END) FROM historical_import_allocations a
    JOIN historical_import_payments p ON p.id=a.payment_id WHERE a.document_id=v_doc.id) WHERE id=v_doc.entity_id;
  END IF;
 END LOOP;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_run.actor_id,'historical_import.payment','historical_import_payments',v_pay,
  jsonb_build_object('run_id',p_run,'source_system',v_run.source_system,'source_reference',p_source->>'source_reference'),
  jsonb_build_object('payment_date',v_date,'amount',p_source->'amount','method',p_source->'method','allocations',p_source->'allocations','customer_advance',v_advance, 'advance_journal_entries',v_links));
 RETURN v_pay;
END $function$;

CREATE OR REPLACE FUNCTION public.apply_historical_import_v4(p_payload jsonb, p_preview_hash text, p_client_key uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
 v_plan:=_historical_import_plan_v4(p_payload);
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
   PERFORM _record_sale_stock_v1(v_stock.product_id,-v_stock.quantity,v_stock.reference_id,v_actor, 'Historical sale (current V3 recipe estimate)','sale',v_stock.reference_type,v_stock.unit,
    (v_plan->'dependencies'->>'allow_negative_stock')::boolean);
  ELSE
   SELECT * INTO STRICT v_document FROM historical_import_documents WHERE id=v_stock.document_id;
   PERFORM record_stock_movement_v1(p_product_id:=v_stock.product_id,p_movement_type:='purchase',
    p_quantity:=v_stock.quantity,p_reason:='Historical purchase: '||v_document.source_reference,
    p_unit_cost:=v_stock.unit_cost,p_supplier_id:=v_document.counterparty_id,p_idempotency_key:=v_stock.id,p_unit:=v_stock.unit,
    p_metadata:=jsonb_build_object('reference_type',v_stock.reference_type,'reference_id',v_stock.reference_id, 'financial_import_document_id',v_document.id));
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
  PERFORM _historical_import_payment_v2(v_run,v_source,v_payment);
 END LOOP;
 v_result:=jsonb_build_object('customer_advance_count',v_plan->'customer_advance_count', 'customer_advance_amount',v_plan->'customer_advance_amount','allow_customer_advances',v_plan->'allow_customer_advances', 'advance_journal_entries',(SELECT coalesce(jsonb_agg(a.payload->'advance_journal_entries'),'[]') FROM audit_logs a
   WHERE a.action='historical_import.payment' AND a.metadata->>'run_id'=v_run::text AND a.payload->'customer_advance'='true'::jsonb), 'allow_supplier_prepayments',v_plan->'allow_supplier_prepayments', 'supplier_prepayment_count',v_plan->'supplier_prepayment_count','stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred', 'source_options_not_resolved_for_stock',v_plan->'source_options_not_resolved_for_stock','run_id',v_run,'kind',p_payload->>'kind','batch_reference',p_payload->>'batch_reference', 'payload_hash',v_plan->>'payload_hash','preview_hash',p_preview_hash,'idempotent_replay',false, 'documents',(SELECT jsonb_agg(jsonb_build_object('document_id',d.id,'entity_id',d.entity_id,'source_reference',d.source_reference)
   ORDER BY d.source_reference) FROM historical_import_documents d WHERE d.source_system=p_payload->>'source_system'
    AND d.kind=p_payload->>'kind' AND d.source_reference IN (SELECT value->>'source_reference' FROM jsonb_array_elements(p_payload->'documents'))), 'payments',(SELECT coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'source_reference',p.source_reference) ORDER BY p.source_reference),'[]')
   FROM historical_import_payments p WHERE p.run_id=v_run), 'stock_effect_count',(SELECT count(*) FROM historical_import_stock_effects WHERE run_id=v_run), 'stock_basis',v_plan->'stock_basis','stock_basis_is_estimate',v_plan->'stock_basis_is_estimate','recipe_snapshot_at',v_plan->'recipe_snapshot_at', 'recipe_snapshot',v_plan->'recipe_snapshot','modifier_snapshots',v_plan->'modifier_snapshots', 'inventory_cost_snapshot',v_plan->'inventory_cost_snapshot','dependencies',v_plan->'dependencies');
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload)
 VALUES(v_actor,'historical_import.applied','historical_import_runs',v_run,
  jsonb_build_object('source_system',p_payload->>'source_system','batch_reference',p_payload->>'batch_reference'),
  jsonb_build_object('payload_hash',v_plan->>'payload_hash','preview_hash',p_preview_hash, 'customer_advance_count',v_plan->'customer_advance_count','customer_advance_amount',v_plan->'customer_advance_amount', 'advance_journal_entries',v_result->'advance_journal_entries','allow_supplier_prepayments',v_plan->'allow_supplier_prepayments','supplier_prepayment_count',v_plan->'supplier_prepayment_count', 'stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred', 'source_options_not_resolved_for_stock',v_plan->'source_options_not_resolved_for_stock','documents',v_result->'documents','payments',v_result->'payments','stock_effect_count',v_result->'stock_effect_count'));
 UPDATE historical_import_runs SET status='applied',result=v_result WHERE id=v_run;
 PERFORM set_config('breakery.historical_import_run',coalesce(v_previous_context,''),true);
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.preview_historical_import_v4(p_payload jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 PERFORM _historical_import_actor_v1(p_payload->>'kind');
 RETURN _historical_import_plan_v4(p_payload);
END $function$;

REVOKE ALL ON FUNCTION public._historical_import_payment_v2(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.apply_historical_import_v4(jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_historical_import_v4(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_historical_import_v4(jsonb,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_historical_import_v4(jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.apply_historical_import_v3(jsonb,text,uuid);
DROP FUNCTION public.preview_historical_import_v3(jsonb);
DROP FUNCTION public._historical_import_plan_v3(jsonb);
DROP FUNCTION public._historical_import_payment_v1(uuid,jsonb,jsonb);
