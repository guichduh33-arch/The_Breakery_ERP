-- Corps live ; conversions cohérentes et fermeture des appelants versionnés.
CREATE OR REPLACE FUNCTION public.update_order_item_qty_v7(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid DEFAULT NULL::uuid, p_waste_qty numeric DEFAULT NULL::numeric, p_waste_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid(); v_order_id UUID; v_status TEXT; v_unit_price NUMERIC; v_is_locked BOOLEAN;
  v_old_qty NUMERIC; v_product_id UUID; v_combo JSONB; v_delta NUMERIC; v_waste NUMERIC;
  v_authorized_by UUID; v_profile_id UUID; v_replay JSONB; v_result JSONB;
  v_customer_id UUID; v_modifiers JSONB; v_is_gift BOOLEAN; v_product_type TEXT;
  v_old_line_total NUMERIC; v_old_mod_total NUMERIC;
  v_new_line_total NUMERIC; v_new_mod_total NUMERIC; v_new_modifiers JSONB;
  v_lp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v4 for 0)' USING ERRCODE = '22023'; END IF;
  SELECT oi.order_id, o.status, oi.unit_price, oi.is_locked, oi.quantity, oi.product_id, oi.combo_components,
         o.customer_id, oi.modifiers, COALESCE(oi.is_promo_gift, false), p.product_type::text,
         oi.line_total, oi.modifiers_total
    INTO v_order_id, v_status, v_unit_price, v_is_locked, v_old_qty, v_product_id, v_combo,
         v_customer_id, v_modifiers, v_is_gift, v_product_type,
         v_old_line_total, v_old_mod_total
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE oi.id = p_order_item_id FOR UPDATE OF oi, o;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF v_is_locked THEN
    IF p_qty >= v_old_qty THEN RAISE EXCEPTION 'Locked line: quantity can only decrease (add a new line to increase)' USING ERRCODE = 'check_violation'; END IF;
    v_delta := v_old_qty - p_qty;
    IF p_auth_id IS NULL THEN RAISE EXCEPTION 'Manager authorization required (locked line)' USING ERRCODE = 'P0003'; END IF;
    UPDATE discount_authorizations SET consumed_at = now(), consumed_order_id = v_order_id
     WHERE id = p_auth_id AND consumed_at IS NULL AND expires_at > now() AND scope = 'order_item_edit'
     RETURNING manager_profile_id INTO v_authorized_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired manager authorization' USING ERRCODE = 'P0003'; END IF;
    v_waste := COALESCE(p_waste_qty, v_delta);
    IF v_waste < 0 OR v_waste > v_delta THEN RAISE EXCEPTION 'Waste quantity must be between 0 and % (removed delta)', v_delta USING ERRCODE = 'check_violation'; END IF;
    IF length(coalesce(p_waste_reason, '')) < 3 THEN RAISE EXCEPTION 'Waste reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
    SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- ADR-013 D15/M2 -- pricing hybride :
  IF v_is_locked THEN
    -- Ligne firee : per-unit entierement GELE, simple re-echelonnage du persiste.
    -- (l'ancienne v3 `unit_price * qty` perdait la part modificateurs des lignes
    -- firees ; et une re-resolution pourrait echouer sur un modificateur
    -- desactive depuis le fire -- interdit de bloquer une baisse autorisee.)
    v_new_line_total := round_idr(v_old_line_total / v_old_qty * p_qty);
    v_new_mod_total  := CASE WHEN v_old_mod_total IS NULL THEN NULL ELSE round_idr(v_old_mod_total / v_old_qty * p_qty) END;
    v_new_modifiers  := v_modifiers;
  ELSIF v_product_type = 'combo' OR v_combo IS NOT NULL THEN
    -- Combo : unit_price persiste (inclut les surcharges de composition), pas de modifiers.
    v_new_line_total := round_idr(v_unit_price * p_qty);
    v_new_mod_total  := v_old_mod_total;
    v_new_modifiers  := v_modifiers;
  ELSE
    -- Ligne libre : unit_price persiste CONSERVE, modificateurs re-tarifes
    -- serveur (le price_adjustment du blob persiste n'est jamais cru).
    SELECT lp.modifiers_total, lp.modifiers_resolved INTO v_lp
      FROM _resolve_line_price_v2(v_product_id, p_qty::numeric, COALESCE(v_modifiers, '[]'::jsonb), v_customer_id, v_is_gift, false) lp;
    v_new_line_total := round_idr((v_unit_price + v_lp.modifiers_total) * p_qty);
    v_new_mod_total  := round_idr(v_lp.modifiers_total * p_qty);
    v_new_modifiers  := v_lp.modifiers_resolved;
  END IF;
  UPDATE order_items
     SET quantity = p_qty, line_total = v_new_line_total, modifiers_total = v_new_mod_total, modifiers = v_new_modifiers
   WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);
  IF v_is_locked AND v_waste > 0 THEN
    PERFORM _record_order_item_waste_v2(p_order_item_id, v_order_id, v_product_id, v_combo, v_waste, p_waste_reason, v_profile_id);
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.item.update_qty', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id, 'new_qty', p_qty, 'rpc_version', 'v7-recipe-units')
          || CASE WHEN v_is_locked THEN jsonb_build_object('is_locked', true, 'authorized_by', v_authorized_by, 'old_qty', v_old_qty, 'delta', v_delta, 'waste_qty', v_waste, 'waste_reason', p_waste_reason) ELSE '{}'::jsonb END);
  v_result := jsonb_build_object('order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = v_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'update_qty', v_order_id, v_result);
  RETURN v_result;
END;
$function$
;
REVOKE ALL ON FUNCTION public.update_order_item_qty_v7(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid, p_waste_qty numeric, p_waste_reason text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v7(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid, p_waste_qty numeric, p_waste_reason text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.update_order_item_qty_v6(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid, p_waste_qty numeric, p_waste_reason text);
