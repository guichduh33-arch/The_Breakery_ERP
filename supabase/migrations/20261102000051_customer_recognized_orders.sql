-- Lecture financière de fiche client ; la projection privée n'est jamais exposée.
CREATE FUNCTION public.get_customer_recognized_orders_v1(p_customer_id uuid)
RETURNS TABLE(id uuid,recognized_at timestamptz,total numeric,order_type public.order_type,status public.order_status)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_permission(auth.uid(),'customers.read') THEN
  RAISE EXCEPTION 'permission denied: customers.read' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT o.id,o.recognized_at,o.total,o.order_type,o.status
 FROM reporting_private.recognized_sales_v1 o
 WHERE o.customer_id=p_customer_id ORDER BY o.recognized_at,o.id;
END $fn$;
REVOKE ALL ON FUNCTION public.get_customer_recognized_orders_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_customer_recognized_orders_v1(uuid) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
