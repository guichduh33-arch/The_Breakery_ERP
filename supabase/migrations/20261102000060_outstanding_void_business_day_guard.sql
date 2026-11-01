CREATE OR REPLACE FUNCTION public._guard_pos_outstanding_v3()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_order uuid;
BEGIN
  IF TG_TABLE_NAME='order_items' THEN
    v_order:=CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END;
    IF EXISTS(SELECT 1 FROM orders WHERE id=v_order AND outstanding_at IS NOT NULL) THEN
      IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
      IF (to_jsonb(NEW)-ARRAY['kitchen_status','is_locked','sent_to_kitchen_at','updated_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['kitchen_status','is_locked','sent_to_kitchen_at','updated_at']) THEN
        RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
    END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF OLD.outstanding_at IS NOT NULL THEN
    -- Une annulation tardive effacerait une vente déjà déclarée : utiliser un remboursement.
    IF NEW.status='voided' AND OLD.status<>'voided' AND OLD.outstanding_at::date<>current_date THEN
      RAISE EXCEPTION 'outstanding_prior_day_requires_refund' USING ERRCODE='23514';
    END IF;
    IF (NEW.total,NEW.subtotal,NEW.tax_amount,NEW.customer_id,NEW.session_id,NEW.order_type,NEW.outstanding_at,
        NEW.discount_amount,NEW.loyalty_redemption_amount)
      IS DISTINCT FROM (OLD.total,OLD.subtotal,OLD.tax_amount,OLD.customer_id,OLD.session_id,OLD.order_type,OLD.outstanding_at,
        OLD.discount_amount,OLD.loyalty_redemption_amount) THEN
      RAISE EXCEPTION 'outstanding_invoice_sealed' USING ERRCODE='23514'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      AND NOT (OLD.status='paid' AND NEW.status='completed')
      AND coalesce(current_setting('breakery.outstanding_settlement',true),'')<>'true'
      AND NOT (NEW.status='voided' AND coalesce(current_setting('breakery.outstanding_reversal',true),'')=OLD.id::text) THEN
      RAISE EXCEPTION 'outstanding_requires_settlement' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $function$
;
REVOKE ALL ON FUNCTION public._guard_pos_outstanding_v3() FROM PUBLIC,anon,authenticated;
DROP TRIGGER guard_pos_outstanding_order ON public.orders;
DROP TRIGGER guard_pos_outstanding_items ON public.order_items;
CREATE TRIGGER guard_pos_outstanding_order BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public._guard_pos_outstanding_v3();
CREATE TRIGGER guard_pos_outstanding_items BEFORE INSERT OR UPDATE OR DELETE ON public.order_items FOR EACH ROW EXECUTE FUNCTION public._guard_pos_outstanding_v3();
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
