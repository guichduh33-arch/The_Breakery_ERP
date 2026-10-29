-- Dates reelles et comptes existants conserves ; aucun nouvel emetteur de JE.
CREATE OR REPLACE FUNCTION public.apply_historical_import_v3(p_payload jsonb, p_preview_hash text, p_client_key uuid)
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
 v_plan:=_historical_import_plan_v3(p_payload);
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
 v_result:=jsonb_build_object('allow_supplier_prepayments',v_plan->'allow_supplier_prepayments',
  'supplier_prepayment_count',v_plan->'supplier_prepayment_count','stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred',
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
   'allow_supplier_prepayments',v_plan->'allow_supplier_prepayments','supplier_prepayment_count',v_plan->'supplier_prepayment_count',
   'stock_mode',v_plan->'stock_mode','stock_deferred',v_plan->'stock_deferred',
   'source_options_not_resolved_for_stock',v_plan->'source_options_not_resolved_for_stock','documents',v_result->'documents','payments',v_result->'payments','stock_effect_count',v_result->'stock_effect_count'));
 UPDATE historical_import_runs SET status='applied',result=v_result WHERE id=v_run;
 PERFORM set_config('breakery.historical_import_run',coalesce(v_previous_context,''),true);
 RETURN v_result;
END $function$;

CREATE OR REPLACE FUNCTION public.preview_historical_import_v3(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 PERFORM _historical_import_actor_v1(p_payload->>'kind');
 RETURN _historical_import_plan_v3(p_payload);
END $function$;

REVOKE ALL ON FUNCTION public.apply_historical_import_v3(jsonb,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.preview_historical_import_v3(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.apply_historical_import_v3(jsonb,text,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_historical_import_v3(jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.apply_historical_import_v2(jsonb,text,uuid);
DROP FUNCTION public.preview_historical_import_v2(jsonb);
DROP FUNCTION public._historical_import_plan_v2(jsonb);
