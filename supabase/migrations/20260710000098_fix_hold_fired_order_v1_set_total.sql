-- 20260710000098_fix_hold_fired_order_v1_set_total.sql
-- Spec A fix — held FIRED orders showed no amount in the Held Orders list.
-- Root cause: fire_counter_order_v4 inserts the order with total=0 (the total is
-- only computed at payment by pay_existing_order (v11 as of S53)), so the held list — which
-- reads orders.total — rendered "—" for parked fired orders. Draft held orders
-- work because hold_order_v1 already writes total = SUM(line_total).
--
-- Fix: when parking a fired order, recompute subtotal = total = SUM(line_total)
-- (mirrors pay_existing_order's authoritative v_items_total).
-- Display-only — payment overwrites both columns with the tax/promo-adjusted
-- figures. Same signature as the original _v1 (additive body change via
-- CREATE OR REPLACE, re-applies the June 2026 body already live on V3 dev). REVOKE pair unchanged.
CREATE OR REPLACE FUNCTION public.hold_fired_order_v1(p_order_id UUID)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_actor_profile UUID;
  v_items_total   DECIMAL(14,2);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'pos.sale.create') THEN
    RAISE EXCEPTION 'Permission denied: pos.sale.create' USING ERRCODE = 'P0003';
  END IF;

  -- Compute the items total so the held list can display an amount for the
  -- parked fired order (orders.total was 0 from fire_counter_order_v4).
  SELECT COALESCE(SUM(line_total), 0) INTO v_items_total
    FROM order_items WHERE order_id = p_order_id;

  UPDATE orders
     SET is_held  = true,
         subtotal = v_items_total,
         total    = v_items_total
   WHERE id = p_order_id
     AND status = 'pending_payment'
     AND created_via = 'pos';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'fired_order_not_found_or_not_holdable' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_actor_profile
    FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'order.held', 'orders', p_order_id, '{}'::jsonb);
END $function$;

REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.hold_fired_order_v1(UUID) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
