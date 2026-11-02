-- Exemption figée : date réelle d'import, strictement avant le 31 octobre à Makassar.
ALTER TABLE public.purchase_orders ADD COLUMN invoice_path text;
ALTER TABLE public.purchase_orders ADD COLUMN invoice_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE public.expenses ADD COLUMN invoice_exempt boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.purchase_orders.invoice_exempt IS 'Exemption figée des imports effectués avant 2026-10-31 00:00 Asia/Makassar, sur registre serveur.';
COMMENT ON COLUMN public.expenses.invoice_exempt IS 'Exemption figée des imports effectués avant 2026-10-31 00:00 Asia/Makassar, avec preuve serveur.';

CREATE FUNCTION public._imported_before_invoice_cutoff_v1(p_kind text,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE p_kind WHEN 'purchase_order' THEN EXISTS(
  SELECT 1 FROM public.purchase_orders p JOIN public.historical_import_documents d ON p.financial_import_document_id=d.id
   JOIN public.historical_import_runs r ON r.id=d.run_id
  WHERE p.id=p_id AND d.entity_id=p.id AND d.kind='purchases' AND r.kind=d.kind
   AND r.source_system=d.source_system AND r.status='applied'
   AND d.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar'
   AND r.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar')
 WHEN 'expense' THEN EXISTS(SELECT 1 FROM public.expenses e WHERE e.id=p_id AND e.is_historical_import
  AND e.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar'
  AND (EXISTS(SELECT 1 FROM public.cash_journal_import_rows c WHERE c.expense_id=e.id
    AND c.created_at < TIMESTAMP '2026-10-31 00:00' AT TIME ZONE 'Asia/Makassar')
   OR EXISTS(SELECT 1 FROM public.audit_logs a WHERE a.action='expenses.imported'
    AND a.actor_id=e.created_by AND a.created_at=e.created_at
    AND (a.entity_id=e.id OR (a.entity_id IS NULL AND e.expense_number LIKE 'IMP-EXP-%')))))
 ELSE false END
$$;
REVOKE ALL ON FUNCTION public._imported_before_invoice_cutoff_v1(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Le garde historique interdit normalement toute mise à jour hors contexte d'import.
ALTER TABLE public.purchase_orders DISABLE TRIGGER financial_import_entity_guard;
UPDATE public.purchase_orders p SET invoice_exempt=true
WHERE public._imported_before_invoice_cutoff_v1('purchase_order',p.id);
ALTER TABLE public.purchase_orders ENABLE TRIGGER financial_import_entity_guard;
UPDATE public.expenses e SET invoice_exempt=true
WHERE public._imported_before_invoice_cutoff_v1('expense',e.id);

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('expense-receipts','expense-receipts',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf']),
 ('purchase-invoices','purchase-invoices',false,5242880,ARRAY['image/jpeg','application/pdf'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,
 allowed_mime_types=EXCLUDED.allowed_mime_types;

-- Une ancienne image reste téléchargeable/rejouable, mais seul JPEG/PDF justifie un paiement.
CREATE FUNCTION public._payment_invoice_valid_v1(p_bucket text,p_path text,p_prefix text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p_path IS NOT NULL AND left(p_path,length(p_prefix))=p_prefix AND EXISTS(
  SELECT 1 FROM storage.objects o WHERE o.bucket_id=p_bucket AND o.name=p_path
   AND o.archived_at IS NULL AND NOT COALESCE(o.is_delete_marker,false)
   AND CASE WHEN COALESCE(o.metadata->>'size','') ~ '^[0-9]+$'
     THEN (o.metadata->>'size')::numeric BETWEEN 1 AND 5242880 ELSE false END
   AND ((o.metadata->>'mimetype'='application/pdf' AND p_path ~ '[.]pdf$')
     OR (o.metadata->>'mimetype'='image/jpeg' AND p_path ~ '[.](jpg|jpeg)$')))
$$;
REVOKE ALL ON FUNCTION public._payment_invoice_valid_v1(text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._guard_invoice_fields_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF (TG_OP='INSERT' AND NEW.invoice_exempt) OR
    (TG_OP='UPDATE' AND NEW.invoice_exempt IS DISTINCT FROM OLD.invoice_exempt) THEN
  RAISE EXCEPTION 'invoice_exemption_immutable' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='purchase_orders' THEN
  IF TG_OP='INSERT' AND NEW.invoice_path IS NOT NULL THEN
   RAISE EXCEPTION 'invoice_requires_saved_order' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' AND NEW.invoice_path IS DISTINCT FROM OLD.invoice_path THEN
   IF current_user NOT IN ('postgres','service_role') THEN
    RAISE EXCEPTION 'invoice_requires_rpc' USING ERRCODE='42501';
   END IF;
   IF OLD.invoice_path IS NOT NULL AND EXISTS(SELECT 1 FROM public.purchase_payments WHERE purchase_order_id=OLD.id) THEN
    RAISE EXCEPTION 'invoice_locked_after_payment' USING ERRCODE='22023';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_fields_guard BEFORE INSERT OR UPDATE ON public.purchase_orders
 FOR EACH ROW EXECUTE FUNCTION public._guard_invoice_fields_v1();
CREATE TRIGGER invoice_fields_guard BEFORE INSERT OR UPDATE ON public.expenses
 FOR EACH ROW EXECUTE FUNCTION public._guard_invoice_fields_v1();
REVOKE ALL ON FUNCTION public._guard_invoice_fields_v1() FROM PUBLIC,anon,authenticated,service_role;

-- Point commun aux paiements manuels, aux acomptes et au paiement cash à réception.
CREATE FUNCTION public._guard_po_payment_invoice_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.purchase_orders%ROWTYPE;
BEGIN
 SELECT * INTO p FROM public.purchase_orders WHERE id=NEW.purchase_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT p.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'purchase-invoices',p.invoice_path,'purchase-orders/'||p.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_required_before_payment BEFORE INSERT ON public.purchase_payments
 FOR EACH ROW EXECUTE FUNCTION public._guard_po_payment_invoice_v1();
REVOKE ALL ON FUNCTION public._guard_po_payment_invoice_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._guard_expense_payment_invoice_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.status='approved' AND OLD.status IS DISTINCT FROM 'approved' AND NEW.payment_method='cash'
  AND NOT NEW.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'expense-receipts',NEW.receipt_url,'expenses/'||NEW.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_approval' USING ERRCODE='22023';
 END IF;
 IF NEW.status='paid' AND OLD.status IS DISTINCT FROM 'paid' AND NOT NEW.invoice_exempt
  AND NOT public._payment_invoice_valid_v1('expense-receipts',NEW.receipt_url,'expenses/'||NEW.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_required_before_payment BEFORE UPDATE OF status ON public.expenses
 FOR EACH ROW EXECUTE FUNCTION public._guard_expense_payment_invoice_v1();
REVOKE ALL ON FUNCTION public._guard_expense_payment_invoice_v1() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._guard_expense_approval_invoice_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.expenses%ROWTYPE;
BEGIN
 SELECT * INTO e FROM public.expenses WHERE id=NEW.expense_id FOR UPDATE;
 IF e.payment_method='cash' AND NOT e.invoice_exempt AND NOT public._payment_invoice_valid_v1(
  'expense-receipts',e.receipt_url,'expenses/'||e.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_approval' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_required_before_approval BEFORE INSERT ON public.expense_approvals
 FOR EACH ROW EXECUTE FUNCTION public._guard_expense_approval_invoice_v1();
REVOKE ALL ON FUNCTION public._guard_expense_approval_invoice_v1() FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
