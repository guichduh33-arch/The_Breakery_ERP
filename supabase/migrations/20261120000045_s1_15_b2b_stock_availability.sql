-- Contrôle informatif demandé par Mamat le 2026-11-20 : une pénurie avertit à
-- la création, elle bloque uniquement le retrait. Aucune quantité n'est exposée.
CREATE FUNCTION public.check_b2b_stock_availability_v1(p_items jsonb) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE
 v_available boolean;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
 IF NOT public.has_permission(auth.uid(),'b2b.order.create') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='P0003';
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0
   OR jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'items_required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) AS x(product_id uuid,quantity numeric)
   WHERE product_id IS NULL OR quantity IS NULL OR quantity<=0
    OR quantity::text IN ('NaN','Infinity','-Infinity') OR quantity<>round(quantity,3)) THEN
  RAISE EXCEPTION 'invalid_quantity_or_product';
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) AS x(product_id uuid)
   LEFT JOIN public.products p ON p.id=x.product_id WHERE p.id IS NULL OR p.deleted_at IS NOT NULL) THEN
  RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
 END IF;
 WITH lines AS MATERIALIZED (
  SELECT x.product_id,x.quantity,coalesce(p.track_inventory,true) tracked,p.deduct_stock
  FROM jsonb_to_recordset(p_items) AS x(product_id uuid,quantity numeric)
  JOIN public.products p ON p.id=x.product_id
 ), needs AS (
  SELECT product_id,quantity FROM lines WHERE tracked
  UNION ALL
  SELECT c.product_id,c.qty_base FROM (SELECT * FROM lines WHERE NOT tracked AND deduct_stock) l
   CROSS JOIN LATERAL public._resolve_recipe_consumption_v2(l.product_id,l.quantity) c
 ), totals AS (
  SELECT product_id,sum(quantity) quantity FROM needs GROUP BY product_id
 ) SELECT coalesce(bool_and(NOT coalesce(p.track_inventory,true) OR coalesce(p.current_stock,0)>=t.quantity),true)
  INTO v_available FROM totals t JOIN public.products p ON p.id=t.product_id;
 RETURN jsonb_build_object('available',v_available);
END $function$;
REVOKE ALL ON FUNCTION public.check_b2b_stock_availability_v1(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.check_b2b_stock_availability_v1(jsonb) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
