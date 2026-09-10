-- Audit POS : identité stable et lecture cohérente des commandes.
ALTER TABLE public.order_items ADD COLUMN client_line_id text;
CREATE UNIQUE INDEX order_items_client_line_id_idx ON public.order_items(order_id, client_line_id)
  WHERE client_line_id IS NOT NULL;

CREATE FUNCTION public.get_pos_order_snapshot_v1(p_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (
    has_permission(auth.uid(), 'pos.sale.create') OR has_permission(auth.uid(), 'sales.create')
  ) THEN RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501'; END IF;
  SELECT jsonb_build_object(
    'order_id', o.id, 'order_number', o.order_number, 'order_type', o.order_type,
    'created_via', o.created_via, 'customerId', o.customer_id,
    'tableNumber', o.table_number, 'notes', o.notes,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'client_line_id', i.client_line_id, 'product_id', i.product_id,
        'name', i.name_snapshot, 'unit_price', i.unit_price, 'quantity', i.quantity,
        'line_total', i.line_total, 'discount_amount', i.discount_amount,
        'discount_reason', i.discount_reason, 'modifiers', i.modifiers,
        'combo_components', i.combo_components, 'product_type', p.product_type,
        'is_cancelled', i.is_cancelled, 'is_locked', i.is_locked,
        'kitchen_status', i.kitchen_status
      ) ORDER BY i.created_at, i.id)
      FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id
    ), '[]'::jsonb)
  ) INTO v_result FROM orders o WHERE o.id = p_order_id;
  IF v_result IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_pos_order_snapshot_v1(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pos_order_snapshot_v1(uuid) TO authenticated, service_role;
