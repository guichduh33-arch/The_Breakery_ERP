-- supabase/tests/po_update.test.sql
-- Session 46 / Wave A6 — pgTAP suite for update_purchase_order_v1.
--
-- Tests:
--   T1  — Permission gate: non-authorized user (CASHIER) raises P0003
--   T2  — Lock on GRN: cannot edit after a GRN exists (P0001 po_locked)
--   T3  — Lock on payment: cannot edit after a payment exists (P0001 po_locked)
--   T4  — Lock on status: cancelled PO cannot be edited (P0001 po_locked)
--   T5  — Happy path: edit header (payment_terms) → recomputed total unchanged
--   T6  — Happy path: replace items → totals recomputed
--   T7  — Non-raw-material product rejected in items patch (P0001)
--   T8  — Audit row inserted with action='po.updated'
--   T9  — REVOKE: anon cannot execute update_purchase_order_v1
--
-- Run via MCP execute_sql inside BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fix$
DECLARE
  v_cat_raw_id   UUID;
  v_cat_fin_id   UUID;
  v_supplier_id  UUID;
  v_prod_raw_id  UUID;
  v_prod_fin_id  UUID;
  v_section_id   UUID;
  v_mgr_uid      UUID;
  v_cashier_uid  UUID;
  v_items        JSONB;
  v_po_pending_id UUID;
  v_po_locked_id  UUID;
  v_po_cancel_id  UUID;
BEGIN
  SELECT id INTO v_cat_raw_id FROM categories WHERE category_type = 'raw_material' LIMIT 1;
  IF v_cat_raw_id IS NULL THEN SELECT id INTO v_cat_raw_id FROM categories LIMIT 1; END IF;
  SELECT id INTO v_cat_fin_id FROM categories WHERE category_type <> 'raw_material' LIMIT 1;
  IF v_cat_fin_id IS NULL THEN v_cat_fin_id := v_cat_raw_id; END IF;

  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T46_UPD_SUPP', 'S46 Update Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- Raw-material product. Under a category with category_type='raw_material'.
  -- C2: products.product_type CHECK only allows ('finished','combo'). The raw-material
  -- identity is carried by categories.category_type='raw_material', NOT by product_type.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_UPD_RAW', 'S46 Update Raw Product', v_cat_raw_id,
            5000, 200, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_prod_raw_id;

  -- Finished product (for non-raw-material rejection test).
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_UPD_FIN', 'S46 Update Finished Product', v_cat_fin_id,
            8000, 50, 'pcs', 5000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_prod_fin_id;

  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  SELECT auth_user_id INTO v_mgr_uid    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles WHERE employee_code = 'EMP001' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod_raw_id, 'quantity', 10,
                       'unit', 'kg', 'unit_cost', 1000)
  );

  -- PO 1: stays pending (for edit tests).
  SELECT (create_purchase_order_v1(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_pending_id;

  -- PO 2: will have a GRN (for lock-on-GRN test).
  SELECT (create_purchase_order_v1(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_locked_id;

  -- PO 3: will be cancelled (for lock-on-status test).
  SELECT (create_purchase_order_v1(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_cancel_id;

  -- Cancel PO 3.
  PERFORM cancel_purchase_order_v1(p_po_id := v_po_cancel_id::uuid, p_reason := 'test cancel');

  -- Receive PO 2 to get a GRN.
  DECLARE v_item_id UUID;
  BEGIN
    SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_locked_id::uuid LIMIT 1;
    PERFORM receive_purchase_order_v2(
      p_po_id          := v_po_locked_id::uuid,
      p_section_id     := v_section_id,
      p_received_items := jsonb_build_array(
        jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 10)
      )
    );
  END;

  PERFORM set_config('t46u.mgr_uid',      v_mgr_uid::text,      true);
  PERFORM set_config('t46u.cashier_uid',  v_cashier_uid::text,  true);
  PERFORM set_config('t46u.po_pending',   v_po_pending_id::text, true);
  PERFORM set_config('t46u.po_locked',    v_po_locked_id::text, true);
  PERFORM set_config('t46u.po_cancel',    v_po_cancel_id::text, true);
  PERFORM set_config('t46u.prod_raw',     v_prod_raw_id::text,  true);
  PERFORM set_config('t46u.prod_fin',     v_prod_fin_id::text,  true);
  PERFORM set_config('t46u.supplier',     v_supplier_id::text,  true);
END $fix$;

-- ─── T1: CASHIER forbidden ────────────────────────────────────────────────────
SELECT throws_ok(
  $gate$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46u.cashier_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM update_purchase_order_v1(
        p_po_id := current_setting('t46u.po_pending', true)::uuid,
        p_patch := '{"notes":"cashier try"}'::jsonb
      );
    END $blk$;
  $gate$,
  'P0003',
  NULL,
  'T1: CASHIER forbidden (P0003) on update_purchase_order_v1'
);

-- ─── T2: Lock on GRN ─────────────────────────────────────────────────────────
SELECT throws_ok(
  $grn$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46u.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM update_purchase_order_v1(
        p_po_id := current_setting('t46u.po_locked', true)::uuid,
        p_patch := '{"notes":"after GRN"}'::jsonb
      );
    END $blk$;
  $grn$,
  'P0001',
  NULL,
  'T2: po_locked (P0001) when GRN exists'
);

-- ─── T3: Lock on payment ──────────────────────────────────────────────────────
-- Manually insert a payment into po_pending (bypassing RPC) to test the lock.
-- We use a direct INSERT as postgres owner inside SECURITY DEFINER context of this DO.
DO $$
DECLARE
  v_mgr_profile UUID;
BEGIN
  SELECT id INTO v_mgr_profile FROM user_profiles
    WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  INSERT INTO purchase_payments (purchase_order_id, amount, method, paid_by, idempotency_key)
    VALUES (
      current_setting('t46u.po_pending', true)::uuid,
      1000, 'cash', v_mgr_profile,
      'e1e1e1e1-0000-0000-0000-000000000001'::uuid
    );
END $$;

SELECT throws_ok(
  $pay$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46u.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM update_purchase_order_v1(
        p_po_id := current_setting('t46u.po_pending', true)::uuid,
        p_patch := '{"notes":"after payment"}'::jsonb
      );
    END $blk$;
  $pay$,
  'P0001',
  NULL,
  'T3: po_locked (P0001) when payment exists'
);

-- Remove the test payment so subsequent tests can use this PO.
DELETE FROM purchase_payments
  WHERE purchase_order_id = current_setting('t46u.po_pending', true)::uuid;

-- ─── T4: Lock on cancelled status ────────────────────────────────────────────
SELECT throws_ok(
  $stat$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46u.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM update_purchase_order_v1(
        p_po_id := current_setting('t46u.po_cancel', true)::uuid,
        p_patch := '{"notes":"after cancel"}'::jsonb
      );
    END $blk$;
  $stat$,
  'P0001',
  NULL,
  'T4: po_locked (P0001) when status=cancelled'
);

-- ─── T5: Happy path — header patch only ───────────────────────────────────────
DO $$
DECLARE
  v_uid    UUID := current_setting('t46u.mgr_uid', true)::uuid;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  v_result := update_purchase_order_v1(
    p_po_id := current_setting('t46u.po_pending', true)::uuid,
    p_patch := '{"notes":"updated notes","payment_terms":"credit"}'::jsonb
  );
  PERFORM set_config('t46u.upd_status', v_result->>'status', true);
END $$;

SELECT is(
  (SELECT notes FROM purchase_orders
   WHERE id = current_setting('t46u.po_pending', true)::uuid),
  'updated notes',
  'T5a: header patch updated notes'
);

SELECT is(
  current_setting('t46u.upd_status', true),
  'pending',
  'T5b: PO status remains pending after header-only patch'
);

-- ─── T6: Replace items → totals recomputed ────────────────────────────────────
-- New items: 20 kg × 2000 = 40000, vat derived from old rate (0 in this case).
DO $$
DECLARE
  v_uid    UUID := current_setting('t46u.mgr_uid', true)::uuid;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  v_result := update_purchase_order_v1(
    p_po_id := current_setting('t46u.po_pending', true)::uuid,
    p_patch := jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object(
          'product_id',          current_setting('t46u.prod_raw', true),
          'quantity',            20,
          'unit',                'kg',
          'unit_cost',           2000,
          'unit_factor_to_base', 1
        )
      )
    )
  );
  PERFORM set_config('t46u.new_total', v_result->>'total_amount', true);
END $$;

SELECT is(
  (SELECT total_amount::numeric FROM purchase_orders
   WHERE id = current_setting('t46u.po_pending', true)::uuid),
  40000::numeric,
  'T6: items replaced → total_amount recomputed to 40000 (20 × 2000)'
);

-- ─── T7: Non-raw-material product rejected ────────────────────────────────────
SELECT throws_ok(
  $nonraw$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46u.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM update_purchase_order_v1(
        p_po_id := current_setting('t46u.po_pending', true)::uuid,
        p_patch := jsonb_build_object(
          'items', jsonb_build_array(
            jsonb_build_object(
              'product_id', current_setting('t46u.prod_fin', true),
              'quantity',   5,
              'unit',       'pcs',
              'unit_cost',  8000
            )
          )
        )
      );
    END $blk$;
  $nonraw$,
  'P0001',
  NULL,
  'T7: non-raw-material product in items patch raises P0001'
);

-- ─── T8: Audit row inserted ───────────────────────────────────────────────────
-- T5 (header patch) and T6 (items replace) each write a 'po.updated' row → >= 1.
SELECT ok(
  (SELECT COUNT(*)::int FROM audit_logs
   WHERE entity_id = current_setting('t46u.po_pending', true)::uuid
     AND action = 'po.updated') >= 1,
  'T8: audit_logs row with action=po.updated inserted for the update(s)'
);

-- ─── T9: REVOKE — anon cannot execute update_purchase_order_v1 ───────────────
SELECT is(
  (SELECT has_function_privilege('anon',
     'update_purchase_order_v1(uuid,jsonb)', 'execute')),
  false,
  'T9: anon does not have EXECUTE on update_purchase_order_v1'
);

SELECT * FROM finish();

ROLLBACK;
