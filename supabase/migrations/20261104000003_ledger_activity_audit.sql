-- Traces complémentaires des opérations déjà persistées dans leurs ledgers.
-- L'ajout d'audit opname a été explicitement autorisé le 04/11/2026.
CREATE TRIGGER audit_opname_item_changes AFTER INSERT OR UPDATE ON public.inventory_count_items
FOR EACH ROW EXECUTE FUNCTION public.audit_business_row_change_v1('opname_item',
  'id,count_id,product_id,counted_qty,counted_by,unit,notes');

CREATE FUNCTION public.audit_cost_correction_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (NEW.created_by, 'product.cost_corrected', 'product', NEW.product_id,
    jsonb_build_object('movement_id', NEW.id, 'reason', NEW.reason),
    jsonb_build_object('before', NEW.metadata->'old_cost', 'after', NEW.metadata->'new_cost'));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_cost_correction_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_cost_correction AFTER INSERT ON public.stock_movements
FOR EACH ROW WHEN (NEW.movement_type = 'cost_price_correction')
EXECUTE FUNCTION public.audit_cost_correction_v1();

CREATE FUNCTION public.audit_store_credit_expiry_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata, payload)
  VALUES (NULL, 'customer.store_credit_expired', 'customer', NEW.customer_id,
    jsonb_build_object('ledger_id', NEW.id, 'amount', -NEW.delta, 'credit_id', NEW.reference_id),
    jsonb_build_object('balance_after', NEW.balance_after));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.audit_store_credit_expiry_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER audit_store_credit_expiry AFTER INSERT ON public.customer_store_credit_ledger
FOR EACH ROW WHEN (NEW.source = 'expiry')
EXECUTE FUNCTION public.audit_store_credit_expiry_v1();
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
