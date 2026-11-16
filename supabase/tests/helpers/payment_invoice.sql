-- Métadonnées Storage SIMULÉES pour les anciennes suites de comptabilité.
-- Aucun octet n'est uploadé. Ne pas inclure ce helper dans les tests de refus de facture.
-- Les triggers de fixture vivent uniquement dans BEGIN/ROLLBACK ; les vrais gardes restent actifs.
CREATE FUNCTION pg_temp.payment_invoice_fixture(p_kind text,p_id uuid,p_owner_auth uuid DEFAULT auth.uid())
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v_bucket text; v_path text; v_owner uuid:=COALESCE(p_owner_auth,gen_random_uuid());
BEGIN
 IF p_id IS NULL OR p_kind NOT IN ('expense','purchase_order') THEN
  RAISE EXCEPTION 'invalid_invoice_fixture'; END IF;
 v_bucket:=CASE p_kind WHEN 'expense' THEN 'expense-receipts' ELSE 'purchase-invoices' END;
 v_path:=CASE p_kind WHEN 'expense' THEN 'expenses/' ELSE 'purchase-orders/' END||p_id||'/'||gen_random_uuid()||'.pdf';
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata)
  VALUES(v_bucket,v_path,v_owner::text,jsonb_build_object('mimetype','application/pdf','size',7));
 RETURN v_path;
END $$;

CREATE FUNCTION pg_temp.expense_invoice_fixture_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.receipt_url IS NULL THEN
  NEW.receipt_url:=pg_temp.payment_invoice_fixture('expense',NEW.id,
   COALESCE(auth.uid(),(SELECT auth_user_id FROM public.user_profiles WHERE id=NEW.created_by)));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_fixture_before_validation BEFORE INSERT ON public.expenses
 FOR EACH ROW EXECUTE FUNCTION pg_temp.expense_invoice_fixture_before_insert();

CREATE FUNCTION pg_temp.po_invoice_fixture_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.purchase_orders SET invoice_path=pg_temp.payment_invoice_fixture('purchase_order',NEW.id,
  COALESCE(auth.uid(),(SELECT auth_user_id FROM public.user_profiles WHERE id=NEW.created_by))) WHERE id=NEW.id;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_fixture_after_insert AFTER INSERT ON public.purchase_orders
 FOR EACH ROW EXECUTE FUNCTION pg_temp.po_invoice_fixture_after_insert();
