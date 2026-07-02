-- 20260710000083_cancel_order_item_rpc_v3_idempotency.sql
-- S55 P1.5 (audit T7) : idempotency EF-retry-safety sur le cancel-item.
-- La clé vit sur la ligne métier mutée (précédent refunds.idempotency_key).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancel_idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS order_items_cancel_idempotency_key_uidx
  ON order_items(cancel_idempotency_key) WHERE cancel_idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.cancel_order_item_rpc_v2(uuid, text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_order_item_rpc_v3(
  p_order_item_id       UUID,
  p_reason              TEXT,
  p_authorized_by       UUID,
  p_acting_auth_user_id UUID,
  p_idempotency_key     UUID DEFAULT NULL
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
  v_replay         RECORD;
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

  -- v3 idempotency replay : même clé → renvoyer l'enveloppe du premier cancel.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT oi.id AS order_item_id, oi.order_id, o.order_number, oi.name_snapshot,
           oi.dispatch_station, o.subtotal, o.tax_amount, o.total
      INTO v_replay
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.cancel_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_item_id', v_replay.order_item_id, 'order_id', v_replay.order_id,
        'order_number', v_replay.order_number, 'item_name', v_replay.name_snapshot,
        'dispatch_station', v_replay.dispatch_station,
        'new_subtotal', v_replay.subtotal, 'new_tax_amount', v_replay.tax_amount,
        'new_total', v_replay.total, 'idempotent_replay', true);
    END IF;
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
    is_cancelled           = true,
    cancelled_at           = now(),
    cancelled_reason       = p_reason,
    cancelled_by           = p_authorized_by,
    cancel_idempotency_key = p_idempotency_key
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

REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v3(UUID, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v3(UUID, TEXT, UUID, UUID, UUID) FROM anon;
-- Nouvelle signature = ACL fraîche ; pas de default-privilege revoke pour
-- authenticated (S20 ne couvre que PUBLIC/anon) — cf. incident 20260709000010.
REVOKE EXECUTE ON FUNCTION public.cancel_order_item_rpc_v3(UUID, TEXT, UUID, UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_order_item_rpc_v3(UUID, TEXT, UUID, UUID, UUID) TO service_role;

COMMENT ON FUNCTION public.cancel_order_item_rpc_v3 IS
  'S55 P1.5 (T7): idempotency replay via order_items.cancel_idempotency_key. Same key → returns the first cancel envelope (idempotent_replay=true), no error even if already cancelled. service_role-only. Acting cashier explicit. Audit actor = approving manager.';
