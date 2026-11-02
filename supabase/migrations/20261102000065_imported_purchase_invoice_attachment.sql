CREATE OR REPLACE FUNCTION public._historical_import_entity_guard_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 v_old jsonb:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 v_document uuid; v_run uuid:=_historical_import_context_v1(); v_parent uuid;
BEGIN
 IF TG_TABLE_NAME IN ('orders','purchase_orders') THEN
  v_document:=coalesce((v_old->>'financial_import_document_id')::uuid,(v_row->>'financial_import_document_id')::uuid);
  IF TG_OP='UPDATE' AND v_old->>'financial_import_document_id' IS DISTINCT FROM v_row->>'financial_import_document_id' THEN
   RAISE EXCEPTION 'financial_import_marker_immutable' USING ERRCODE='P0003';
  END IF;
 ELSIF TG_TABLE_NAME IN ('order_items','order_payments','refunds') THEN
  SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_row->>'order_id')::uuid;
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_old->>'order_id')::uuid; END IF;
 ELSIF TG_TABLE_NAME IN ('purchase_order_items','goods_receipt_notes','purchase_payments') THEN
  SELECT financial_import_document_id INTO v_document FROM purchase_orders
   WHERE id=coalesce((v_row->>'po_id')::uuid,(v_row->>'purchase_order_id')::uuid);
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM purchase_orders
   WHERE id=coalesce((v_old->>'po_id')::uuid,(v_old->>'purchase_order_id')::uuid); END IF;
 ELSIF TG_TABLE_NAME='b2b_payment_allocations' THEN
  SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_row->>'invoice_id')::uuid;
  IF v_document IS NULL THEN SELECT financial_import_document_id INTO v_document FROM orders WHERE id=(v_old->>'invoice_id')::uuid; END IF;
 ELSIF TG_TABLE_NAME='b2b_payments' THEN
  SELECT a.document_id INTO v_document FROM historical_import_allocations a WHERE native_payment_id=(v_row->>'id')::uuid LIMIT 1;
 END IF;
 -- La facture est indépendante des données financières importées, immuables.
 IF TG_TABLE_NAME='purchase_orders' AND TG_OP='UPDATE'
  AND (to_jsonb(NEW)-'invoice_path'-'updated_at')=(to_jsonb(OLD)-'invoice_path'-'updated_at') THEN
  RETURN NEW;
 END IF;
 IF v_document IS NOT NULL THEN
  IF TG_OP='DELETE' OR v_run IS NULL OR NOT EXISTS(
   SELECT 1 FROM historical_import_documents d JOIN historical_import_runs r ON r.id=v_run
   WHERE d.id=v_document AND d.kind=r.kind AND d.source_system=r.source_system) THEN
   RAISE EXCEPTION 'financial_import_requires_dedicated_workflow' USING ERRCODE='P0003';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $function$
;

DO $$
DECLARE t record;
BEGIN
 FOR t IN SELECT c.oid::regclass AS relation,g.tgname,pg_get_triggerdef(g.oid) AS definition
  FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
  WHERE g.tgfoid='public._historical_import_entity_guard_v1()'::regprocedure LOOP
  EXECUTE format('DROP TRIGGER %I ON %s',t.tgname,t.relation);
  EXECUTE replace(t.definition,'_historical_import_entity_guard_v1','_historical_import_entity_guard_v2');
 END LOOP;
END $$;
DROP FUNCTION public._historical_import_entity_guard_v1();
REVOKE ALL ON FUNCTION public._historical_import_entity_guard_v2() FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
