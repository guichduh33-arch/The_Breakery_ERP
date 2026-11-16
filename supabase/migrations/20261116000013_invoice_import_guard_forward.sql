-- Corps live de la garde conservé ; seule la référence justificative est réparable.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._historical_import_entity_guard_v1()'); BEGIN
 IF f IS NOT NULL AND ((md5(pg_get_functiondef(f)) NOT IN ('eb07f6947b2744833b1e14ccb62e1746','76e66637d43fd194d4e43cecf5d9d521') AND md5(btrim(replace(pg_get_functiondef(f),E'\r\n',E'\n'))) <> '76f2f9a692105684b4978a2655daff5f')) THEN RAISE EXCEPTION 'invoice_definition_drift: _historical_import_entity_guard_v1()'; END IF;
END $old$;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._historical_import_entity_guard_v2()'); BEGIN
 IF f IS NOT NULL AND ((SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '0f326394aefa4707796c45f22a9dcb44') THEN RAISE EXCEPTION 'invoice_definition_drift: _historical_import_entity_guard_v2()'; END IF;
END $old$;
CREATE FUNCTION public._historical_import_entity_guard_v3()
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
 -- Le rattachement de facture ne modifie aucune donnée financière importée.
 IF TG_TABLE_NAME='purchase_orders' AND TG_OP='UPDATE'
  AND (to_jsonb(NEW)-'invoice_path'-'updated_at')=(to_jsonb(OLD)-'invoice_path'-'updated_at') THEN RETURN NEW; END IF;
 IF v_document IS NOT NULL THEN
  IF TG_OP='DELETE' OR v_run IS NULL OR NOT EXISTS(
   SELECT 1 FROM historical_import_documents d JOIN historical_import_runs r ON r.id=v_run
   WHERE d.id=v_document AND d.kind=r.kind AND d.source_system=r.source_system) THEN
   RAISE EXCEPTION 'financial_import_requires_dedicated_workflow' USING ERRCODE='P0003';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $function$;
DO $triggers$ DECLARE t record; BEGIN
 FOR t IN SELECT g.tgname,g.tgenabled,c.relname,c.oid::regclass AS relation,pg_get_triggerdef(g.oid) AS definition,p.proname
  FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid JOIN pg_class c ON c.oid=g.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE n.nspname='public' AND pn.nspname='public'
   AND p.proname IN('_historical_import_entity_guard_v1','_historical_import_entity_guard_v2') LOOP
  IF t.tgenabled<>'O' OR t.tgname<>'financial_import_entity_guard' OR t.relname NOT IN(
   'orders','order_items','order_payments','refunds','purchase_orders','purchase_order_items',
   'goods_receipt_notes','purchase_payments','b2b_payments','b2b_payment_allocations') THEN
   RAISE EXCEPTION 'invoice_import_trigger_drift'; END IF;
  EXECUTE format('DROP TRIGGER %I ON %s',t.tgname,t.relation);
  EXECUTE replace(t.definition,t.proname,'_historical_import_entity_guard_v3');
 END LOOP;
END $triggers$;
DROP FUNCTION IF EXISTS public._historical_import_entity_guard_v1();
DROP FUNCTION IF EXISTS public._historical_import_entity_guard_v2();
REVOKE ALL ON FUNCTION public._historical_import_entity_guard_v3() FROM PUBLIC,anon,authenticated,service_role;
