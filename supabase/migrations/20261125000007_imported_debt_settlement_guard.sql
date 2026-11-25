-- Règlement des dettes importées : un paiement neuf s'ajoute au registre de reprise
-- sans réécrire ce qui a été importé.
--
-- La garde v3 refusait toute écriture sur les enfants d'une commande importée hors
-- du flux d'import. Elle refusait donc aussi le simple règlement d'une facture
-- fournisseur ou B2B restée ouverte en octobre. Pour le B2B, le premier entré
-- premier sorti vise d'abord ces factures anciennes : tout règlement du client
-- échouait, même destiné à une facture de novembre.
--
-- La v4 garde le corps live de la v3 et n'ouvre que trois gestes, tous additifs :
--   1. INSERT dans purchase_payments, sans dépasser le total du bon importé ;
--   2. INSERT dans b2b_payment_allocations, sans dépasser le total de la facture
--      importée encore b2b_pending ;
--   3. UPDATE d'une facture B2B importée b2b_pending vers paid, quand ses
--      allocations couvrent son total, sans toucher une autre colonne que
--      status, paid_at et updated_at.
-- Les écritures comptables de ces gestes restent celles des RPC de règlement
-- (Dr 2141 / Cr trésorerie, Dr trésorerie / Cr 1132) : la dette importée a déjà
-- sa JE d'origine, le règlement l'éteint. Tout le reste reste refusé : montants,
-- lignes, suppressions, remboursements, réceptions et ventes de caisse importées.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $old$ DECLARE f regprocedure:=to_regprocedure('public._historical_import_entity_guard_v3()'); BEGIN
 IF f IS NULL OR (SELECT md5(replace(prosrc,E'\r\n',E'\n')) FROM pg_proc WHERE oid=f) <> '284149b24cb3a15f0d4050a961295926' THEN
  RAISE EXCEPTION 'settlement_definition_drift: _historical_import_entity_guard_v3()'; END IF;
END $old$;
CREATE FUNCTION public._historical_import_entity_guard_v4()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_row jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 v_old jsonb:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
 v_document uuid; v_run uuid:=_historical_import_context_v1(); v_parent uuid;
 v_total numeric; v_settled numeric; v_amount numeric;
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
 -- Règlement d'une dette importée : un ajout borné par le total importé, jamais une réécriture.
 IF v_document IS NOT NULL AND v_run IS NULL THEN
  IF TG_TABLE_NAME='purchase_payments' AND TG_OP='INSERT' THEN
   v_amount:=(v_row->>'amount')::numeric;
   SELECT p.total_amount INTO v_total FROM purchase_orders p WHERE p.id=(v_row->>'purchase_order_id')::uuid;
   SELECT coalesce(sum(pp.amount),0) INTO v_settled FROM purchase_payments pp
    WHERE pp.purchase_order_id=(v_row->>'purchase_order_id')::uuid;
   IF v_amount>0 AND v_settled+v_amount<=v_total THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='b2b_payment_allocations' AND TG_OP='INSERT' THEN
   v_amount:=(v_row->>'amount_applied')::numeric;
   SELECT o.total INTO v_total FROM orders o
    WHERE o.id=(v_row->>'invoice_id')::uuid AND o.order_type='b2b' AND o.status='b2b_pending';
   SELECT coalesce(sum(a.amount_applied),0) INTO v_settled FROM b2b_payment_allocations a
    WHERE a.invoice_id=(v_row->>'invoice_id')::uuid;
   IF v_total IS NOT NULL AND v_amount>0 AND v_settled+v_amount<=v_total THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='orders' AND TG_OP='UPDATE'
   AND v_old->>'order_type'='b2b' AND v_old->>'status'='b2b_pending' AND v_row->>'status'='paid'
   AND (v_row-'status'-'paid_at'-'updated_at')=(v_old-'status'-'paid_at'-'updated_at') THEN
   SELECT coalesce(sum(a.amount_applied),0) INTO v_settled FROM b2b_payment_allocations a
    WHERE a.invoice_id=(v_row->>'id')::uuid;
   IF v_settled>=(v_old->>'total')::numeric THEN RETURN NEW; END IF;
  END IF;
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
END $function$;
DO $triggers$ DECLARE t record; n int:=0; BEGIN
 FOR t IN SELECT g.tgname,g.tgenabled,c.relname,c.oid::regclass AS relation,pg_get_triggerdef(g.oid) AS definition,p.proname
  FROM pg_trigger g JOIN pg_proc p ON p.oid=g.tgfoid JOIN pg_class c ON c.oid=g.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_namespace pn ON pn.oid=p.pronamespace
  WHERE n.nspname='public' AND pn.nspname='public' AND p.proname='_historical_import_entity_guard_v3' LOOP
  IF t.tgenabled<>'O' OR t.tgname<>'financial_import_entity_guard' OR t.relname NOT IN(
   'orders','order_items','order_payments','refunds','purchase_orders','purchase_order_items',
   'goods_receipt_notes','purchase_payments','b2b_payments','b2b_payment_allocations') THEN
   RAISE EXCEPTION 'settlement_trigger_drift'; END IF;
  EXECUTE format('DROP TRIGGER %I ON %s',t.tgname,t.relation);
  EXECUTE replace(t.definition,t.proname,'_historical_import_entity_guard_v4');
  n:=n+1;
 END LOOP;
 IF n<>10 THEN RAISE EXCEPTION 'settlement_trigger_count: %',n; END IF;
END $triggers$;
DROP FUNCTION public._historical_import_entity_guard_v3();
REVOKE ALL ON FUNCTION public._historical_import_entity_guard_v4() FROM PUBLIC,anon,authenticated,service_role;
