-- Toute nouvelle dépense réglée/importée après le seuil doit porter son justificatif.
CREATE FUNCTION public._guard_expense_payment_invoice_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_previous_status text;
BEGIN
 IF TG_OP='UPDATE' THEN v_previous_status:=OLD.status; END IF;
 IF NEW.status='approved' AND v_previous_status IS DISTINCT FROM 'approved' AND NEW.payment_method='cash'
  AND NOT NEW.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'expense-receipts',NEW.receipt_url,'expenses/'||NEW.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_approval' USING ERRCODE='22023';
 END IF;
 IF NEW.status='paid' AND v_previous_status IS DISTINCT FROM 'paid' AND NOT NEW.invoice_exempt
  AND NOT public._payment_invoice_valid_v1('expense-receipts',NEW.receipt_url,'expenses/'||NEW.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER invoice_required_before_payment ON public.expenses;
CREATE TRIGGER invoice_required_before_payment BEFORE INSERT OR UPDATE OF status ON public.expenses
 FOR EACH ROW EXECUTE FUNCTION public._guard_expense_payment_invoice_v2();
DROP FUNCTION public._guard_expense_payment_invoice_v1();
REVOKE ALL ON FUNCTION public._guard_expense_payment_invoice_v2() FROM PUBLIC,anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
