-- Relevés de fin de journée append-only, distincts de l'opname qui régularise.
CREATE TABLE public.display_day_closings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_day date NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 supersedes_id uuid REFERENCES public.display_day_closings(id),
 recorded_by uuid NOT NULL REFERENCES public.user_profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT now(),
 correction_reason text,
 idempotency_key uuid NOT NULL UNIQUE,
 request jsonb NOT NULL,
 UNIQUE(business_day,revision),
 CHECK((revision=1 AND supersedes_id IS NULL AND correction_reason IS NULL)
  OR (revision>1 AND supersedes_id IS NOT NULL AND length(btrim(correction_reason))>=3))
);
CREATE TABLE public.display_day_closing_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 closing_id uuid NOT NULL REFERENCES public.display_day_closings(id),
 product_id uuid NOT NULL REFERENCES public.products(id),
 remaining_qty numeric(10,3) NOT NULL CHECK(remaining_qty>=0),
 waste_qty numeric(10,3) NOT NULL CHECK(waste_qty>=0),
 waste_reason text,
 reference_basis text NOT NULL CHECK(reference_basis IN('general','fresh_production','display')),
 expected_qty numeric(10,3) NOT NULL,
 waste_declaration_id uuid REFERENCES public.stock_declarations(id),
 UNIQUE(closing_id,product_id),
 CHECK((waste_qty=0 AND waste_declaration_id IS NULL)
  OR (waste_qty>0 AND waste_declaration_id IS NOT NULL AND length(btrim(waste_reason))>=3))
);
ALTER TABLE public.display_day_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.display_day_closing_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.display_day_closings,public.display_day_closing_items FROM PUBLIC,anon,authenticated;

CREATE FUNCTION stock_private.reject_display_count_rewrite_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 RAISE EXCEPTION 'display_count_is_immutable' USING ERRCODE='55000';
END $$;
REVOKE ALL ON FUNCTION stock_private.reject_display_count_rewrite_v1() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER display_day_closings_immutable BEFORE UPDATE OR DELETE ON public.display_day_closings
 FOR EACH ROW EXECUTE FUNCTION stock_private.reject_display_count_rewrite_v1();
CREATE TRIGGER display_day_closing_items_immutable BEFORE UPDATE OR DELETE ON public.display_day_closing_items
 FOR EACH ROW EXECUTE FUNCTION stock_private.reject_display_count_rewrite_v1();

-- Les opérations de caisse peuvent relire leurs propres reçus ouverts pour confirmer un paiement.
ALTER POLICY confidentiality_order_payments ON public.order_payments USING(
 public.can_view_financial_shift_v1(session_id) OR (
 public.get_current_role()<>'ADMIN' AND public.has_permission(auth.uid(),'pos.sale.create') AND EXISTS(SELECT 1 FROM public.pos_sessions s
  WHERE s.id=session_id AND s.opened_by=public.get_current_profile_id())));
ALTER POLICY confidentiality_cash_movements ON public.cash_movements USING(
 public.can_view_financial_shift_v1(session_id) OR (
 public.get_current_role()<>'ADMIN' AND public.has_permission(auth.uid(),'pos.sale.create') AND created_by=public.get_current_profile_id()));
CREATE POLICY confidentiality_session_cash ON public.pos_sessions AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_financial_shift_v1(id) OR (
  public.get_current_role()<>'ADMIN' AND opened_by=public.get_current_profile_id()
  AND public.has_permission(auth.uid(),'pos.session.open')));

CREATE POLICY confidentiality_shift_treasury ON public.shift_cash_treasury AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_financial_shift_v1(session_id));
CREATE POLICY confidentiality_refunds ON public.refunds AS RESTRICTIVE FOR SELECT TO authenticated
 USING(public.can_view_financial_shift_v1(coalesce(payment_session_id,session_id)) OR (
  public.get_current_role()<>'ADMIN' AND public.has_permission(auth.uid(),'pos.sale.create')
  AND EXISTS(SELECT 1 FROM public.pos_sessions s WHERE s.id=coalesce(payment_session_id,session_id)
   AND s.opened_by=public.get_current_profile_id())));
CREATE POLICY confidentiality_refund_payments ON public.refund_payments AS RESTRICTIVE FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.refunds r WHERE r.id=refund_id));

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
