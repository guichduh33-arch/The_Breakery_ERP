-- 20260516000024_fix_record_stock_movement_v1_section_stock_direction.sql
-- Session 12 / Phase 3 hotfix — section_stock cache direction bug in v3.
--
-- The v3 primitive (migration 20260516000023) UPSERTs section_stock for BOTH
-- from_section_id AND to_section_id whenever they are passed. For internal
-- transfers, both legs (transfer_out qty=-X, transfer_in qty=+X) pass BOTH
-- sections, so each section receives -X then +X for a net delta of 0. The
-- source section is never actually decremented, and the destination never
-- incremented — section_stock cache stays flat.
--
-- Fix: gate the section_stock UPSERT by direction. The signed p_quantity
-- already tells us which side to touch:
--   - p_quantity < 0  → decrement source (p_from_section_id), if provided
--   - p_quantity > 0  → increment dest   (p_to_section_id),   if provided
--
-- Movement-type ↔ section semantics this respects:
--   transfer_out (qty<0, both sections set) → only from_section decremented ✓
--   transfer_in  (qty>0, both sections set) → only to_section   incremented ✓
--   purchase / incoming / production_in / adjustment_in / opname_in (qty>0):
--       caller passes to_section_id only → to_section incremented ✓
--   waste / production_out / adjustment_out / opname_out (qty<0):
--       caller passes from_section_id only → from_section decremented ✓
--
-- Signature is unchanged → CREATE OR REPLACE without DROP. Existing wrappers
-- and the new transfer RPCs all continue to call with the same named args.

CREATE OR REPLACE FUNCTION record_stock_movement_v1(
  p_product_id       UUID,
  p_movement_type    movement_type,
  p_quantity         DECIMAL(10,3),
  p_reason           TEXT,
  p_unit_cost        DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id      UUID           DEFAULT NULL,
  p_idempotency_key  UUID           DEFAULT NULL,
  p_unit             TEXT           DEFAULT NULL,
  p_from_section_id  UUID           DEFAULT NULL,
  p_to_section_id    UUID           DEFAULT NULL,
  p_metadata         JSONB          DEFAULT '{}'::JSONB
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
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v1 cannot be called with movement_type=%', p_movement_type;
  END IF;

  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_must_be_nonzero';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

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

  SELECT current_stock, unit INTO v_current, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_unit := COALESCE(p_unit, v_unit, 'pcs');

  v_new := v_current + p_quantity;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by,
    from_section_id, to_section_id, metadata
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile,
    p_from_section_id, p_to_section_id, COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  -- section_stock cache: direction-aware (v4 fix).
  -- A negative-qty leg decrements the source (if a from_section is provided).
  -- A positive-qty leg increments the destination (if a to_section is provided).
  -- This is the correct semantic for ALL movement types:
  --   - transfer_out (qty<0, both sections set) → only from decrements ✓
  --   - transfer_in  (qty>0, both sections set) → only to   increments ✓
  --   - purchase/incoming/production_in/adjustment_in/opname_in (qty>0) → only to_section_id ever set
  --   - waste/production_out/adjustment_out/opname_out (qty<0) → only from_section_id ever set
  IF p_quantity < 0 AND p_from_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_from_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity   = section_stock.quantity + EXCLUDED.quantity,
            updated_at = now();
  ELSIF p_quantity > 0 AND p_to_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_to_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity   = section_stock.quantity + EXCLUDED.quantity,
            updated_at = now();
  END IF;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object(
      'movement_type',     p_movement_type,
      'quantity',          p_quantity,
      'unit',              v_unit,
      'reason',            p_reason,
      'new_current_stock', v_new,
      'idempotency_key',   p_idempotency_key,
      'from_section_id',   p_from_section_id,
      'to_section_id',     p_to_section_id,
      'metadata',          COALESCE(p_metadata, '{}'::JSONB)
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

REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;

COMMENT ON FUNCTION record_stock_movement_v1 IS
  'INTERNAL primitive. v4: section_stock UPSERT is direction-aware — '
  'negative-qty leg decrements from_section_id, positive-qty leg increments '
  'to_section_id. Fixes v3 bug where both legs of a transfer cancelled out '
  'on each section_stock row, leaving the cache flat.';
