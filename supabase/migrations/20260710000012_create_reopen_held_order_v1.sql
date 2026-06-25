-- 20260710000012_create_reopen_held_order_v1.sql
-- Spec A, Bloc 3 — reopen a held FIRED order without deleting it. Returns the
-- cart payload (items carry order_items.id + is_locked + kitchen_status so the
-- client rehydrates the lock/print state) and CLAIMS the order by setting
-- is_held=false (prevents two terminals opening the same addition). Keeps
-- status='pending_payment'. Gate: pos.sale.create. REVOKE pair S25.
CREATE OR REPLACE FUNCTION public.reopen_held_order_v1(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_order         RECORD;
  v_items         JSONB;
  v_actor_profile UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- Claim: only a currently-held, pending_payment order can be reopened. A 2nd
  -- concurrent reopen sees is_held already false → 0 rows → P0002 ("already open").
  UPDATE orders
     SET is_held = false
   WHERE id = p_order_id
     AND is_held = true
     AND status = 'pending_payment'
   RETURNING id, order_number, order_type, customer_id, table_number, notes
     INTO v_order;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found_or_already_open' USING ERRCODE = 'P0002';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id',             oi.id,
           'product_id',     oi.product_id,
           'name',           oi.name_snapshot,
           'unit_price',     oi.unit_price,
           'quantity',       oi.quantity,
           'modifiers',      COALESCE(oi.modifiers, '[]'::jsonb),
           'is_locked',      oi.is_locked,
           'kitchen_status', oi.kitchen_status
         ) ORDER BY oi.created_at)
    INTO v_items
  FROM order_items oi WHERE oi.order_id = p_order_id;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.reopened', 'orders', p_order_id, '{}'::jsonb);

  RETURN jsonb_build_object(
    'order_id',    v_order.id,
    'order_number',v_order.order_number,
    'order_type',  v_order.order_type,
    'customerId',  v_order.customer_id,
    'tableNumber', v_order.table_number,
    'notes',       v_order.notes,
    'items',       COALESCE(v_items, '[]'::jsonb)
  );
END $function$;

REVOKE EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.reopen_held_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
