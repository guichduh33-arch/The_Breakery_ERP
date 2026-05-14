-- 20260517000064_create_revert_production_rpc.sql
-- Session 13 / Phase 2.A — revert_production_v1 RPC + tr_stock_movement_je()
--                          reverse-of-production guard.
--
-- ADMIN+ only. Reverses a production batch within a 24-hour window :
--   1. Permission gate inventory.production.delete.
--   2. Lookup production_records (raise production_not_found / already_reverted /
--      production_too_old).
--   3. For each original movement (production_in or production_out), INSERT a
--      counter-row with NEGATED quantity + metadata.reverse_of_production=true.
--      The patched trigger tr_stock_movement_je() now SKIPS rows tagged with
--      that metadata flag — counter-JEs are inserted explicitly by this RPC.
--   4. Insert reverse JEs : for each original (non-reversed) JE referencing a
--      production movement, write a counter-JE with swapped debit/credit on
--      each line. Set journal_entries.metadata.reverse_of_production=true and
--      record the original_je_id for audit.
--   5. If the production created a stock_lots row, set status='consumed' +
--      quantity=0 (lot is voided ; we do not re-credit specific lots on revert
--      in MVP — documented in wave-2-deviations.md).
--   6. UPDATE production_records SET reverted_at=now(), reverted_by, reverted_reason,
--      stock_updated=false, materials_consumed=false, je_posted=false.
--
-- Append-only stock_movements ledger respected : counter-rows are INSERTed,
-- originals are never UPDATEd/DELETEd.
--
-- Sub-plan decisions D-2A-8, D-2A-9, D-2A-14.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1) Patch tr_stock_movement_je() to skip reverse-of-production rows.
--    CREATE OR REPLACE FUNCTION (not has_permission — CI grep gate untouched).
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION tr_stock_movement_je()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_je_id       UUID;
  v_existing    UUID;
  v_entry_no    TEXT;
  v_value       DECIMAL(14,2);
  v_cost_price  DECIMAL(14,2);
  v_dr_account  UUID;
  v_cr_account  UUID;
  v_dr_desc     TEXT;
  v_cr_desc     TEXT;
  v_dr_key      TEXT;
  v_cr_key      TEXT;
BEGIN
  -- Skip rows explicitly flagged as production reversal — counter-JE is
  -- INSERTed by revert_production_v1 itself with swapped DR/CR.
  IF (NEW.metadata->>'reverse_of_production') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Only the movement types with accounting impact are handled.
  IF NEW.movement_type NOT IN (
    'waste',
    'adjustment_in', 'adjustment_out',
    'opname_in',     'opname_out',
    'production_in', 'production_out'
  ) THEN
    RETURN NEW;
  END IF;

  v_cost_price := COALESCE(NEW.unit_cost, (SELECT cost_price FROM products WHERE id = NEW.product_id), 0);
  v_value      := round_idr(v_cost_price * ABS(NEW.quantity));

  IF v_value <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing FROM journal_entries
    WHERE reference_type = 'stock_movement'
      AND reference_id   = NEW.id
      AND metadata->>'movement_type' = NEW.movement_type::TEXT
    LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM check_fiscal_period_open(NEW.created_at::date);

  CASE NEW.movement_type
    WHEN 'waste' THEN
      v_dr_key := 'WASTE_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Stock waste'; v_cr_desc := 'Inventory consumed (waste)';
    WHEN 'adjustment_in' THEN
      v_dr_key := 'INVENTORY_GENERAL'; v_cr_key := 'ADJUSTMENT_INCOME';
      v_dr_desc := 'Inventory positive adjustment'; v_cr_desc := 'Adjustment income';
    WHEN 'adjustment_out' THEN
      v_dr_key := 'ADJUSTMENT_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Adjustment expense'; v_cr_desc := 'Inventory negative adjustment';
    WHEN 'opname_in' THEN
      v_dr_key := 'INVENTORY_GENERAL'; v_cr_key := 'OPNAME_INCOME';
      v_dr_desc := 'Opname positive variance'; v_cr_desc := 'Opname income';
    WHEN 'opname_out' THEN
      v_dr_key := 'OPNAME_EXPENSE'; v_cr_key := 'INVENTORY_GENERAL';
      v_dr_desc := 'Opname expense'; v_cr_desc := 'Opname negative variance';
    WHEN 'production_in' THEN
      v_dr_key := 'INVENTORY_FINISHED_GOODS'; v_cr_key := 'PRODUCTION_COGS';
      v_dr_desc := 'Finished goods produced'; v_cr_desc := 'COGS reversal (paired with production_out)';
    WHEN 'production_out' THEN
      v_dr_key := 'PRODUCTION_COGS'; v_cr_key := 'INVENTORY_RAW_MATERIAL';
      v_dr_desc := 'Raw material consumed'; v_cr_desc := 'Inventory raw material';
    ELSE
      RETURN NEW;
  END CASE;

  v_dr_account := resolve_mapping_account(v_dr_key);
  v_cr_account := resolve_mapping_account(v_cr_key);

  v_entry_no := next_journal_entry_number(NEW.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by, metadata
  ) VALUES (
    v_entry_no,
    NEW.created_at::date,
    'Stock movement ' || NEW.movement_type::TEXT || ' for product ' || NEW.product_id::TEXT,
    'stock_movement',
    NEW.id,
    'posted',
    v_value,
    v_value,
    NEW.created_by,
    jsonb_build_object('movement_type', NEW.movement_type::TEXT)
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_account, v_value, 0,       v_dr_desc),
    (v_je_id, v_cr_account, 0,       v_value, v_cr_desc);

  RETURN NEW;
END $$;

COMMENT ON FUNCTION tr_stock_movement_je() IS
  'D11/D12/D20 [m4] split 2/3 + Phase 2.A patch — JE for waste / adjustment / '
  'opname / production. SKIPS rows with metadata.reverse_of_production=true '
  '(counter-JE inserted by revert_production_v1). Resolves accounts via '
  'mapping ; period-guarded ; idempotent via UNIQUE (reference_type, '
  'reference_id, metadata->>movement_type). Attached as tr_20_je_emit.';

REVOKE EXECUTE ON FUNCTION tr_stock_movement_je() FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2) revert_production_v1
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION revert_production_v1(
  p_production_id UUID,
  p_reason        TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_pr           RECORD;
  v_orig_mv      RECORD;
  v_orig_je      RECORD;
  v_je_line      RECORD;
  v_new_mv_id    UUID;
  v_new_je_id    UUID;
  v_entry_no     TEXT;
  v_mv_count     INT := 0;
  v_je_count     INT := 0;
  v_orig_lot_id  UUID;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.delete') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT * INTO v_pr FROM production_records WHERE id = p_production_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_pr.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_reverted' USING ERRCODE='P0001';
  END IF;

  IF v_pr.production_date < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'production_too_old' USING ERRCODE='P0001';
  END IF;

  -- INSERT counter movements (skipping the JE trigger via metadata flag).
  FOR v_orig_mv IN
    SELECT sm.*
      FROM stock_movements sm
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
        AND sm.movement_type IN ('production_in','production_out')
      ORDER BY sm.created_at
  LOOP
    -- Direct INSERT — SECURITY DEFINER bypasses RLS, and the patched trigger
    -- skips rows tagged with reverse_of_production=true.
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, unit, reason, unit_cost,
      supplier_id, idempotency_key, reference_type, reference_id, created_by,
      from_section_id, to_section_id, metadata, lot_id
    ) VALUES (
      v_orig_mv.product_id,
      v_orig_mv.movement_type,                -- same type, negated quantity
      -v_orig_mv.quantity,                    -- negate
      v_orig_mv.unit,
      'Reversal of ' || v_orig_mv.reason,
      v_orig_mv.unit_cost,
      v_orig_mv.supplier_id,
      NULL,                                   -- no idempotency on reversal row
      'production',
      p_production_id,
      v_profile,
      -- Swap section direction : production_in had to_section; on reversal we put it in from_section.
      v_orig_mv.to_section_id,
      v_orig_mv.from_section_id,
      jsonb_build_object(
        'reverse_of_production',  true,
        'original_movement_id',   v_orig_mv.id,
        'production_id',          p_production_id,
        'production_number',      v_pr.production_number,
        'reason',                 p_reason
      ),
      NULL    -- reversal does not pin a lot ; lots voided separately below
    ) RETURNING id INTO v_new_mv_id;

    -- Hand-update products.current_stock since we bypassed record_stock_movement_v1.
    UPDATE products SET current_stock = current_stock - v_orig_mv.quantity
      WHERE id = v_orig_mv.product_id;

    -- Hand-update section_stock symmetric to the original direction.
    IF v_orig_mv.quantity > 0 AND v_orig_mv.to_section_id IS NOT NULL THEN
      -- Original was an +in to to_section → reversal is -from that section.
      UPDATE section_stock
        SET quantity = quantity - v_orig_mv.quantity, updated_at = now()
        WHERE section_id = v_orig_mv.to_section_id AND product_id = v_orig_mv.product_id;
    ELSIF v_orig_mv.quantity < 0 AND v_orig_mv.from_section_id IS NOT NULL THEN
      -- Original was -out from from_section → reversal is +back to that section.
      INSERT INTO section_stock (section_id, product_id, quantity, unit)
        VALUES (v_orig_mv.from_section_id, v_orig_mv.product_id, -v_orig_mv.quantity, v_orig_mv.unit)
        ON CONFLICT (section_id, product_id) DO UPDATE
          SET quantity = section_stock.quantity + EXCLUDED.quantity, updated_at = now();
    END IF;

    v_mv_count := v_mv_count + 1;
  END LOOP;

  -- INSERT counter JEs (one per original JE).
  FOR v_orig_je IN
    SELECT je.id AS je_id, je.entry_date, je.total_debit, je.total_credit, je.reference_id, je.metadata
      FROM journal_entries je
      JOIN stock_movements sm ON sm.id = je.reference_id
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND je.reference_type = 'stock_movement'
        AND COALESCE(je.metadata->>'reverse_of_production','false') = 'false'
  LOOP
    v_entry_no := next_journal_entry_number(now()::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      v_entry_no,
      now()::date,
      'Reversal of production ' || v_pr.production_number,
      'production',
      p_production_id,
      'posted',
      v_orig_je.total_debit,
      v_orig_je.total_credit,
      v_profile,
      jsonb_build_object(
        'reverse_of_production', true,
        'original_je_id',        v_orig_je.je_id,
        'production_id',         p_production_id,
        'production_number',     v_pr.production_number,
        'reason',                p_reason,
        -- Discriminate per original-JE-id to satisfy
        -- journal_entries_je_idempotency_uniq (reference_type, reference_id,
        -- metadata->>'movement_type'). Multiple reversal JEs share the same
        -- reference_type='production' + reference_id ; vary the movement_type
        -- discriminant per original to keep them unique.
        'movement_type',         'reversal:' || (v_orig_je.metadata->>'movement_type') || ':' || v_orig_je.je_id::text
      )
    ) RETURNING id INTO v_new_je_id;

    -- Mirror lines with swapped debit/credit.
    FOR v_je_line IN
      SELECT account_id, debit, credit, description
        FROM journal_entry_lines
        WHERE journal_entry_id = v_orig_je.je_id
    LOOP
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (
          v_new_je_id,
          v_je_line.account_id,
          v_je_line.credit,         -- swap
          v_je_line.debit,
          'Reversal: ' || v_je_line.description
        );
    END LOOP;

    v_je_count := v_je_count + 1;
  END LOOP;

  -- Void any stock_lots created by the original production_in.
  SELECT lot_id INTO v_orig_lot_id
    FROM stock_movements
    WHERE metadata->>'production_id' = p_production_id::text
      AND movement_type = 'production_in'
      AND COALESCE(metadata->>'reverse_of_production','false') = 'false'
      AND lot_id IS NOT NULL
    LIMIT 1;

  IF v_orig_lot_id IS NOT NULL THEN
    UPDATE stock_lots
      SET quantity = 0, status = 'consumed', updated_at = now()
      WHERE id = v_orig_lot_id;
  END IF;

  -- Soft-revert the production_records row.
  UPDATE production_records
    SET reverted_at        = now(),
        reverted_by        = v_profile,
        reverted_reason    = p_reason,
        materials_consumed = FALSE,
        stock_updated      = FALSE,
        je_posted          = FALSE,
        updated_at         = now()
    WHERE id = p_production_id;

  -- Audit.
  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES (
    'production.revert', 'production_records', p_production_id,
    jsonb_build_object(
      'reason',                  p_reason,
      'reverse_movements_count', v_mv_count,
      'reverse_je_count',        v_je_count,
      'voided_lot_id',           v_orig_lot_id
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',           p_production_id,
    'reverse_movements_count', v_mv_count,
    'reverse_je_count',        v_je_count,
    'voided_lot_id',           v_orig_lot_id
  );
END $$;

GRANT EXECUTE ON FUNCTION revert_production_v1 TO authenticated;
REVOKE EXECUTE ON FUNCTION revert_production_v1 FROM anon;

COMMENT ON FUNCTION revert_production_v1 IS
  'Session 13 — Phase 2.A. SECURITY DEFINER public RPC. Reverses a production '
  'batch within 24h. Inserts counter stock_movements (with reverse_of_production '
  'metadata flag → trigger skips), inserts counter JEs with swapped lines, '
  'voids stock_lots. Sets production_records.reverted_at. ADMIN+ only via '
  'inventory.production.delete.';
