-- 20260517000020_extend_record_stock_movement_v1_lot_id.sql
-- Session 13 / Phase 1.A / migration [m4] split 1/3 :
--   Extend record_stock_movement_v1 with p_lot_id UUID DEFAULT NULL — B1 pattern (a)
--   (additive signature, NOT a v2 bump). Pre-existing callers continue working since
--   the new param defaults to NULL.
--
-- The companion `stock_movements.lot_id` column is added in 20260517000021. The lot
-- table itself (`stock_lots`) is created by inv-stream in 20260517000040..045 — this
-- migration tolerates its absence at compile time (we only reference it inside the
-- conditional FIFO branch ; PostgreSQL defers name resolution until runtime).
--
-- Decision D15 — F1 expiry ledger invariant. `stock_movements.lot_id` is set at INSERT,
-- never after. AUCUN trigger AFTER INSERT/UPDATE modifies it (asserted by pgTAP
-- T_F1_NO_UPDATE_INVARIANT in accounting.test.sql).

-- The lot_id column is added by 000021 ; we add it pre-emptively here (idempotent)
-- because plpgsql validates column references at CREATE time (check_function_bodies=on).
-- 000021 stays as a documented split-marker even though it becomes a no-op.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS lot_id UUID;

-- Drop the existing v4 signature (12 args, no lot_id) to make room for v5 (13 args).
DROP FUNCTION IF EXISTS record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT, UUID, UUID, JSONB
);

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
  p_metadata         JSONB          DEFAULT '{}'::JSONB,
  p_lot_id           UUID           DEFAULT NULL
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
  v_lot_id   UUID := p_lot_id;
  v_remain   DECIMAL(10,3);
  v_lot_table_exists BOOLEAN;
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
        'idempotent_replay', true,
        'lot_id',            (SELECT lot_id FROM stock_movements WHERE id = v_mvt_id)
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

  -- D15 FIFO resolution — only for consuming movement types when caller did not
  -- pin a lot AND when stock_lots table exists (inv-stream creates it). The check
  -- is dynamic so this migration applies regardless of inv-stream ordering.
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'stock_lots' AND n.nspname = 'public'
  ) INTO v_lot_table_exists;

  IF v_lot_table_exists
     AND p_movement_type IN ('waste','transfer_out','production_out')
     AND v_lot_id IS NULL
     AND p_quantity < 0
  THEN
    -- Look up the FIFO-oldest active lot with positive quantity, lock it.
    EXECUTE $exec$
      SELECT id, quantity
        FROM stock_lots
        WHERE product_id = $1
          AND status = 'active'
          AND quantity > 0
        ORDER BY expires_at ASC NULLS LAST, created_at ASC
        LIMIT 1
        FOR UPDATE
    $exec$
      INTO v_lot_id, v_remain
      USING p_product_id;

    -- Decrement the lot in the same transaction. Note: we do not raise on
    -- lot-not-found — if no lot is available, the movement records lot_id=NULL
    -- (legacy behaviour pre-F1). Strict-mode enforcement is a Phase 1.C concern.
    IF v_lot_id IS NOT NULL THEN
      EXECUTE $exec$
        UPDATE stock_lots
          SET quantity   = quantity + $2,        -- p_quantity is signed-negative
              status     = CASE WHEN quantity + $2 <= 0 THEN 'consumed' ELSE status END,
              updated_at = now()
          WHERE id = $1
      $exec$
        USING v_lot_id, p_quantity;
    END IF;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by,
    from_section_id, to_section_id, metadata, lot_id
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile,
    p_from_section_id, p_to_section_id, COALESCE(p_metadata, '{}'::JSONB), v_lot_id
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  -- Direction-aware section_stock UPSERT (carried over from v4 / migration 000024).
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
      'metadata',          COALESCE(p_metadata, '{}'::JSONB),
      'lot_id',            v_lot_id
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'movement_id',       v_mvt_id,
    'product_id',        p_product_id,
    'new_current_stock', v_new,
    'idempotent_replay', false,
    'lot_id',            v_lot_id
  );
END $$;

REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;

COMMENT ON FUNCTION record_stock_movement_v1 IS
  'INTERNAL primitive. v5: additive p_lot_id UUID DEFAULT NULL (B1 pattern a — D15). '
  'FIFO resolution UPFRONT for waste/transfer_out/production_out when p_lot_id IS NULL '
  '(only if stock_lots table exists). lot_id is set at INSERT, never modified after.';
