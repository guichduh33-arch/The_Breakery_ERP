-- 20260710000082_void_order_rpc_v4_idempotency.sql
-- S55 P1.5 (audit T7) : idempotency EF-retry-safety (flavor 1 S25) sur le void.
-- Réplique le précédent refund_order_rpc_v2 (20260517000014) : lookup
-- refunds.idempotency_key en tête, INSERT avec la clé, catch unique_violation.
DROP FUNCTION IF EXISTS public.void_order_rpc_v3(uuid, text, uuid, uuid);

CREATE FUNCTION public.void_order_rpc_v4(
  p_order_id uuid, p_reason text, p_authorized_by uuid,
  p_acting_auth_user_id uuid, p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID; v_profile_id UUID; v_order RECORD; v_open_session UUID; v_item RECORD;
  v_loyalty_now INTEGER; v_refund_id UUID; v_refund_number TEXT; v_seq_number INTEGER; v_pay RECORD;
  v_comp JSONB; v_comp_qty NUMERIC; v_ing RECORD; v_existing RECORD;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;

  -- v4 idempotency replay : même clé → renvoyer l'enveloppe du premier void.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded
      INTO v_existing
      FROM refunds r
      WHERE r.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.order_id,
        'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
        'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
        'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
        'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                      FROM refund_payments WHERE refund_id = v_existing.id),
        'idempotent_replay', true);
    END IF;
  END IF;

  IF p_authorized_by IS NULL THEN RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003'; END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.void') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.void' USING ERRCODE = 'P0003'; END IF;
  IF length(coalesce(p_reason,'')) < 3 THEN RAISE EXCEPTION 'Reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  IF v_order.status <> 'paid' THEN RAISE EXCEPTION 'Cannot void % order (only paid orders)', v_order.status USING ERRCODE = 'check_violation'; END IF;
  SELECT id INTO v_open_session FROM pos_sessions WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001'; END IF;
  IF v_order.session_id <> v_open_session THEN RAISE EXCEPTION 'Cross-shift void not allowed in v1' USING ERRCODE = 'P0011'; END IF;

  UPDATE orders SET status='voided', voided_at=now(), voided_by=p_authorized_by, void_reason=p_reason, updated_at=now() WHERE id = p_order_id;

  FOR v_item IN SELECT oi.id, oi.product_id, oi.quantity, oi.combo_components, oi.modifier_ingredients_deducted, p.product_type AS ptype
                FROM order_items oi JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = p_order_id AND oi.is_cancelled = false LOOP
    IF v_item.ptype = 'combo' THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(COALESCE(v_item.combo_components, '[]'::jsonb)) LOOP
        v_comp_qty := (v_comp->>'quantity')::NUMERIC * v_item.quantity;
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
        SELECT (v_comp->>'product_id')::UUID, 'sale_void', v_comp_qty, COALESCE(p.unit, 'pcs'), 'orders', p_order_id, v_profile_id
        FROM products p WHERE p.id = (v_comp->>'product_id')::UUID;
        UPDATE products SET current_stock = current_stock + v_comp_qty, updated_at = now() WHERE id = (v_comp->>'product_id')::UUID;
        IF (SELECT is_display_item FROM products WHERE id = (v_comp->>'product_id')::UUID) THEN
          INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
            VALUES ((v_comp->>'product_id')::UUID, 'adjustment', v_comp_qty, 'Order voided — combo display restore', 'order', p_order_id, v_profile_id);
          UPDATE display_stock SET quantity = quantity + v_comp_qty, updated_at = now() WHERE product_id = (v_comp->>'product_id')::UUID;
        END IF;
      END LOOP;
    ELSE
      INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
      SELECT v_item.product_id, 'sale_void', v_item.quantity, COALESCE(p.unit, 'pcs'), 'orders', p_order_id, v_profile_id
      FROM products p WHERE p.id = v_item.product_id;
      UPDATE products SET current_stock = current_stock + v_item.quantity, updated_at = now() WHERE id = v_item.product_id;
      IF (SELECT is_display_item FROM products WHERE id = v_item.product_id) THEN
        INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
          VALUES (v_item.product_id, 'adjustment', v_item.quantity, 'Order voided — display restore', 'order', p_order_id, v_profile_id);
        UPDATE display_stock SET quantity = quantity + v_item.quantity, updated_at = now() WHERE product_id = v_item.product_id;
      END IF;
    END IF;

    -- Phase 2: restore the persisted modifier ingredients for this line (full void).
    IF v_item.modifier_ingredients_deducted IS NOT NULL THEN
      FOR v_ing IN SELECT * FROM jsonb_to_recordset(v_item.modifier_ingredients_deducted)
        AS x(product_id UUID, qty_base NUMERIC, unit TEXT, group_name TEXT, option_label TEXT) LOOP
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
          VALUES (v_ing.product_id, 'sale_void', v_ing.qty_base, COALESCE(v_ing.unit, 'pcs'), 'orders', p_order_id, v_profile_id);
        UPDATE products SET current_stock = current_stock + v_ing.qty_base, updated_at = now() WHERE id = v_ing.product_id;
        IF (SELECT is_display_item FROM products WHERE id = v_ing.product_id) THEN
          INSERT INTO display_movements (product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
            VALUES (v_ing.product_id, 'adjustment', v_ing.qty_base,
                    'Order voided — modifier restore: ' || v_ing.group_name || ' / ' || v_ing.option_label, 'order', p_order_id, v_profile_id);
          UPDATE display_stock SET quantity = quantity + v_ing.qty_base, updated_at = now() WHERE product_id = v_ing.product_id;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    UPDATE customers SET loyalty_points = GREATEST(0, loyalty_points - v_order.loyalty_points_earned),
      lifetime_points = GREATEST(0, lifetime_points - v_order.loyalty_points_earned),
      total_spent = GREATEST(0, total_spent - v_order.total), updated_at = now()
    WHERE id = v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)
    VALUES (v_order.customer_id, p_order_id, 'refund', -v_order.loyalty_points_earned, v_loyalty_now, 'Reversal: void order ' || v_order.order_number, v_profile_id);
  END IF;
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_redeemed > 0 THEN
    UPDATE customers SET loyalty_points = loyalty_points + v_order.loyalty_points_redeemed, updated_at = now()
    WHERE id = v_order.customer_id RETURNING loyalty_points INTO v_loyalty_now;
    INSERT INTO loyalty_transactions (customer_id, order_id, transaction_type, points, points_balance_after, description, created_by)
    VALUES (v_order.customer_id, p_order_id, 'refund', v_order.loyalty_points_redeemed, v_loyalty_now, 'Restored redemption: void order ' || v_order.order_number, v_profile_id);
  END IF;

  INSERT INTO refund_sequences (date, last_number) VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE SET last_number = refund_sequences.last_number + 1 RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');
  BEGIN
    INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void, idempotency_key)
    VALUES (v_refund_number, p_order_id, v_open_session, v_order.total, v_order.tax_amount, p_reason, v_profile_id, p_authorized_by, true, p_idempotency_key)
    RETURNING id INTO v_refund_id;
  EXCEPTION WHEN unique_violation THEN
    -- Un void concurrent avec la même clé a gagné : rejouer le lookup et sortir.
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded INTO v_existing
      FROM refunds r WHERE r.idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'order_id', v_existing.order_id,
      'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
      'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
      'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
      'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                    FROM refund_payments WHERE refund_id = v_existing.id),
      'idempotent_replay', true);
  END;
  INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
  SELECT v_refund_id, id, quantity, line_total FROM order_items WHERE order_id = p_order_id AND is_cancelled = false;
  FOR v_pay IN SELECT method, amount, reference FROM order_payments WHERE order_id = p_order_id LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference) VALUES (v_refund_id, v_pay.method, v_pay.amount, v_pay.reference);
  END LOOP;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.void', 'orders', p_order_id, jsonb_build_object(
    'order_number', v_order.order_number, 'total_voided', v_order.total, 'reason', p_reason,
    'authorized_by', p_authorized_by, 'acting_cashier_id', v_profile_id, 'refund_id', v_refund_id, 'refund_number', v_refund_number));
  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number, 'refund_id', v_refund_id,
    'refund_number', v_refund_number, 'total_refunded', v_order.total, 'tax_refunded', v_order.tax_amount,
    'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount)) FROM refund_payments WHERE refund_id = v_refund_id));
END $function$;

REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM anon;
-- Nouvelle signature = ACL fraîche ; pas de default-privilege revoke pour
-- authenticated (S20 ne couvre que PUBLIC/anon) — cf. incident 20260709000010.
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) TO service_role;
