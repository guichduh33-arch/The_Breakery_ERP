-- Lecture POS : même priorité de prix que le paiement, sans ouvrir les helpers internes.
CREATE FUNCTION public.get_pos_product_price_v1(p_product_id uuid,p_customer_id uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_price numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.request_has_active_pin_session_v1() THEN
  RAISE EXCEPTION 'active_pin_session_required' USING ERRCODE='42501';
 END IF;
 IF NOT (public.has_permission(auth.uid(),'customers.read') OR public.has_permission(auth.uid(),'pos.sale.create')) THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id AND deleted_at IS NULL) THEN
  RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
 END IF;
 IF p_customer_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_customer_id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'customer_not_found' USING ERRCODE='P0002';
  END IF;
 END IF;
 v_price:=public._resolve_b2b_line_price_v1(p_customer_id,p_product_id);
 IF v_price IS NULL OR v_price<0 OR v_price::text IN ('NaN','Infinity','-Infinity') THEN
  RAISE EXCEPTION 'invalid_product_price' USING ERRCODE='22023';
 END IF;
 RETURN v_price;
END $$;
REVOKE ALL ON FUNCTION public.get_pos_product_price_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_pos_product_price_v1(uuid,uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
