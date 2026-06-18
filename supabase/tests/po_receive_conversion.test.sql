-- supabase/tests/po_receive_conversion.test.sql
-- Session 46 / Wave A3 — pgTAP suite for receive_purchase_order_v2.
--
-- Tests:
--   T1  — Unit factor = 1 (base unit): stock increments by received_qty (unchanged behaviour)
--   T2  — Unit factor ≠ 1 (alt unit): stock increments by received_qty × factor_to_base
--   T3  — received_quantity on PO line tracked in PO-line unit (NOT base qty)
--   T4  — Idempotency: replay returns same grn_id, no duplicate movement
--   T5  — Permission gate: non-manager (CASHIER) raises P0003
--   T6  — REVOKE: anon cannot execute receive_purchase_order_v2
--   T7  — Partial receipt leaves PO status='partial'
--   T8  — Full receipt leaves PO status='received'
--
-- Run via MCP execute_sql inside BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(13);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fix$
DECLARE
  v_cat_id       UUID;
  v_supplier_id  UUID;
  v_prod_base_id UUID;  -- base unit = 'kg', factor product
  v_prod_alt_id  UUID;  -- base unit = 'pcs', will receive in 'box' (factor=12)
  v_section_id   UUID;
  v_manager_uid  UUID;
  v_cashier_uid  UUID;
  v_po_base_id   UUID;
  v_po_alt_id    UUID;
  v_items        JSONB;
BEGIN
  -- Use an existing raw_material category (category_type='raw_material').
  SELECT id INTO v_cat_id FROM categories WHERE category_type = 'raw_material' LIMIT 1;
  IF v_cat_id IS NULL THEN
    -- Fallback: any category (some test envs may not have raw_material seeded).
    SELECT id INTO v_cat_id FROM categories LIMIT 1;
  END IF;

  -- Supplier.
  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T46_SUPP', 'Test S46 Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- Product A: base unit 'kg', factor = 1 (receives in kg).
  -- C2: product_type CHECK only allows ('finished','combo'). Raw material identity
  -- comes from categories.category_type='raw_material', NOT products.product_type.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_PROD_KG', 'Test S46 Product kg', v_cat_id, 5000, 0, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET current_stock = 0, deleted_at = NULL, is_active = true
    RETURNING id INTO v_prod_base_id;

  -- Product B: base unit 'pcs', receives in 'box' with factor 12.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_PROD_PCS', 'Test S46 Product pcs', v_cat_id, 200, 0, 'pcs', 100, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET current_stock = 0, deleted_at = NULL, is_active = true
    RETURNING id INTO v_prod_alt_id;

  -- Section.
  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  -- User profiles.
  SELECT auth_user_id INTO v_manager_uid FROM user_profiles
    WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles
    WHERE employee_code = 'EMP001' AND deleted_at IS NULL;

  -- PO for Product A (factor = 1, credit terms).
  PERFORM set_config('request.jwt.claim.sub', v_manager_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_manager_uid::text, 'role','authenticated')::text, true);

  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_prod_base_id, 'quantity', 10, 'unit', 'kg',
      'unit_cost', 3000
    )
  );
  SELECT (create_purchase_order_v2(
    p_supplier_id   := v_supplier_id,
    p_items         := v_items,
    p_payment_terms := 'credit',
    p_vat_rate      := 0.0
  ))->>'po_id' INTO v_po_base_id;

  -- PO for Product B (box → pcs, factor 12, credit terms).
  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_prod_alt_id, 'quantity', 5, 'unit', 'box',
      'unit_cost', 1200
    )
  );
  SELECT (create_purchase_order_v2(
    p_supplier_id   := v_supplier_id,
    p_items         := v_items,
    p_payment_terms := 'credit',
    p_vat_rate      := 0.0
  ))->>'po_id' INTO v_po_alt_id;

  -- Set unit_factor_to_base on the alt PO line to 12 (box = 12 pcs).
  UPDATE purchase_order_items
    SET unit_factor_to_base = 12
    WHERE po_id = v_po_alt_id::uuid
      AND product_id = v_prod_alt_id;

  -- Store in GUCs for assertion blocks.
  PERFORM set_config('t46.supplier',    v_supplier_id::text,  true);
  PERFORM set_config('t46.prod_base',   v_prod_base_id::text, true);
  PERFORM set_config('t46.prod_alt',    v_prod_alt_id::text,  true);
  PERFORM set_config('t46.section',     v_section_id::text,   true);
  PERFORM set_config('t46.manager_uid', v_manager_uid::text,  true);
  PERFORM set_config('t46.cashier_uid', v_cashier_uid::text,  true);
  PERFORM set_config('t46.po_base',     v_po_base_id::text,   true);
  PERFORM set_config('t46.po_alt',      v_po_alt_id::text,    true);
END $fix$;

-- ─── T1: Factor = 1, receive 5 kg → stock +5 kg ─────────────────────────────
DO $$
DECLARE
  v_uid     UUID := current_setting('t46.manager_uid', true)::uuid;
  v_po_id   UUID := current_setting('t46.po_base', true)::uuid;
  v_item_id UUID;
  v_result  JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;

  v_result := receive_purchase_order_v2(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('t46.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 5)
    )
  );
  PERFORM set_config('t46.grn1_id', v_result->>'grn_id', true);
END $$;

SELECT is(
  (SELECT quantity::numeric FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_base', true)
     AND movement_type = 'purchase'
   ORDER BY created_at DESC LIMIT 1),
  5::numeric,
  'T1: factor=1, 5 kg received → stock movement qty = 5 (base units)'
);

SELECT is(
  (SELECT unit FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_base', true)
     AND movement_type = 'purchase'
   ORDER BY created_at DESC LIMIT 1),
  'kg',
  'T1b: stock movement unit = products.unit (base unit = kg)'
);

-- ─── T2: Factor = 12, receive 3 boxes → stock +36 pcs ────────────────────────
DO $$
DECLARE
  v_uid     UUID := current_setting('t46.manager_uid', true)::uuid;
  v_po_id   UUID := current_setting('t46.po_alt', true)::uuid;
  v_item_id UUID;
  v_result  JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;

  v_result := receive_purchase_order_v2(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('t46.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 3)
    ),
    p_idempotency_key := 'a1b2c3d4-e5f6-7890-abcd-ef1234567891'::uuid
  );
  PERFORM set_config('t46.grn2_id', v_result->>'grn_id', true);
  PERFORM set_config('t46.grn2_idem', 'a1b2c3d4-e5f6-7890-abcd-ef1234567891', true);
END $$;

-- 3 boxes × factor 12 = 36 pcs.
SELECT is(
  (SELECT quantity::numeric FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_alt', true)
     AND movement_type = 'purchase'
   ORDER BY created_at DESC LIMIT 1),
  36::numeric,
  'T2: factor=12, receive 3 boxes → stock movement qty = 36 (base pcs)'
);

SELECT is(
  (SELECT unit FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_alt', true)
     AND movement_type = 'purchase'
   ORDER BY created_at DESC LIMIT 1),
  'pcs',
  'T2b: stock movement unit = products.unit (base unit = pcs, not box)'
);

-- ─── T3: received_quantity on PO line = 3 (PO-line unit, NOT 36) ─────────────
SELECT is(
  (SELECT received_quantity::numeric FROM purchase_order_items
   WHERE po_id = current_setting('t46.po_alt', true)::uuid
   LIMIT 1),
  3::numeric,
  'T3: received_quantity on PO item tracked in PO-line unit (3 boxes, not 36 pcs)'
);

-- ─── T4: Idempotency replay ──────────────────────────────────────────────────
DO $$
DECLARE
  v_uid     UUID := current_setting('t46.manager_uid', true)::uuid;
  v_po_id   UUID := current_setting('t46.po_alt', true)::uuid;
  v_item_id UUID;
  v_r2      JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;

  -- Second call with same idempotency_key.
  v_r2 := receive_purchase_order_v2(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('t46.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 3)
    ),
    p_idempotency_key := current_setting('t46.grn2_idem', true)::uuid
  );
  PERFORM set_config('t46.replay_grn_id',   v_r2->>'grn_id',            true);
  PERFORM set_config('t46.replay_is_replay', (v_r2->>'idempotent_replay'), true);
END $$;

SELECT is(
  current_setting('t46.replay_grn_id', true),
  current_setting('t46.grn2_id', true),
  'T4a: idempotency replay returns same grn_id'
);

SELECT is(
  current_setting('t46.replay_is_replay', true),
  'true',
  'T4b: idempotency replay flag = true'
);

-- No duplicate stock movement (still exactly 1 for the alt PO).
SELECT is(
  (SELECT COUNT(*)::int FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_alt', true)
     AND movement_type = 'purchase'),
  1,
  'T4c: idempotency replay does not create a duplicate stock movement'
);

-- ─── T5: CASHIER forbidden ────────────────────────────────────────────────────
SELECT throws_ok(
  $gate$
    DO $blk$
    DECLARE
      v_uid     UUID := current_setting('t46.cashier_uid', true)::uuid;
      v_po_id   UUID := current_setting('t46.po_base', true)::uuid;
      v_item_id UUID;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;
      PERFORM receive_purchase_order_v2(
        p_po_id          := v_po_id,
        p_section_id     := current_setting('t46.section', true)::uuid,
        p_received_items := jsonb_build_array(
          jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 1)
        )
      );
    END $blk$;
  $gate$,
  'P0003',
  NULL,
  'T5: CASHIER forbidden (P0003) on receive_purchase_order_v2'
);

-- ─── T6: REVOKE — anon cannot execute ────────────────────────────────────────
SELECT is(
  (SELECT has_function_privilege('anon',
     'receive_purchase_order_v2(uuid,uuid,jsonb,uuid)', 'execute')),
  false,
  'T6: anon does not have EXECUTE on receive_purchase_order_v2'
);

-- ─── T7 + T8: Partial → Full receipt status ──────────────────────────────────
-- T7: After receiving 3/5 boxes → status='partial'
SELECT is(
  (SELECT status::text FROM purchase_orders
   WHERE id = current_setting('t46.po_alt', true)::uuid),
  'partial',
  'T7: PO status = partial after receiving 3 of 5 PO-line units'
);

-- T8: Receive remaining 2 boxes → status='received'
DO $$
DECLARE
  v_uid     UUID := current_setting('t46.manager_uid', true)::uuid;
  v_po_id   UUID := current_setting('t46.po_alt', true)::uuid;
  v_item_id UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;
  PERFORM receive_purchase_order_v2(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('t46.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 2)
    )
  );
END $$;

SELECT is(
  (SELECT status::text FROM purchase_orders
   WHERE id = current_setting('t46.po_alt', true)::uuid),
  'received',
  'T8: PO status = received after all PO-line units received'
);

-- Total stock for alt product = 3+2 = 5 boxes × 12 = 60 pcs in base unit.
SELECT is(
  (SELECT SUM(quantity)::numeric FROM stock_movements
   WHERE metadata->>'po_id' = current_setting('t46.po_alt', true)
     AND movement_type = 'purchase'),
  60::numeric,
  'T8b: total base-unit stock movements = 60 pcs (5 boxes × 12)'
);

SELECT * FROM finish();

ROLLBACK;
