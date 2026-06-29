-- 20260710000068_cancel_b2b_order_v1.sql
-- S52 P1.2 (T5) — cancel an UNPAID b2b invoice: reverse JE + stock + AR balance, set voided.
-- Blocked if any allocation exists (decision D2). Idempotent via audit_logs replay.
-- Stock reversal uses movement_type='sale_void' (positive qty) — semantic inverse of the
-- 'sale' rows create_b2b_order writes, and exempt from the reason-required check constraint.

-- 1) Allow 'b2b_order_cancel' as a JE reference_type (mirror _060).
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_reference_type_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_reference_type_check
  CHECK (
    reference_type IS NULL OR reference_type = ANY (ARRAY[
      'sale','sale_void','sale_refund',
      'purchase','purchase_return','purchase_payment',
      'expense','expense_payment',
      'shift_close','adjustment','waste','opname','production','transfer','manual',
      'pos_outstanding','pos_outstanding_payment','stock_movement','void','refund','cash_movement',
      'b2b_order','b2b_payment','b2b_adjustment','b2b_order_cancel'
    ]::text[])
  );

-- 2) RPC
CREATE OR REPLACE FUNCTION public.cancel_b2b_order_v1(
  p_order_id uuid, p_reason text, p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_uid            uuid := auth.uid();
  v_profile_id     uuid;
  v_order          record;
  v_balance_before numeric(14,2);
  v_balance_after  numeric(14,2);
  v_je_id          uuid;
  v_entry_no       text;
  v_ar_id          uuid;
  v_revenue_id     uuid;
  v_now            timestamptz := now();
  v_existing       jsonb;
  v_line           record;
  v_cons           record;
  v_track          boolean;
  v_deduct         boolean;
  v_unit           text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE='P0001'; END IF;
  SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id=v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile_id IS NULL THEN RAISE EXCEPTION 'user_profile_not_found' USING ERRCODE='P0001'; END IF;
  IF NOT has_permission(v_uid, 'b2b.order.cancel') THEN
    RAISE EXCEPTION 'permission_denied: b2b.order.cancel' USING ERRCODE='P0003';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  -- Idempotency replay (mirror adjust_b2b_balance_v2).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT metadata INTO v_existing FROM audit_logs
     WHERE action='b2b.order.cancelled' AND metadata->>'idempotency_key'=p_idempotency_key::text LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', (v_existing->>'order_id')::uuid,
        'order_number', v_existing->>'order_number',
        'reversed_je_id', NULLIF(v_existing->>'reversed_je_id','')::uuid,
        'balance_after', (v_existing->>'balance_after')::numeric,
        'idempotent_replay', TRUE);
    END IF;
  END IF;

  SELECT id, order_number, customer_id, total, status, order_type
    INTO v_order FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE='P0002'; END IF;
  IF v_order.order_type <> 'b2b' THEN RAISE EXCEPTION 'not_a_b2b_order' USING ERRCODE='P0001'; END IF;
  IF v_order.status <> 'b2b_pending' THEN
    RAISE EXCEPTION 'order_not_cancellable (status: %)', v_order.status USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM b2b_payment_allocations WHERE invoice_id = p_order_id) THEN
    RAISE EXCEPTION 'order_has_payments' USING ERRCODE='P0011';
  END IF;

  -- Reverse stock flag-aware (mirror create_b2b_order_v1 _059, positive qty, sale_void).
  FOR v_line IN SELECT oi.product_id, oi.quantity FROM order_items oi WHERE oi.order_id = p_order_id LOOP
    SELECT track_inventory, deduct_stock, unit INTO v_track, v_deduct, v_unit
      FROM products WHERE id=v_line.product_id;
    IF v_track THEN
      INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
        VALUES (v_line.product_id, 'sale_void', v_line.quantity, COALESCE(v_unit,'pcs'), 'orders', p_order_id, v_profile_id);
      UPDATE products SET current_stock = current_stock + v_line.quantity, updated_at=now() WHERE id=v_line.product_id;
    ELSIF v_deduct THEN
      FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_line.product_id, v_line.quantity) LOOP
        INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
          VALUES (v_cons.product_id, 'sale_void', v_cons.qty_base, COALESCE(v_cons.unit,'pcs'), 'orders', p_order_id, v_profile_id);
        UPDATE products SET current_stock = current_stock + v_cons.qty_base, updated_at=now() WHERE id=v_cons.product_id;
      END LOOP;
    END IF;
  END LOOP;

  -- Reverse JE: DR Revenue / CR AR (contra of creation DR AR / CR Revenue).
  v_ar_id      := resolve_mapping_account('B2B_AR');
  v_revenue_id := resolve_mapping_account('SALE_B2B_REVENUE');
  PERFORM check_fiscal_period_open(v_now::date);
  v_entry_no   := next_journal_entry_number(v_now::date);
  INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, created_by)
    VALUES (v_entry_no, v_now::date, 'B2B order cancel '||v_order.order_number||' — '||left(p_reason,120),
            'b2b_order_cancel', p_order_id, 'posted', v_order.total, v_order.total, v_profile_id)
    RETURNING id INTO v_je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_revenue_id, v_order.total, 0, 'Reverse B2B revenue — '||v_order.order_number),
    (v_je_id, v_ar_id,      0, v_order.total, 'Reverse B2B AR — '||v_order.order_number);

  -- Decrement AR balance, guard >= 0.
  SELECT b2b_current_balance INTO v_balance_before FROM customers WHERE id=v_order.customer_id FOR UPDATE;
  v_balance_before := COALESCE(v_balance_before,0);
  v_balance_after  := v_balance_before - v_order.total;
  IF v_balance_after < 0 THEN
    RAISE EXCEPTION 'balance_underflow_on_cancel (before: %, total: %)', v_balance_before, v_order.total USING ERRCODE='P0011';
  END IF;
  UPDATE customers SET b2b_current_balance=v_balance_after, updated_at=now() WHERE id=v_order.customer_id;

  UPDATE orders SET status='voided', updated_at=now() WHERE id=p_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'b2b.order.cancelled', 'orders', p_order_id, jsonb_build_object(
    'order_id', p_order_id, 'order_number', v_order.order_number, 'customer_id', v_order.customer_id,
    'total', v_order.total, 'reason', p_reason, 'reversed_je_id', v_je_id,
    'balance_before', v_balance_before, 'balance_after', v_balance_after,
    'idempotency_key', p_idempotency_key, 'rpc_version', 'v1'));

  RETURN jsonb_build_object('order_id', p_order_id, 'order_number', v_order.order_number,
    'reversed_je_id', v_je_id, 'balance_after', v_balance_after, 'idempotent_replay', FALSE);
END $func$;

REVOKE ALL ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.cancel_b2b_order_v1(uuid, text, uuid) IS
  'S52 P1.2 — cancel an unpaid b2b invoice: reverse JE (DR revenue/CR AR) + stock (sale_void) '
  '+ AR balance, set status=voided. Blocked if any b2b_payment_allocations row exists. '
  'Gate b2b.order.cancel. Idempotent via p_idempotency_key. Errors P0001/P0002/P0003/P0011.';
