-- 20260516000019_fix_record_stock_movement_v1_unit.sql
-- Session 12 hotfix : record_stock_movement_v1 did not populate the
-- mandatory `unit` column on stock_movements (NOT NULL constraint), causing
-- adjust_stock_v1 / receive_stock_v1 / waste_stock_v1 to fail with
-- "null value in column \"unit\" of relation \"stock_movements\" violates
-- not-null constraint" on every call.
--
-- Per CLAUDE.md pitfall (UNIT-FIX): unit is mandatory on stock_movements
-- and must default to `product.unit ?? 'pcs'` when not explicitly provided
-- by the caller.
--
-- Fix:
--  1. Add p_unit TEXT DEFAULT NULL parameter so wrappers can override.
--  2. Resolve unit from products.unit when p_unit is NULL.
--  3. Final fallback to 'pcs' when the product itself has a NULL unit.
--  4. Pass v_unit to the INSERT statement.

CREATE OR REPLACE FUNCTION record_stock_movement_v1(
  p_product_id      UUID,
  p_movement_type   movement_type,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_unit_cost       DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id     UUID           DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL,
  p_unit            TEXT           DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_current  DECIMAL(10,3);
  v_new      DECIMAL(10,3);
  v_mvt_id   UUID;
  v_unit     TEXT;
BEGIN
  -- Hard-reject sale/sale_void coming from non-order paths.
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v1 cannot be called with movement_type=%', p_movement_type;
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_must_be_nonzero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- Idempotency replay: if a row with this key exists, return the recorded result.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object(
        'movement_id',       v_mvt_id,
        'product_id',        p_product_id,
        'new_current_stock', v_new,
        'idempotent_replay', true
      );
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- Lock product row + read current stock AND unit (for UNIT-FIX compliance).
  SELECT current_stock, unit INTO v_current, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  -- Caller-provided p_unit wins; otherwise products.unit; final fallback 'pcs'.
  v_unit := COALESCE(p_unit, v_unit, 'pcs');

  v_new := v_current + p_quantity;
  -- Negative-stock guard: nothing can take stock below 0 (callers validate above).
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  -- audit_log column is actor_profile_id (cf. 20260515000002_init_audit_log.sql).
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object(
      'movement_type',     p_movement_type,
      'quantity',          p_quantity,
      'unit',              v_unit,
      'reason',            p_reason,
      'new_current_stock', v_new,
      'idempotency_key',   p_idempotency_key
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id',       v_mvt_id,
    'product_id',        p_product_id,
    'new_current_stock', v_new,
    'idempotent_replay', false
  );
END $$;

-- CRITICAL: this is an internal primitive. It does NOT check has_permission
-- (the wrappers do). Without REVOKE EXECUTE on both PUBLIC and authenticated,
-- any logged-in user could invoke it directly and bypass the perm gates.
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;

COMMENT ON FUNCTION record_stock_movement_v1 IS
  'INTERNAL primitive — only callable by other SECURITY DEFINER functions running as owner. '
  'Authenticated users MUST go through adjust_stock_v1 / receive_stock_v1 / waste_stock_v1 '
  'which gate by has_permission. v2: adds p_unit param + reads products.unit + fallback pcs.';
