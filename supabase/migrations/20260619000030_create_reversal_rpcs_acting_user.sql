-- 20260619000030_create_reversal_rpcs_acting_user.sql
-- Security hardening (security-fraud-guard audit 2026-05-31, Pattern #4, checklist A).
--
-- GAP 1 — reversal RPCs are callable directly via PostgREST, bypassing the EF PIN.
-- void_order_rpc / cancel_order_item_rpc / refund_order_rpc_v2 are
-- GRANT EXECUTE TO authenticated and validate only
-- has_permission_for_profile(p_authorized_by, …). The manager PIN is checked ONLY
-- inside the Edge Function. A cashier can therefore POST /rest/v1/rpc/void_order_rpc
-- directly, passing any manager's profile UUID (harvested from user_profiles —
-- now mitigated by 20260619000023, but defense in depth requires closing this too)
-- as p_authorized_by, and the reversal succeeds with NO PIN entered. The audit row
-- also records the cashier as actor_id → non-repudiation broken.
--
-- Fix (this migration = additive half): introduce v-next RPCs that
--   (a) take the acting cashier's auth.uid as an explicit argument
--       (p_acting_auth_user_id) instead of reading auth.uid(), so the EF can call
--       them with the service-role admin client (auth.uid() would be NULL there);
--   (b) are REVOKE'd from authenticated / anon / PUBLIC and granted only to
--       service_role — they become callable ONLY through the Edge Function, which
--       verifies the manager PIN server-side before calling;
--   (c) set audit_logs.actor_id = the approving manager (p_authorized_by) and
--       record acting_cashier_id in metadata, restoring non-repudiation.
--
-- The old functions are NOT dropped here (so live refund/void/cancel keep working
-- until the Edge Functions are redeployed to call these v-next RPCs). The drop +
-- REVOKE-from-authenticated on the old functions ships in a follow-up finalizer
-- migration applied AFTER the EF redeploy.

-- ============================================================================
-- void_order_rpc_v2 — full void, acting-cashier explicit, service_role only.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.void_order_rpc_v2(
  p_order_id            UUID,
  p_reason              TEXT,
  p_authorized_by       UUID,
  p_acting_auth_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order          RECORD;
  v_open_session   UUID;
  v_item           RECORD;
  v_loyalty_now    INTEGER;
  v_refund_id      UUID;
  v_refund_number  TEXT;
  v_seq_number     INTEGER;
  v_pay            RECORD;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_authorized_by IS NULL THEN
    RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.void') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.void' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Cannot void % order (only paid orders)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id <> v_open_session THEN
    RAISE EXCEPTION 'Cross-shift void not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  UPDATE orders SET
    status      = 'voided',
    voided_at   = now(),
    voided_by   = p_authorized_by,
    void_reason = p_reason,
    updated_at  = now()
  WHERE id = p_order_id;

  FOR v_item IN SELECT id, product_id, quantity FROM order_items
                WHERE order_id = p_order_id AND is_cancelled = false LOOP
    -- stock_movements.unit is NOT NULL — resolve from products (matches refund v2).
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
    )
    SELECT v_item.product_id, 'sale_void', v_item.quantity, COALESCE(p.unit, 'pcs'),
           'orders', p_order_id, v_profile_id
    FROM products p WHERE p.id = v_item.product_id;
    UPDATE products SET
      current_stock = current_stock + v_item.quantity,
      updated_at    = now()
    WHERE id = v_item.product_id;
  END LOOP;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    UPDATE customers SET
      loyalty_points  = GREATEST(0, loyalty_points  - v_order.loyalty_points_earned),
      lifetime_points = GREATEST(0, lifetime_points - v_order.loyalty_points_earned),
      total_spent     = GREATEST(0, total_spent - v_order.total),
      updated_at      = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      -v_order.loyalty_points_earned,
      v_loyalty_now,
      'Reversal: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_redeemed > 0 THEN
    UPDATE customers SET
      loyalty_points = loyalty_points + v_order.loyalty_points_redeemed,
      updated_at     = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      v_order.loyalty_points_redeemed,
      v_loyalty_now,
      'Restored redemption: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void)
  VALUES (v_refund_number, p_order_id, v_open_session, v_order.total, v_order.tax_amount,
          p_reason, v_profile_id, p_authorized_by, true)
  RETURNING id INTO v_refund_id;

  INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
  SELECT v_refund_id, id, quantity, line_total
    FROM order_items WHERE order_id = p_order_id AND is_cancelled = false;

  FOR v_pay IN SELECT method, amount, reference FROM order_payments WHERE order_id = p_order_id LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (v_refund_id, v_pay.method, v_pay.amount, v_pay.reference);
  END LOOP;

  -- Audit: actor = approving MANAGER (non-repudiation); cashier recorded in metadata.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.void', 'orders', p_order_id, jsonb_build_object(
    'order_number',     v_order.order_number,
    'total_voided',     v_order.total,
    'reason',           p_reason,
    'authorized_by',    p_authorized_by,
    'acting_cashier_id', v_profile_id,
    'refund_id',        v_refund_id,
    'refund_number',    v_refund_number
  ));

  RETURN jsonb_build_object(
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'total_refunded', v_order.total,
    'tax_refunded',   v_order.tax_amount,
    'tenders',        (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                       FROM refund_payments WHERE refund_id = v_refund_id)
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v2(UUID, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v2(UUID, TEXT, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v2(UUID, TEXT, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.void_order_rpc_v2(UUID, TEXT, UUID, UUID) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.void_order_rpc_v2 IS
  'S34 security: full void of a paid order. service_role-only (called by void-order EF after server-side manager-PIN verify). Acting cashier passed explicitly via p_acting_auth_user_id. Audit actor = approving manager.';

-- ============================================================================
-- cancel_order_item_rpc_v2 — cancel draft item, acting-cashier explicit.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_order_item_rpc_v2(
  p_order_item_id       UUID,
  p_reason              TEXT,
  p_authorized_by       UUID,
  p_acting_auth_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_status   order_status;
  v_kitchen_status TEXT;
  v_is_cancelled   BOOLEAN;
  v_dispatch       TEXT;
  v_order_number   TEXT;
  v_name           TEXT;
  v_new_subtotal   DECIMAL(14,2);
  v_new_tax        DECIMAL(14,2);
  v_new_total      DECIMAL(14,2);
  v_tax_rate       DECIMAL(5,4);
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_authorized_by IS NULL THEN
    RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.cancel_item') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.cancel_item'
      USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT oi.order_id, o.status, oi.kitchen_status, oi.is_cancelled,
         oi.dispatch_station, o.order_number, oi.name_snapshot
    INTO v_order_id, v_order_status, v_kitchen_status, v_is_cancelled,
         v_dispatch, v_order_number, v_name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
    FOR UPDATE OF oi;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order_status <> 'draft' THEN
    RAISE EXCEPTION 'Cannot cancel item on % order (use refund flow)', v_order_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_kitchen_status = 'served' THEN
    RAISE EXCEPTION 'Cannot cancel served item (use refund flow)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_is_cancelled THEN
    RAISE EXCEPTION 'Item already cancelled' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE order_items SET
    is_cancelled     = true,
    cancelled_at     = now(),
    cancelled_reason = p_reason,
    cancelled_by     = p_authorized_by
  WHERE id = p_order_item_id;

  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_new_subtotal
    FROM order_items
    WHERE order_id = v_order_id AND is_cancelled = false;

  v_new_total := v_new_subtotal;
  v_new_tax   := round_idr(v_new_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders
    SET subtotal   = v_new_subtotal,
        tax_amount = v_new_tax,
        total      = v_new_total,
        updated_at = now()
    WHERE id = v_order_id;

  -- Audit: actor = approving MANAGER (non-repudiation); cashier recorded in metadata.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.cancel_item', 'order_items', p_order_item_id, jsonb_build_object(
    'order_id',          v_order_id,
    'order_number',      v_order_number,
    'item_name',         v_name,
    'reason',            p_reason,
    'authorized_by',     p_authorized_by,
    'acting_cashier_id', v_profile_id,
    'dispatch_station',  v_dispatch,
    'new_subtotal',      v_new_subtotal,
    'new_total',         v_new_total
  ));

  RETURN jsonb_build_object(
    'order_item_id',    p_order_item_id,
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_tax_amount',   v_new_tax,
    'new_total',        v_new_total
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v2(UUID, TEXT, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v2(UUID, TEXT, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v2(UUID, TEXT, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_order_item_rpc_v2(UUID, TEXT, UUID, UUID) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.cancel_order_item_rpc_v2 IS
  'S34 security: cancel a draft order item. service_role-only (called by cancel-item EF after server-side manager-PIN verify). Acting cashier explicit. Audit actor = approving manager.';

-- ============================================================================
-- refund_order_rpc_v3 — partial line refund, acting-cashier explicit.
-- (bumped from v2 which kept p_idempotency_key; v3 adds p_acting_auth_user_id)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.refund_order_rpc_v3(
  p_order_id            UUID,
  p_lines               JSONB,
  p_tenders             JSONB,
  p_reason              TEXT,
  p_authorized_by       UUID,
  p_idempotency_key     UUID,
  p_acting_auth_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id          UUID;
  v_profile_id       UUID;
  v_order            RECORD;
  v_open_session     UUID;
  v_line_entry       JSONB;
  v_oi_id            UUID;
  v_oi               RECORD;
  v_qty_req          DECIMAL(14,3);
  v_qty_already      DECIMAL(14,3);
  v_amount_line      DECIMAL(14,2);
  v_refund_total     DECIMAL(14,2) := 0;
  v_tax_rate         DECIMAL(5,4);
  v_tax_refunded     DECIMAL(14,2);
  v_prior_refunds    DECIMAL(14,2);
  v_tender_entry     JSONB;
  v_tender_method    payment_method;
  v_tender_amt       DECIMAL(14,2);
  v_tender_sum       DECIMAL(14,2) := 0;
  v_method_paid      DECIMAL(14,2);
  v_method_refunded  DECIMAL(14,2);
  v_refund_id        UUID;
  v_refund_number    TEXT;
  v_seq_number       INTEGER;
  v_loyalty_now      INTEGER;
  v_pts_to_deduct    INTEGER := 0;
  v_loyalty_ratio    DECIMAL(8,4);
  v_product_id       UUID;
  v_existing         RECORD;
BEGIN
  v_user_id := p_acting_auth_user_id;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001';
  END IF;

  IF p_authorized_by IS NULL THEN
    RAISE EXCEPTION 'Manager authorization required' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.refund') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.refund' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotency replay check (shape matches refund_order_rpc_v2 replay).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded
      INTO v_existing
      FROM refunds r
      WHERE r.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'refund_id',         v_existing.id,
        'refund_number',     v_existing.refund_number,
        'order_id',          v_existing.order_id,
        'total_refunded',    v_existing.total,
        'tax_refunded',      v_existing.tax_refunded,
        'tenders',           p_tenders,
        'pts_deducted',      0,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status <> 'paid' THEN
    RAISE EXCEPTION 'Cannot refund % order', v_order.status USING ERRCODE = 'check_violation';
  END IF;

  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id <> v_open_session THEN
    RAISE EXCEPTION 'Cross-shift refund not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 1 THEN
    RAISE EXCEPTION 'At least one line required' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);

    SELECT * INTO v_oi FROM order_items WHERE id = v_oi_id;
    IF v_oi.id IS NULL OR v_oi.order_id <> p_order_id THEN
      RAISE EXCEPTION 'Order item % not in order %', v_oi_id, p_order_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_oi.is_cancelled THEN
      RAISE EXCEPTION 'Cannot refund cancelled item %', v_oi_id USING ERRCODE = 'check_violation';
    END IF;
    IF v_qty_req <= 0 OR v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Invalid qty for item % (max %)', v_oi_id, v_oi.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(qty), 0) INTO v_qty_already
      FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
      WHERE rl.order_item_id = v_oi_id;

    IF v_qty_already + v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Refund qty (%) + already refunded (%) exceeds line qty (%) for item %',
        v_qty_req, v_qty_already, v_oi.quantity, v_oi_id USING ERRCODE = 'check_violation';
    END IF;

    v_amount_line  := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);
    v_refund_total := v_refund_total + v_amount_line;
  END LOOP;

  SELECT COALESCE(SUM(total), 0) INTO v_prior_refunds
    FROM refunds WHERE order_id = p_order_id;
  IF v_prior_refunds + v_refund_total > v_order.total THEN
    RAISE EXCEPTION 'Refund total (% prior + % new) exceeds order total %',
      v_prior_refunds, v_refund_total, v_order.total USING ERRCODE = 'check_violation';
  END IF;

  IF p_tenders IS NULL OR jsonb_array_length(p_tenders) < 1 THEN
    RAISE EXCEPTION 'At least one tender required' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    v_tender_method := (v_tender_entry->>'method')::payment_method;
    v_tender_amt    := (v_tender_entry->>'amount')::DECIMAL(14,2);

    IF v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'Tender amount must be > 0' USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(amount),0) INTO v_method_paid
      FROM order_payments WHERE order_id = p_order_id AND method = v_tender_method;
    SELECT COALESCE(SUM(rp.amount),0) INTO v_method_refunded
      FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id
      WHERE r.order_id = p_order_id AND rp.method = v_tender_method;

    IF v_method_refunded + v_tender_amt > v_method_paid THEN
      RAISE EXCEPTION 'Refund tender % (%) + prior (%) exceeds method paid (%)',
        v_tender_method, v_tender_amt, v_method_refunded, v_method_paid
        USING ERRCODE = 'check_violation';
    END IF;

    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum <> v_refund_total THEN
    RAISE EXCEPTION 'Sum of refund tenders (%) != refund total (%)', v_tender_sum, v_refund_total
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;
  v_tax_refunded := round_idr(v_refund_total * v_tax_rate / (1 + v_tax_rate));

  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void, idempotency_key)
  VALUES (v_refund_number, p_order_id, v_open_session, v_refund_total, v_tax_refunded,
          p_reason, v_profile_id, p_authorized_by, false, p_idempotency_key)
  RETURNING id INTO v_refund_id;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);

    SELECT line_total, quantity, product_id
      INTO v_oi FROM order_items WHERE id = v_oi_id;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);
    v_product_id  := v_oi.product_id;

    INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
    VALUES (v_refund_id, v_oi_id, v_qty_req, v_amount_line);

    -- stock_movements.unit is NOT NULL — resolve from products (matches refund v2).
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
    )
    SELECT v_product_id, 'sale_void', v_qty_req, COALESCE(p.unit, 'pcs'),
           'refunds', v_refund_id, v_profile_id
    FROM products p WHERE p.id = v_product_id;

    UPDATE products SET
      current_stock = current_stock + v_qty_req,
      updated_at    = now()
    WHERE id = v_product_id;
  END LOOP;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (
      v_refund_id,
      (v_tender_entry->>'method')::payment_method,
      (v_tender_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_tender_entry->>'reference','')
    );
  END LOOP;

  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 AND v_order.total > 0 THEN
    v_loyalty_ratio := v_refund_total::DECIMAL / v_order.total::DECIMAL;
    v_pts_to_deduct := FLOOR(v_order.loyalty_points_earned * v_loyalty_ratio);

    IF v_pts_to_deduct > 0 THEN
      UPDATE customers SET
        loyalty_points  = GREATEST(0, loyalty_points  - v_pts_to_deduct),
        lifetime_points = GREATEST(0, lifetime_points - v_pts_to_deduct),
        total_spent     = GREATEST(0, total_spent - v_refund_total),
        updated_at      = now()
      WHERE id = v_order.customer_id
      RETURNING loyalty_points INTO v_loyalty_now;

      INSERT INTO loyalty_transactions (
        customer_id, order_id, transaction_type, points,
        points_balance_after, description, created_by
      ) VALUES (
        v_order.customer_id, p_order_id, 'refund',
        -v_pts_to_deduct, v_loyalty_now,
        'Refund ' || v_refund_number || ' on order ' || v_order.order_number, v_profile_id
      );
    END IF;
  END IF;

  -- Audit: actor = approving MANAGER (non-repudiation); cashier recorded in metadata.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (p_authorized_by, 'order.refund', 'orders', p_order_id, jsonb_build_object(
    'refund_id',         v_refund_id,
    'refund_number',     v_refund_number,
    'order_number',      v_order.order_number,
    'total_refunded',    v_refund_total,
    'tax_refunded',      v_tax_refunded,
    'reason',            p_reason,
    'authorized_by',     p_authorized_by,
    'acting_cashier_id', v_profile_id,
    'lines_count',       jsonb_array_length(p_lines),
    'tenders_count',     jsonb_array_length(p_tenders),
    'pts_deducted',      v_pts_to_deduct
  ));

  RETURN jsonb_build_object(
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'total_refunded', v_refund_total,
    'tax_refunded',   v_tax_refunded,
    'tenders',        p_tenders,
    'pts_deducted',   v_pts_to_deduct
  );
END $$;

REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v3(UUID, JSONB, JSONB, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v3(UUID, JSONB, JSONB, TEXT, UUID, UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.refund_order_rpc_v3(UUID, JSONB, JSONB, TEXT, UUID, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.refund_order_rpc_v3(UUID, JSONB, JSONB, TEXT, UUID, UUID, UUID) TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.refund_order_rpc_v3 IS
  'S34 security: partial line refund. service_role-only (called by refund-order EF after server-side manager-PIN verify). Acting cashier explicit (p_acting_auth_user_id). Idempotent via p_idempotency_key. Audit actor = approving manager.';
