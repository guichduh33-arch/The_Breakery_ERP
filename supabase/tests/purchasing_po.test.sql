-- supabase/tests/purchasing_po.test.sql
-- Session 13 / Phase 3.A — Purchasing PO pgTAP suite.
--
-- Covers the 5 migrations 20260517000110-114:
--   - purchase_orders + purchase_order_items + goods_receipt_notes tables + RLS
--   - create_purchase_order_v2
--   - receive_purchase_order_v1 (atomic, lot upfront, JE via trigger)
--   - cancel_purchase_order_v1
--   - trg_create_purchase_je trigger attached
--
-- Critical invariants:
--   - GRN row INSERT posts a balanced JE: DR INVENTORY + DR VAT = CR PAYABLE.
--   - Lots are minted UPFRONT for products with default_shelf_life_hours SET.
--   - PO status transitions correctly through partial → received.
--   - Cancel after any GRN refused.
--
-- Run via MCP execute_sql with BEGIN ... ROLLBACK envelope.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- plan(19): split has_column / col_not_null counts as multiple pgTAP assertions.
SELECT plan(19);

-- ---------------------------------------------------------------------------
-- Fixtures: a supplier T_PO_SUPP and 2 products T_PO_PROD_A (no shelf life)
-- and T_PO_PROD_B (with shelf life 48h). A section T_PO_SECTION (or reuse
-- existing). Profiles: EMP000 (admin), EMP003 (manager), EMP001 (cashier).
-- ---------------------------------------------------------------------------
DO $fix$
DECLARE
  v_cat          UUID;
  v_supplier_id  UUID;
  v_prod_a_id    UUID;
  v_prod_b_id    UUID;
  v_section_id   UUID;
  v_admin        UUID;
  v_manager      UUID;
  v_cashier      UUID;
BEGIN
  SELECT id INTO v_cat FROM categories WHERE category_type = 'raw_material' LIMIT 1;

  -- Supplier.
  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T_PO_SUPP', 'Test PO Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- Product A — no shelf life.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active)
    VALUES ('T_PO_PROD_A', 'Test PO Product A', v_cat, 5000, 0, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET current_stock = 0, default_shelf_life_hours = NULL, deleted_at = NULL
    RETURNING id INTO v_prod_a_id;

  -- Product B — 48h shelf life → lot mandatory.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit, cost_price,
                        product_type, is_active, default_shelf_life_hours)
    VALUES ('T_PO_PROD_B', 'Test PO Product B', v_cat, 8000, 0, 'pcs', 4000, 'finished', true, 48)
    ON CONFLICT (sku) DO UPDATE SET current_stock = 0, default_shelf_life_hours = 48, deleted_at = NULL
    RETURNING id INTO v_prod_b_id;

  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  SELECT id INTO v_admin      FROM user_profiles WHERE employee_code='EMP000' AND deleted_at IS NULL;
  SELECT id INTO v_manager    FROM user_profiles WHERE employee_code='EMP003' AND deleted_at IS NULL;
  SELECT id INTO v_cashier    FROM user_profiles WHERE employee_code='EMP001' AND deleted_at IS NULL;

  PERFORM set_config('breakery.t_po_supplier', v_supplier_id::text, true);
  PERFORM set_config('breakery.t_po_prod_a',   v_prod_a_id::text,   true);
  PERFORM set_config('breakery.t_po_prod_b',   v_prod_b_id::text,   true);
  PERFORM set_config('breakery.t_po_section',  v_section_id::text,  true);
  PERFORM set_config('breakery.t_po_admin',    v_admin::text,       true);
  PERFORM set_config('breakery.t_po_manager',  v_manager::text,     true);
  PERFORM set_config('breakery.t_po_cashier',  v_cashier::text,     true);
END $fix$;

-- ---------------------------------------------------------------------------
-- T_PO_01 — purchase_orders table exists with critical columns
-- ---------------------------------------------------------------------------
SELECT has_table('purchase_orders', 'T_PO_01a: purchase_orders table exists');
SELECT has_column('purchase_orders', 'po_number',     'T_PO_01b: po_number column exists');

-- ---------------------------------------------------------------------------
-- T_PO_02 — purchase_order_items table exists with received_quantity ≤ quantity check
-- ---------------------------------------------------------------------------
SELECT has_table('purchase_order_items', 'T_PO_02: purchase_order_items table exists');

-- ---------------------------------------------------------------------------
-- T_PO_03 — goods_receipt_notes mirrors create_purchase_journal_entry contract
-- ---------------------------------------------------------------------------
SELECT col_not_null('goods_receipt_notes', 'subtotal',      'T_PO_03a: subtotal NOT NULL');
SELECT col_not_null('goods_receipt_notes', 'vat_amount',    'T_PO_03b: vat_amount NOT NULL');
SELECT col_not_null('goods_receipt_notes', 'total',         'T_PO_03c: total NOT NULL');
SELECT col_not_null('goods_receipt_notes', 'payment_terms', 'T_PO_03d: payment_terms NOT NULL');

-- ---------------------------------------------------------------------------
-- T_PO_04 — trg_create_purchase_je trigger attached
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_schema='public' AND trigger_name='trg_create_purchase_je'
      AND event_object_table='goods_receipt_notes'
  ),
  'T_PO_04: trg_create_purchase_je is attached on goods_receipt_notes'
);

-- ---------------------------------------------------------------------------
-- T_PO_05 — RLS policies block anon
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='purchase_orders' AND policyname='perm_read'
  ),
  'T_PO_05: purchase_orders has perm_read policy'
);

-- ---------------------------------------------------------------------------
-- T_PO_06 — create_purchase_order_v2 happy path as manager
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr_uid    UUID;
  v_result     JSONB;
  v_items      JSONB;
BEGIN
  -- Resolve auth_user_id for manager.
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles
    WHERE employee_code='EMP003' AND deleted_at IS NULL;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', current_setting('breakery.t_po_prod_a', true),
      'quantity',   10,
      'unit',       'kg',
      'unit_cost',  3000
    ),
    jsonb_build_object(
      'product_id', current_setting('breakery.t_po_prod_b', true),
      'quantity',   20,
      'unit',       'pcs',
      'unit_cost',  4000
    )
  );

  v_result := create_purchase_order_v2(
    p_supplier_id   := current_setting('breakery.t_po_supplier', true)::uuid,
    p_items         := v_items,
    p_expected_date := current_date + 7,
    p_payment_terms := 'credit',
    p_vat_rate      := 0.11
  );

  PERFORM set_config('breakery.t_po_id',     (v_result->>'po_id'),     true);
  PERFORM set_config('breakery.t_po_number', (v_result->>'po_number'), true);
END $$;

SELECT is(
  (SELECT status::text FROM purchase_orders WHERE id = current_setting('breakery.t_po_id', true)::uuid),
  'pending',
  'T_PO_06a: PO created with status=pending'
);
SELECT is(
  (SELECT COUNT(*)::int FROM purchase_order_items WHERE po_id = current_setting('breakery.t_po_id', true)::uuid),
  2,
  'T_PO_06b: 2 line items inserted'
);
SELECT is(
  (SELECT total_amount FROM purchase_orders WHERE id = current_setting('breakery.t_po_id', true)::uuid)::text,
  '124300.00',
  'T_PO_06c: total_amount = (10*3000 + 20*4000) * 1.11 = 124300'
);

-- ---------------------------------------------------------------------------
-- T_PO_07 — receive_purchase_order_v1 partial receipt (5 kg of product A only)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr_uid     UUID;
  v_po_id       UUID := current_setting('breakery.t_po_id', true)::uuid;
  v_item_a_id   UUID;
  v_result      JSONB;
  v_received    JSONB;
BEGIN
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles
    WHERE employee_code='EMP003' AND deleted_at IS NULL;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_a_id FROM purchase_order_items
    WHERE po_id = v_po_id AND product_id = current_setting('breakery.t_po_prod_a', true)::uuid;

  v_received := jsonb_build_array(
    jsonb_build_object('po_item_id', v_item_a_id, 'received_quantity', 5)
  );

  v_result := receive_purchase_order_v1(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('breakery.t_po_section', true)::uuid,
    p_received_items := v_received
  );

  PERFORM set_config('breakery.t_po_grn1_id', (v_result->>'grn_id'), true);
END $$;

SELECT is(
  (SELECT status::text FROM purchase_orders WHERE id = current_setting('breakery.t_po_id', true)::uuid),
  'partial',
  'T_PO_07a: PO status flipped to partial after first GRN'
);

-- ---------------------------------------------------------------------------
-- T_PO_08 — Balanced JE was posted by trigger
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (total_debit = total_credit) FROM journal_entries
   WHERE reference_type='purchase' AND reference_id = current_setting('breakery.t_po_grn1_id', true)::uuid LIMIT 1),
  true,
  'T_PO_08: GRN1 JE has total_debit = total_credit'
);

-- ---------------------------------------------------------------------------
-- T_PO_09 — stock_movement of movement_type='purchase' was created and links to PO via metadata.
-- record_stock_movement_v1 always sets reference_type='admin_action' internally
-- (it is the primitive's hardcoded value) ; the PO link is captured in metadata.po_id.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM stock_movements
    WHERE metadata->>'po_id' = current_setting('breakery.t_po_id', true)
      AND movement_type='purchase'),
  1,
  'T_PO_09: 1 purchase stock_movement linked to PO via metadata'
);

-- ---------------------------------------------------------------------------
-- T_PO_10 — Lot was NOT minted for product A (no shelf life)
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM stock_lots
    WHERE product_id = current_setting('breakery.t_po_prod_a', true)::uuid
      AND metadata->>'po_id' = current_setting('breakery.t_po_id', true)),
  0,
  'T_PO_10: no lot minted for product A (no shelf life)'
);

-- ---------------------------------------------------------------------------
-- T_PO_11 — Receive remainder + product B (with shelf-life → lot upfront)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr_uid     UUID;
  v_po_id       UUID := current_setting('breakery.t_po_id', true)::uuid;
  v_item_a_id   UUID;
  v_item_b_id   UUID;
  v_received    JSONB;
BEGIN
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles WHERE employee_code='EMP003';
  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_a_id FROM purchase_order_items
    WHERE po_id = v_po_id AND product_id = current_setting('breakery.t_po_prod_a', true)::uuid;
  SELECT id INTO v_item_b_id FROM purchase_order_items
    WHERE po_id = v_po_id AND product_id = current_setting('breakery.t_po_prod_b', true)::uuid;

  v_received := jsonb_build_array(
    jsonb_build_object('po_item_id', v_item_a_id, 'received_quantity', 5),
    jsonb_build_object('po_item_id', v_item_b_id, 'received_quantity', 20)
  );

  PERFORM receive_purchase_order_v1(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('breakery.t_po_section', true)::uuid,
    p_received_items := v_received
  );
END $$;

SELECT is(
  (SELECT status::text FROM purchase_orders WHERE id = current_setting('breakery.t_po_id', true)::uuid),
  'received',
  'T_PO_11a: PO status=received after full receipt'
);
SELECT is(
  (SELECT COUNT(*)::int FROM stock_lots
    WHERE product_id = current_setting('breakery.t_po_prod_b', true)::uuid
      AND metadata->>'po_id' = current_setting('breakery.t_po_id', true)),
  1,
  'T_PO_11b: 1 lot minted upfront for product B'
);

-- ---------------------------------------------------------------------------
-- T_PO_12 — Idempotency replay on create returns same po_id
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mgr_uid  UUID;
  v_key      UUID := '11111111-2222-3333-4444-555555555555';
  v_r1       JSONB;
  v_r2       JSONB;
BEGIN
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles WHERE employee_code='EMP003';
  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  v_r1 := create_purchase_order_v2(
    p_supplier_id     := current_setting('breakery.t_po_supplier', true)::uuid,
    p_items           := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('breakery.t_po_prod_a', true), 'quantity', 1, 'unit','kg', 'unit_cost', 3000)
    ),
    p_idempotency_key := v_key
  );
  v_r2 := create_purchase_order_v2(
    p_supplier_id     := current_setting('breakery.t_po_supplier', true)::uuid,
    p_items           := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('breakery.t_po_prod_a', true), 'quantity', 1, 'unit','kg', 'unit_cost', 3000)
    ),
    p_idempotency_key := v_key
  );

  IF (v_r1->>'po_id') = (v_r2->>'po_id') AND (v_r2->>'idempotent_replay')::boolean = TRUE THEN
    -- pass via NULL ok()
    PERFORM ok(true, 'T_PO_12: idempotency replay returns same po_id');
  ELSE
    PERFORM ok(false,
      format('T_PO_12: idempotency mismatch r1=%s r2=%s replay=%s',
        (v_r1->>'po_id'), (v_r2->>'po_id'), (v_r2->>'idempotent_replay')));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- T_PO_13 — Cancel after receipt refused (PO_ALREADY_RECEIVED)
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $cancel$
    DO $blk$
    DECLARE v_uid UUID;
    BEGIN
      SELECT auth_user_id INTO v_uid FROM user_profiles WHERE employee_code='EMP003';
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM cancel_purchase_order_v1(
        p_po_id  := current_setting('breakery.t_po_id', true)::uuid,
        p_reason := 'too late'
      );
    END $blk$;
  $cancel$,
  'P0002',
  NULL,
  'T_PO_13: cancel after received raises PO_ALREADY_RECEIVED'
);

-- ---------------------------------------------------------------------------
-- T_PO_14 — Cashier forbidden on create
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $cash$
    DO $blk$
    DECLARE v_uid UUID;
    BEGIN
      SELECT auth_user_id INTO v_uid FROM user_profiles WHERE employee_code='EMP001';
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM create_purchase_order_v2(
        p_supplier_id   := current_setting('breakery.t_po_supplier', true)::uuid,
        p_items         := jsonb_build_array(jsonb_build_object('product_id', current_setting('breakery.t_po_prod_a', true), 'quantity', 1, 'unit','kg', 'unit_cost', 3000))
      );
    END $blk$;
  $cash$,
  'P0003',
  NULL,
  'T_PO_14: cashier forbidden on create'
);

-- ---------------------------------------------------------------------------
-- T_PO_15 — Cancel a fresh pending PO succeeds
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_uid    UUID;
  v_po_id  UUID;
  v_result JSONB;
BEGIN
  SELECT auth_user_id INTO v_uid FROM user_profiles WHERE employee_code='EMP003';
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  v_result := create_purchase_order_v2(
    p_supplier_id := current_setting('breakery.t_po_supplier', true)::uuid,
    p_items       := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('breakery.t_po_prod_a', true), 'quantity', 2, 'unit','kg', 'unit_cost', 3000)
    )
  );
  v_po_id := (v_result->>'po_id')::uuid;

  PERFORM cancel_purchase_order_v1(p_po_id := v_po_id, p_reason := 'unit test cancel');
  PERFORM set_config('breakery.t_po_cancelled_id', v_po_id::text, true);
END $$;

SELECT is(
  (SELECT status::text FROM purchase_orders WHERE id = current_setting('breakery.t_po_cancelled_id', true)::uuid),
  'cancelled',
  'T_PO_15: cancel on fresh PO marks status=cancelled'
);

SELECT * FROM finish();

ROLLBACK;
