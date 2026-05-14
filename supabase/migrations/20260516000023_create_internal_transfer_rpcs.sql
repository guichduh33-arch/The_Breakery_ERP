-- 20260516000023_create_internal_transfer_rpcs.sql
-- Session 12 / Phase 3 — Internal transfer RPCs.
--
-- Layered on:
--   - 20260516000019 : record_stock_movement_v1 v2 (adds p_unit)
--   - 20260516000022 : internal_transfers + transfer_items tables
--
-- This migration:
--   1. Extends the internal primitive record_stock_movement_v1 to v3 with three
--      new optional params (p_from_section_id, p_to_section_id, p_metadata).
--      v3 also UPSERTs the section_stock cache when section ids are passed.
--   2. Adds 3 high-level wrappers:
--        - create_internal_transfer_v1  (MANAGER+ via inventory.transfer.create)
--        - receive_internal_transfer_v1 (MANAGER+ via inventory.transfer.receive)
--        - cancel_internal_transfer_v1  (MANAGER+ via inventory.transfer.create)
--
-- The signed p_quantity already encodes direction. transfer_out passes
-- p_quantity := -qty + p_from_section_id (source decreases by adding negative).
-- transfer_in passes p_quantity := +qty + p_to_section_id (dest increases by
-- adding positive). A single helper writes the correct delta for both legs.
--
-- Idempotency is handled at the header level (internal_transfers has
-- created_idempotency_key + received_idempotency_key). The two stock_movements
-- legs emitted per item are NOT passed idempotency keys — replay-safety comes
-- from the header gate which short-circuits before re-emitting movements.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 1 — record_stock_movement_v1 v3 (add sections + metadata + section_stock)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DROP the v2 8-param signature first so the REVOKE EXECUTE below remains
-- unambiguous (see migration 20260516000019 for the same pattern).
-- The three existing wrappers (adjust/receive/waste/incoming_stock_v1) use
-- named-argument calls and remain forward-compatible with the new optional
-- params.

DROP FUNCTION IF EXISTS record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT
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
    supplier_id, idempotency_key, reference_type, created_by,
    from_section_id, to_section_id, metadata
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile,
    p_from_section_id, p_to_section_id, COALESCE(p_metadata, '{}'::JSONB)
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  -- section_stock cache maintenance. The signed p_quantity encodes direction:
  --   - transfer_out passes p_quantity<0 with p_from_section_id → source decreases.
  --   - transfer_in  passes p_quantity>0 with p_to_section_id   → dest increases.
  -- For movements that touch only one section (production, opname), only one of
  -- the two branches fires. For movements that touch none (purchase/incoming/
  -- sale/waste/adjustment without section context), neither branch fires.
  IF p_from_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_from_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity   = section_stock.quantity + EXCLUDED.quantity,
            updated_at = now();
  END IF;

  IF p_to_section_id IS NOT NULL THEN
    INSERT INTO section_stock (section_id, product_id, quantity, unit)
      VALUES (p_to_section_id, p_product_id, p_quantity, v_unit)
      ON CONFLICT (section_id, product_id) DO UPDATE
        SET quantity   = section_stock.quantity + EXCLUDED.quantity,
            updated_at = now();
  END IF;

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

-- CRITICAL: this is an internal primitive. It does NOT check has_permission
-- (the wrappers do). Without REVOKE EXECUTE on both PUBLIC and authenticated,
-- any logged-in user could invoke it directly and bypass the perm gates.
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 2 — create_internal_transfer_v1
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_internal_transfer_v1(
  p_from_section_id  UUID,
  p_to_section_id    UUID,
  p_items            JSONB,
  p_notes            TEXT     DEFAULT NULL,
  p_send_directly    BOOLEAN  DEFAULT false,
  p_idempotency_key  UUID     DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_transfer_id      UUID;
  v_transfer_number  TEXT;
  v_status           TEXT;
  v_received_at      TIMESTAMPTZ;
  v_approved_by      UUID;
  v_section_count    INT;
  v_item             JSONB;
  v_product_ids      UUID[] := ARRAY[]::UUID[];
  v_pid              UUID;
  v_qty              DECIMAL(10,3);
  v_item_unit        TEXT;
  v_product_unit     TEXT;
  v_product_active   BOOLEAN;
  v_item_id          UUID;
  v_movements        JSONB := '[]'::JSONB;
  v_mvt_out          JSONB;
  v_mvt_in           JSONB;
  v_existing_items   JSONB;
BEGIN
  -- 1. Permission gate first (before idempotency, per pattern).
  IF NOT has_permission(v_uid, 'inventory.transfer.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 2. Idempotency replay (header-level).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, transfer_number, status
      INTO v_transfer_id, v_transfer_number, v_status
      FROM internal_transfers
     WHERE created_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      -- Rebuild items list for visibility.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id',                 ti.id,
               'product_id',         ti.product_id,
               'quantity_requested', ti.quantity_requested,
               'quantity_received',  ti.quantity_received,
               'unit',               ti.unit,
               'notes',              ti.notes
             )), '[]'::JSONB)
        INTO v_existing_items
        FROM transfer_items ti
       WHERE ti.transfer_id = v_transfer_id;
      RETURN jsonb_build_object(
        'transfer_id',       v_transfer_id,
        'transfer_number',   v_transfer_number,
        'status',            v_status,
        'idempotent_replay', true,
        'items',             v_existing_items
      );
    END IF;
  END IF;

  -- 3. Validate from <> to.
  IF p_from_section_id IS NULL OR p_to_section_id IS NULL THEN
    RAISE EXCEPTION 'section_required';
  END IF;
  IF p_from_section_id = p_to_section_id THEN
    RAISE EXCEPTION 'from_to_same_section';
  END IF;

  -- 4. Validate both sections exist + active + not deleted.
  SELECT COUNT(*) INTO v_section_count
    FROM sections
   WHERE id IN (p_from_section_id, p_to_section_id)
     AND is_active = true
     AND deleted_at IS NULL;
  IF v_section_count <> 2 THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE='P0002';
  END IF;

  -- 5. Items non-empty.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;

  -- 6. Resolve caller profile.
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 7. Validate each item entry: product exists/active, qty>0, no duplicates.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::DECIMAL(10,3);

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'product_id_required';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'quantity_must_be_positive';
    END IF;

    -- Duplicate detection.
    IF v_pid = ANY(v_product_ids) THEN
      RAISE EXCEPTION 'duplicate_product_in_items';
    END IF;
    v_product_ids := array_append(v_product_ids, v_pid);

    -- Product must exist, active, not deleted.
    SELECT is_active, unit INTO v_product_active, v_product_unit
      FROM products WHERE id = v_pid AND deleted_at IS NULL;
    IF NOT FOUND OR v_product_active = false THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
    END IF;
  END LOOP;

  -- 8. Reserve transfer number.
  v_transfer_number := next_transfer_number();

  -- 9. Insert header.
  v_status      := CASE WHEN p_send_directly THEN 'received' ELSE 'pending' END;
  v_received_at := CASE WHEN p_send_directly THEN now()      ELSE NULL       END;
  v_approved_by := CASE WHEN p_send_directly THEN v_profile  ELSE NULL       END;

  INSERT INTO internal_transfers (
    transfer_number, from_section_id, to_section_id, status, notes,
    created_by, approved_by, transferred_at, received_at,
    created_idempotency_key
  ) VALUES (
    v_transfer_number, p_from_section_id, p_to_section_id, v_status, p_notes,
    v_profile, v_approved_by, now(), v_received_at,
    p_idempotency_key
  ) RETURNING id INTO v_transfer_id;

  -- 10. Insert transfer_items rows.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_pid := (v_item->>'product_id')::UUID;
    v_qty := (v_item->>'quantity')::DECIMAL(10,3);

    -- Resolve final unit: caller-supplied entry.unit wins; else products.unit; else pcs.
    v_item_unit := v_item->>'unit';
    IF v_item_unit IS NULL OR length(trim(v_item_unit)) = 0 THEN
      SELECT unit INTO v_product_unit FROM products WHERE id = v_pid;
      v_item_unit := COALESCE(v_product_unit, 'pcs');
    END IF;

    INSERT INTO transfer_items (
      transfer_id, product_id, quantity_requested, quantity_received,
      unit, notes
    ) VALUES (
      v_transfer_id, v_pid, v_qty,
      CASE WHEN p_send_directly THEN v_qty ELSE NULL END,
      v_item_unit,
      v_item->>'notes'
    );
  END LOOP;

  -- 11. Send-directly path: emit transfer_out + transfer_in for each item.
  IF p_send_directly THEN
    FOR v_item_id, v_pid, v_qty, v_item_unit IN
      SELECT id, product_id, quantity_requested, unit
        FROM transfer_items
       WHERE transfer_id = v_transfer_id
    LOOP
      v_mvt_out := record_stock_movement_v1(
        p_product_id      := v_pid,
        p_movement_type   := 'transfer_out',
        p_quantity        := -v_qty,
        p_reason          := 'Transfer ' || v_transfer_number || ' (out)',
        p_unit_cost       := NULL,
        p_supplier_id     := NULL,
        p_idempotency_key := NULL,
        p_unit            := v_item_unit,
        p_from_section_id := p_from_section_id,
        p_to_section_id   := p_to_section_id,
        p_metadata        := jsonb_build_object(
                               'transfer_id',      v_transfer_id,
                               'transfer_number',  v_transfer_number,
                               'transfer_item_id', v_item_id,
                               'leg',              'out'
                             )
      );

      v_mvt_in := record_stock_movement_v1(
        p_product_id      := v_pid,
        p_movement_type   := 'transfer_in',
        p_quantity        := v_qty,
        p_reason          := 'Transfer ' || v_transfer_number || ' (in)',
        p_unit_cost       := NULL,
        p_supplier_id     := NULL,
        p_idempotency_key := NULL,
        p_unit            := v_item_unit,
        p_from_section_id := p_from_section_id,
        p_to_section_id   := p_to_section_id,
        p_metadata        := jsonb_build_object(
                               'transfer_id',      v_transfer_id,
                               'transfer_number',  v_transfer_number,
                               'transfer_item_id', v_item_id,
                               'leg',              'in'
                             )
      );

      v_movements := v_movements
                      || jsonb_build_array(v_mvt_out)
                      || jsonb_build_array(v_mvt_in);
    END LOOP;
  END IF;

  -- 12. Audit log.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'transfer.create', 'internal_transfers', v_transfer_id,
    jsonb_build_object(
      'transfer_number',   v_transfer_number,
      'from_section_id',   p_from_section_id,
      'to_section_id',     p_to_section_id,
      'status',            v_status,
      'send_directly',     p_send_directly,
      'item_count',        jsonb_array_length(p_items),
      'idempotency_key',   p_idempotency_key
    ),
    v_profile
  );

  -- 13. Return.
  RETURN jsonb_build_object(
    'transfer_id',       v_transfer_id,
    'transfer_number',   v_transfer_number,
    'status',            v_status,
    'idempotent_replay', false,
    'movements',         CASE WHEN p_send_directly THEN v_movements ELSE NULL END
  );
END $$;

REVOKE EXECUTE ON FUNCTION create_internal_transfer_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_internal_transfer_v1 TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 3 — receive_internal_transfer_v1
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION receive_internal_transfer_v1(
  p_transfer_id      UUID,
  p_received_items   JSONB,
  p_idempotency_key  UUID  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid              UUID := auth.uid();
  v_profile          UUID;
  v_transfer_number  TEXT;
  v_status           TEXT;
  v_from             UUID;
  v_to               UUID;
  v_entry            JSONB;
  v_item_id          UUID;
  v_qty_received     DECIMAL(10,3);
  v_qty_requested    DECIMAL(10,3);
  v_pid              UUID;
  v_item_unit        TEXT;
  v_movements        JSONB := '[]'::JSONB;
  v_mvt_out          JSONB;
  v_mvt_in           JSONB;
  v_replay_movements JSONB;
BEGIN
  -- 1. Permission.
  IF NOT has_permission(v_uid, 'inventory.transfer.receive') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 2. Caller profile.
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 3. Lock header.
  SELECT transfer_number, status, from_section_id, to_section_id
    INTO v_transfer_number, v_status, v_from, v_to
    FROM internal_transfers
   WHERE id = p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_not_found' USING ERRCODE='P0002';
  END IF;

  -- 4. Idempotency replay.
  IF p_idempotency_key IS NOT NULL THEN
    DECLARE
      v_existing UUID;
    BEGIN
      SELECT received_idempotency_key INTO v_existing
        FROM internal_transfers
       WHERE id = p_transfer_id;
      IF v_existing IS NOT NULL AND v_existing = p_idempotency_key AND v_status = 'received' THEN
        -- Rebuild movements list from stock_movements.
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'movement_id',   sm.id,
                 'product_id',    sm.product_id,
                 'movement_type', sm.movement_type,
                 'quantity',      sm.quantity,
                 'unit',          sm.unit
               ) ORDER BY sm.created_at), '[]'::JSONB)
          INTO v_replay_movements
          FROM stock_movements sm
         WHERE sm.metadata->>'transfer_id' = p_transfer_id::TEXT;
        RETURN jsonb_build_object(
          'transfer_id',       p_transfer_id,
          'transfer_number',   v_transfer_number,
          'status',            'received',
          'idempotent_replay', true,
          'movements',         v_replay_movements
        );
      END IF;
    END;
  END IF;

  -- 5. Status guard.
  IF v_status NOT IN ('pending', 'in_transit') THEN
    RAISE EXCEPTION 'receive_not_allowed_in_status';
  END IF;

  -- 6. Update each transfer_items.quantity_received from p_received_items.
  IF p_received_items IS NULL OR jsonb_typeof(p_received_items) <> 'array' THEN
    RAISE EXCEPTION 'received_items_required';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_received_items) LOOP
    v_item_id      := (v_entry->>'item_id')::UUID;
    v_qty_received := (v_entry->>'quantity_received')::DECIMAL(10,3);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'item_id_required';
    END IF;
    IF v_qty_received IS NULL OR v_qty_received < 0 THEN
      RAISE EXCEPTION 'quantity_received_invalid';
    END IF;

    SELECT quantity_requested INTO v_qty_requested
      FROM transfer_items
     WHERE id = v_item_id AND transfer_id = p_transfer_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'transfer_item_not_found' USING ERRCODE='P0002';
    END IF;
    IF v_qty_received > v_qty_requested THEN
      RAISE EXCEPTION 'quantity_received_invalid';
    END IF;

    UPDATE transfer_items
       SET quantity_received = v_qty_received
     WHERE id = v_item_id AND transfer_id = p_transfer_id;
  END LOOP;

  -- 7. Update header → received.
  UPDATE internal_transfers
     SET status                   = 'received',
         received_at              = now(),
         approved_by              = v_profile,
         received_idempotency_key = p_idempotency_key
   WHERE id = p_transfer_id;

  -- 8. Emit transfer_out + transfer_in legs for each item with qty_received > 0.
  FOR v_item_id, v_pid, v_qty_received, v_item_unit IN
    SELECT id, product_id, quantity_received, unit
      FROM transfer_items
     WHERE transfer_id = p_transfer_id
       AND quantity_received IS NOT NULL
       AND quantity_received > 0
  LOOP
    v_mvt_out := record_stock_movement_v1(
      p_product_id      := v_pid,
      p_movement_type   := 'transfer_out',
      p_quantity        := -v_qty_received,
      p_reason          := 'Transfer ' || v_transfer_number || ' (out)',
      p_unit_cost       := NULL,
      p_supplier_id     := NULL,
      p_idempotency_key := NULL,
      p_unit            := v_item_unit,
      p_from_section_id := v_from,
      p_to_section_id   := v_to,
      p_metadata        := jsonb_build_object(
                             'transfer_id',      p_transfer_id,
                             'transfer_number',  v_transfer_number,
                             'transfer_item_id', v_item_id,
                             'leg',              'out'
                           )
    );

    v_mvt_in := record_stock_movement_v1(
      p_product_id      := v_pid,
      p_movement_type   := 'transfer_in',
      p_quantity        := v_qty_received,
      p_reason          := 'Transfer ' || v_transfer_number || ' (in)',
      p_unit_cost       := NULL,
      p_supplier_id     := NULL,
      p_idempotency_key := NULL,
      p_unit            := v_item_unit,
      p_from_section_id := v_from,
      p_to_section_id   := v_to,
      p_metadata        := jsonb_build_object(
                             'transfer_id',      p_transfer_id,
                             'transfer_number',  v_transfer_number,
                             'transfer_item_id', v_item_id,
                             'leg',              'in'
                           )
    );

    v_movements := v_movements
                    || jsonb_build_array(v_mvt_out)
                    || jsonb_build_array(v_mvt_in);
  END LOOP;

  -- 9. Audit log.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'transfer.receive', 'internal_transfers', p_transfer_id,
    jsonb_build_object(
      'transfer_number',  v_transfer_number,
      'from_section_id',  v_from,
      'to_section_id',    v_to,
      'item_count',       jsonb_array_length(p_received_items),
      'idempotency_key',  p_idempotency_key
    ),
    v_profile
  );

  -- 10. Return.
  RETURN jsonb_build_object(
    'transfer_id',       p_transfer_id,
    'transfer_number',   v_transfer_number,
    'status',            'received',
    'idempotent_replay', false,
    'movements',         v_movements
  );
END $$;

REVOKE EXECUTE ON FUNCTION receive_internal_transfer_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION receive_internal_transfer_v1 TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 4 — cancel_internal_transfer_v1
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION cancel_internal_transfer_v1(
  p_transfer_id  UUID,
  p_reason       TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_status    TEXT;
  v_number    TEXT;
BEGIN
  -- 1. Permission (reuse transfer.create — only creator-class users can cancel).
  IF NOT has_permission(v_uid, 'inventory.transfer.create') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 2. Reason required (>=3 chars after trim).
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  -- 3. Caller profile.
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  -- 4. Lock header.
  SELECT status, transfer_number INTO v_status, v_number
    FROM internal_transfers
   WHERE id = p_transfer_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transfer_not_found' USING ERRCODE='P0002';
  END IF;

  -- 5. Status guard — cancellation only allowed pre-receive.
  IF v_status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'cancel_not_allowed_in_status';
  END IF;

  -- 6. Update header.
  UPDATE internal_transfers
     SET status   = 'cancelled',
         metadata = metadata || jsonb_build_object(
                                  'cancel_reason', p_reason,
                                  'cancelled_by',  v_profile,
                                  'cancelled_at',  now()
                                )
   WHERE id = p_transfer_id;

  -- 7. Audit log.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'transfer.cancel', 'internal_transfers', p_transfer_id,
    jsonb_build_object(
      'transfer_number', v_number,
      'cancel_reason',   p_reason,
      'previous_status', v_status
    ),
    v_profile
  );

  -- 8. Return.
  RETURN jsonb_build_object(
    'transfer_id',   p_transfer_id,
    'status',        'cancelled',
    'cancel_reason', p_reason
  );
END $$;

REVOKE EXECUTE ON FUNCTION cancel_internal_transfer_v1 FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION cancel_internal_transfer_v1 TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART 5 — COMMENT ON FUNCTION
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION record_stock_movement_v1 IS
  'INTERNAL primitive — only callable by other SECURITY DEFINER functions running as owner. '
  'Authenticated users MUST go through adjust_stock_v1 / receive_stock_v1 / waste_stock_v1 / '
  'record_incoming_stock_v1 / create_internal_transfer_v1 / receive_internal_transfer_v1. '
  'v3: adds p_from_section_id, p_to_section_id, p_metadata and UPSERTs section_stock cache. '
  'Signed p_quantity already encodes direction — adding the signed delta to section_stock works '
  'for both transfer_out (negative on source) and transfer_in (positive on dest).';

COMMENT ON FUNCTION create_internal_transfer_v1 IS
  'MANAGER+ (inventory.transfer.create). Create an internal transfer header + items between two '
  'sections. p_send_directly=true sets status=received and emits the two stock_movement legs '
  '(transfer_out -qty from source, transfer_in +qty to dest) for each item immediately; '
  'p_send_directly=false leaves the transfer in pending awaiting receive_internal_transfer_v1. '
  'Idempotency replay returns the cached {transfer_id, transfer_number, status, items}.';

COMMENT ON FUNCTION receive_internal_transfer_v1 IS
  'MANAGER+ (inventory.transfer.receive). Receive a pending/in_transit transfer with possibly '
  'partial quantities. Updates transfer_items.quantity_received, sets header.status=received, '
  'then emits transfer_out + transfer_in stock_movement pairs for each item with qty_received>0. '
  'Idempotency replay (same key on already-received transfer) returns cached movements list.';

COMMENT ON FUNCTION cancel_internal_transfer_v1 IS
  'MANAGER+ (inventory.transfer.create). Cancel a draft/pending transfer with a mandatory reason '
  '(>=3 chars). Persists cancel_reason + cancelled_by + cancelled_at into metadata. '
  'Refused once status is in_transit, received, or already cancelled.';
