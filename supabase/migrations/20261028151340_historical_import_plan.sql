-- Planificateur commun au preview et a l'application ; aucun numero ni UUID alloue.
CREATE FUNCTION public._historical_import_modifier_plan_v1(p_product_id uuid,p_quantity numeric,p_choices jsonb,p_addon numeric,
 p_addon_choices jsonb,p_addon_reconciled boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_choices jsonb:=coalesce(p_choices,'[]'); v_id jsonb; v_modifier product_modifiers%ROWTYPE;
 v_ingredient jsonb; v_product products%ROWTYPE; v_qty numeric; v_group record;
 v_selected uuid[]:='{}'; v_errors jsonb:='[]'; v_effects jsonb:='[]'; v_snapshot jsonb:='[]';
BEGIN
 IF jsonb_typeof(v_choices)<>'array' OR jsonb_array_length(CASE WHEN jsonb_typeof(v_choices)='array' THEN v_choices ELSE '[]' END)>30 THEN
  RETURN jsonb_build_object('errors','[{"code":"invalid_modifier_choices"}]'::jsonb,'effects','[]'::jsonb);
 END IF;
 FOR v_id IN SELECT value FROM jsonb_array_elements(v_choices) LOOP
  IF jsonb_typeof(v_id)<>'string' OR coalesce(v_id#>>'{}','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
   v_errors:=v_errors||jsonb_build_object('code','invalid_modifier_identity'); CONTINUE;
  END IF;
  SELECT * INTO v_modifier FROM product_modifiers WHERE id=(v_id#>>'{}')::uuid AND is_active AND deleted_at IS NULL
   AND (product_id=p_product_id OR (product_id IS NULL AND category_id=(SELECT category_id FROM products WHERE id=p_product_id)));
  IF NOT FOUND OR v_modifier.id=ANY(v_selected) THEN
   v_errors:=v_errors||jsonb_build_object('code','modifier_not_available_or_duplicate'); CONTINUE;
  END IF;
  v_selected:=array_append(v_selected,v_modifier.id); v_snapshot:=v_snapshot||to_jsonb(v_modifier);
  IF jsonb_typeof(v_modifier.ingredients_to_deduct) IS DISTINCT FROM 'array' THEN
   v_errors:=v_errors||jsonb_build_object('code','modifier_ingredients_invalid'); CONTINUE;
  END IF;
  FOR v_ingredient IN SELECT value FROM jsonb_array_elements(v_modifier.ingredients_to_deduct) LOOP
   IF coalesce(v_ingredient->>'product_id','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    OR _historical_import_number_v1(v_ingredient->'qty',6) IS NULL THEN
    v_errors:=v_errors||jsonb_build_object('code','modifier_ingredient_invalid'); CONTINUE;
   END IF;
   SELECT * INTO v_product FROM products WHERE id=(v_ingredient->>'product_id')::uuid AND deleted_at IS NULL;
   IF NOT FOUND THEN v_errors:=v_errors||jsonb_build_object('code','modifier_ingredient_not_found'); CONTINUE; END IF;
   BEGIN
    v_qty:=convert_quantity((v_ingredient->>'qty')::numeric*p_quantity,v_ingredient->>'unit',v_product.unit);
    IF v_qty>0 THEN
     v_effects:=v_effects||jsonb_build_object('product_id',v_product.id,'quantity',-v_qty,'unit',v_product.unit,
      'unit_cost',NULL,'movement_type','sale','modifier_id',v_modifier.id);
    END IF;
   EXCEPTION WHEN SQLSTATE 'P0002' OR SQLSTATE '22023' THEN
    v_errors:=v_errors||jsonb_build_object('code','modifier_unit_conversion_missing');
   END;
  END LOOP;
 END LOOP;
 FOR v_group IN SELECT group_name,bool_or(group_required) required,bool_or(group_type::text='single_select') single_choice
  FROM product_modifiers WHERE is_active AND deleted_at IS NULL
   AND (product_id=p_product_id OR (product_id IS NULL AND category_id=(SELECT category_id FROM products WHERE id=p_product_id))) GROUP BY group_name LOOP
  SELECT count(*) INTO v_qty FROM product_modifiers WHERE id=ANY(v_selected) AND group_name=v_group.group_name;
  IF (v_group.required AND v_qty=0) OR (v_group.single_choice AND v_qty>1) THEN
   v_errors:=v_errors||jsonb_build_object('code','modifier_group_selection_required','group',v_group.group_name);
  END IF;
 END LOOP;
 IF p_addon>0 AND (p_addon_reconciled IS DISTINCT FROM true OR jsonb_typeof(p_addon_choices) IS DISTINCT FROM 'array') THEN
  v_errors:=v_errors||jsonb_build_object('code','addon_identity_unresolved');
 ELSIF p_addon>0 THEN
  IF jsonb_array_length(p_addon_choices)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_addon_choices) a
   WHERE NOT EXISTS(SELECT 1 FROM product_modifiers m WHERE to_jsonb(m.id::text)=a AND m.id=ANY(v_selected) AND m.price_adjustment>0)) THEN
   v_errors:=v_errors||jsonb_build_object('code','addon_identity_unresolved');
  END IF;
 END IF;
 RETURN jsonb_build_object('errors',v_errors,'effects',v_effects,'modifier_snapshot',v_snapshot);
END $$;

CREATE FUNCTION public._historical_import_plan_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_errors jsonb:=_historical_import_envelope_errors_v1(p_payload); v_kind text:=p_payload->>'kind';
 v_doc jsonb; v_line jsonb; v_payment jsonb; v_allocation jsonb; v_stock jsonb:='[]';
 v_docs jsonb:='[]'; v_pays jsonb:='[]'; v_accounts jsonb:='{}'; v_existing historical_import_documents%ROWTYPE;
 v_old_payment historical_import_payments%ROWTYPE; v_product products%ROWTYPE; v_customer customers%ROWTYPE;
 v_account uuid; v_counterparty uuid; v_ref text; v_path text; v_date date; v_receipt date; v_effective_at timestamptz;
 v_qty numeric; v_cost numeric; v_acquisition numeric; v_sum numeric; v_invoice_sum numeric; v_amount numeric; v_old_paid numeric;
 v_cons record; v_need record; v_allow_negative boolean; v_snapshot jsonb; v_result jsonb;
 v_modifier_plan jsonb; v_modifier_effect jsonb; v_modifier_snapshots jsonb:='[]';
BEGIN
 IF v_errors<>'[]'::jsonb THEN RETURN jsonb_build_object('valid',false,'errors',v_errors); END IF;
 SELECT allow_negative_stock INTO v_allow_negative FROM business_config WHERE id=1;
 IF v_allow_negative IS NULL THEN
  v_errors:=v_errors||jsonb_build_object('code','business_config_required');
 END IF;
 BEGIN
  v_accounts:=jsonb_build_object('tax',resolve_mapping_account('SALE_PB1_TAX'),
   'revenue',resolve_mapping_account('SALE_POS_REVENUE'),'b2b_revenue',resolve_mapping_account('SALE_B2B_REVENUE'),
   'inventory',resolve_mapping_account('INVENTORY_GENERAL'),'payable',resolve_mapping_account('PURCHASE_PAYABLE'));
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
  v_docs:=v_docs||jsonb_build_object('source_reference',v_ref,'existing_id',v_existing.id,'entity_id',v_existing.entity_id,
   'source_hash',_historical_import_hash_v1(v_doc),'account_id',v_account,'counterparty_id',v_counterparty,
   'document_date',v_date,'effective_at',v_effective_at,'time_precision',coalesce(v_doc->>'document_time_precision','day'),
   'receipt_date',v_receipt,'total_amount',(v_doc->>'total_amount')::numeric);
  IF v_existing.id IS NOT NULL THEN CONTINUE; END IF;
  IF v_doc->'stock_reconciled' IS DISTINCT FROM 'true'::jsonb OR v_doc->>'stock_basis' IS DISTINCT FROM (CASE WHEN v_kind='sales' THEN 'current_v3' ELSE 'source_receipt' END) THEN
   v_errors:=v_errors||jsonb_build_object('path',v_path,'code','stock_basis_reconciliation_required');
  END IF;
  v_sum:=0; v_invoice_sum:=0;
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_doc->'lines') LOOP
   SELECT * INTO v_product FROM products WHERE id=(v_line->>'product_id')::uuid AND deleted_at IS NULL;
   IF NOT FOUND THEN v_errors:=v_errors||jsonb_build_object('path',v_path,'code','product_not_found'); CONTINUE; END IF;
   IF v_product.product_type='combo' OR EXISTS(SELECT 1 FROM products WHERE parent_product_id=v_product.id AND deleted_at IS NULL) THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','product_choices_not_represented'); CONTINUE;
   END IF;
   BEGIN
    IF v_kind='sales' THEN
     v_qty:=convert_quantity((v_line->>'quantity')::numeric,v_line->>'unit',v_product.unit);
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
     v_modifier_plan:=_historical_import_modifier_plan_v1(v_product.id,(v_line->>'quantity')::numeric,v_line->'modifier_ids',coalesce((v_line->>'addon_amount')::numeric,0),
      v_line->'addon_modifier_ids',v_line->'addon_identity_reconciled'='true'::jsonb);
     v_errors:=v_errors||(v_modifier_plan->'errors');
     v_modifier_snapshots:=v_modifier_snapshots||jsonb_build_object('document_reference',v_ref,'line_reference',v_line->>'source_reference',
      'snapshot',v_modifier_plan->'modifier_snapshot');
     FOR v_modifier_effect IN SELECT value FROM jsonb_array_elements(v_modifier_plan->'effects') LOOP
      v_stock:=v_stock||(v_modifier_effect||jsonb_build_object('document_reference',v_ref,'effective_date',v_date));
     END LOOP;
     IF v_product.track_inventory OR v_product.is_display_item THEN
      v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_product.id,'quantity',-v_qty,
       'unit',v_product.unit,'unit_cost',NULL,'movement_type','sale','effective_date',v_date);
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
       v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_cons.product_id,'quantity',-v_cons.qty_base,
        'unit',v_cons.unit,'unit_cost',NULL,'movement_type','sale','effective_date',v_date);
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
     v_stock:=v_stock||jsonb_build_object('document_reference',v_ref,'product_id',v_product.id,'quantity',v_qty,
      'unit',v_product.unit,'unit_cost',v_cost,'movement_type','purchase','effective_date',v_receipt,
      'source_line_reference',v_line->>'source_reference','acquisition_amount',v_acquisition,
      'invoice_unit_cost',(v_line->>'invoice_net_amount')::numeric/(v_line->>'quantity')::numeric,
      'unit_cost_representation_delta',round(v_qty*v_cost,2)-v_acquisition);
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
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_payment->'allocations') LOOP
   SELECT value INTO v_doc FROM jsonb_array_elements(p_payload->'documents') WHERE value->>'source_reference'=v_allocation->>'document_reference';
   IF (v_payment->>'payment_date')::date<(v_doc->>'document_date')::date THEN
    v_errors:=v_errors||jsonb_build_object('path',v_path,'code','payment_precedes_document');
   END IF;
  END LOOP;
  v_pays:=v_pays||jsonb_build_object('source_reference',v_payment->>'source_reference','existing_id',v_old_payment.id,
   'source_hash',_historical_import_hash_v1(v_payment),'account_id',v_account,
   'effective_at',_historical_import_timestamp_v1(v_payment->'payment_timestamp',(v_payment->>'payment_date')::date,v_payment->>'payment_time_precision'),
   'time_precision',coalesce(v_payment->>'payment_time_precision','day'));
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
 v_snapshot:=jsonb_build_object(
  'products',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM products p)),
  'recipes',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM recipes r)),
  'display',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY product_id),'[]') FROM display_stock d)),
  'accounts',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM accounts a)),
  'mappings',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY mapping_key),'[]') FROM accounting_mappings m)),
  'periods',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY id),'[]') FROM fiscal_periods f)),
  'units',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY code),'[]') FROM units u)),
  'conversions',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY from_unit,to_unit),'[]') FROM unit_conversions c)),
  'modifiers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM product_modifiers m)),
  'categories',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM customer_categories c)),
  'customers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM customers c)),
  'suppliers',_historical_import_hash_v1((SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]') FROM suppliers s)),
  'allow_negative_stock',v_allow_negative);
 v_result:=jsonb_build_object('valid',v_errors='[]'::jsonb,'errors',v_errors,'kind',v_kind,
  'payload_hash',_historical_import_hash_v1(p_payload),'documents',v_docs,'payments',v_pays,'stock_effects',v_stock,
  'accounts',v_accounts,'dependencies',v_snapshot,'source_date_precision','per_source_record','stock_basis',CASE WHEN v_kind='sales' THEN 'current_v3' ELSE 'source_receipt' END,
  'stock_basis_is_estimate',v_kind='sales','modifier_snapshots',v_modifier_snapshots,
  'inventory_cost_snapshot',(SELECT coalesce(jsonb_agg(jsonb_build_object('product_id',id,'unit',unit,'cost_price',cost_price) ORDER BY id),'[]') FROM products),
  'recipe_snapshot',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM recipes r WHERE is_active AND deleted_at IS NULL));
 RETURN v_result||jsonb_build_object('preview_hash',_historical_import_hash_v1(v_result),'recipe_snapshot_at',transaction_timestamp());
END $$;
CREATE FUNCTION public.preview_historical_import_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM _historical_import_actor_v1(p_payload->>'kind');
 RETURN _historical_import_plan_v1(p_payload);
END $$;
REVOKE ALL ON FUNCTION public._historical_import_plan_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public._historical_import_modifier_plan_v1(uuid,numeric,jsonb,numeric,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_historical_import_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.preview_historical_import_v1(jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
