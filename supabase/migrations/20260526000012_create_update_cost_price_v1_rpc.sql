-- 20260526000012_create_update_cost_price_v1_rpc.sql
-- Session 22 / Phase 1.B.1 — DEV-S17-1.B-01. Split 2/2 (companion to 000011).
--
-- This migration depends on 'cost_price_correction' enum value being committed
-- (by 000011) so the CHECK + CREATE FUNCTION bodies below can reference it.
--
-- Touchpoints :
--   1) relax chk_stock_movements_section_required (cost-only event needs no section)
--   2) seed permission row + role grants (SUPER_ADMIN, ADMIN, MANAGER ; mirrors
--      the role set granted inventory.receive)
--   3) create update_cost_price_v1 RPC (SECURITY DEFINER postgres)
--
-- Audit trail design : the stock_movements row itself IS the audit (quantity=0,
-- reason captures old/new, metadata jsonb mirrors old_cost/new_cost/reason). No
-- audit_log entry is emitted — the existing ledger semantics suffice.
--
-- The RPC bypasses record_stock_movement_v1 deliberately : that primitive rejects
-- quantity=0 (`quantity_must_be_nonzero`), but a price-only event must record
-- zero stock delta. The direct INSERT runs inside this RPC's SECURITY DEFINER
-- postgres context which legitimately writes to the append-only ledger (same
-- pattern the inventory RPC family uses via the v1 primitive).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Relax section-required CHECK to allow cost_price_correction without a
--    section. The original constraint lists movement types that don't need a
--    section ; cost_price_correction joins that set since it carries quantity=0
--    (no physical stock motion).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS chk_stock_movements_section_required;

ALTER TABLE stock_movements
  ADD CONSTRAINT chk_stock_movements_section_required
  CHECK (
    movement_type = ANY (ARRAY[
      'purchase'::movement_type,
      'incoming'::movement_type,
      'sale'::movement_type,
      'sale_void'::movement_type,
      'purchase_return'::movement_type,
      'adjustment'::movement_type,
      'waste'::movement_type,
      'cost_price_correction'::movement_type
    ])
    OR from_section_id IS NOT NULL
    OR to_section_id IS NOT NULL
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Seed the new permission code + role grants. Mirrors the role set granted
--    inventory.receive (SUPER_ADMIN, ADMIN, MANAGER).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO permissions (code, module, action, description)
VALUES ('inventory.cost_correction', 'inventory', 'update',
        'Manual products.cost_price correction with audit row '
        '(stock_movements movement_type=cost_price_correction)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('SUPER_ADMIN', 'inventory.cost_correction', TRUE),
  ('ADMIN',       'inventory.cost_correction', TRUE),
  ('MANAGER',     'inventory.cost_correction', TRUE)
ON CONFLICT (role_code, permission_code) DO UPDATE SET is_granted = EXCLUDED.is_granted;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) update_cost_price_v1 RPC.
--
-- Error code map :
--   P0003 'unauthenticated'      — auth.uid() is NULL.
--   P0003 'forbidden'            — caller lacks inventory.cost_correction.
--   P0002 'product_not_found'    — p_product_id does not match a live product.
--   P0001 'invalid_cost'         — p_new_cost is NULL or negative.
--   P0001 'reason_required'      — p_reason NULL or len(trim) < 3.
--
-- Idempotency : p_idempotency_key UUID DEFAULT NULL. Replay returns the existing
-- stock_movements row without re-mutating cost_price. Mirrors the inventory RPC
-- family contract.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_cost_price_v1(
  p_product_id      UUID,
  p_new_cost        DECIMAL(14,2),
  p_reason          TEXT,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_old_cost  DECIMAL(14,2);
  v_unit      TEXT;
  v_mvt_id    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='P0003';
  END IF;

  IF NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_new_cost IS NULL OR p_new_cost < 0 THEN
    RAISE EXCEPTION 'invalid_cost' USING ERRCODE='P0001';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL
    LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id
      FROM stock_movements
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT cost_price INTO v_old_cost FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id',       v_mvt_id,
        'product_id',        p_product_id,
        'new_cost',          v_old_cost,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT cost_price, unit INTO v_old_cost, v_unit
    FROM products
   WHERE id = p_product_id AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_unit := COALESCE(v_unit, 'pcs');

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    idempotency_key, reference_type, created_by, metadata
  ) VALUES (
    p_product_id,
    'cost_price_correction',
    0,
    v_unit,
    p_reason,
    p_new_cost,
    p_idempotency_key,
    'admin_action',
    v_profile,
    jsonb_build_object(
      'old_cost', v_old_cost,
      'new_cost', p_new_cost,
      'reason',   p_reason
    )
  )
  RETURNING id INTO v_mvt_id;

  UPDATE products
     SET cost_price = p_new_cost,
         updated_at = now()
   WHERE id = p_product_id
     AND cost_price IS DISTINCT FROM p_new_cost;

  RETURN jsonb_build_object(
    'movement_id',       v_mvt_id,
    'product_id',        p_product_id,
    'old_cost',          v_old_cost,
    'new_cost',          p_new_cost,
    'idempotent_replay', false
  );
END $func$;

REVOKE EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION update_cost_price_v1(UUID, DECIMAL, TEXT, UUID) IS
  'S22 / DEV-S17-1.B-01 — Manual cost_price correction with audit row. '
  'Auth + has_permission(inventory.cost_correction) gated. Emits stock_movements '
  'row movement_type=cost_price_correction (quantity=0, reference_type=admin_action). '
  'Idempotent via p_idempotency_key. Fires the existing tr_snapshot_on_product_cost_change '
  'trigger so ancestor recipes are re-snapshotted automatically.';
