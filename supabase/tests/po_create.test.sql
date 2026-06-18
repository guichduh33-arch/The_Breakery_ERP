-- supabase/tests/po_create.test.sql
-- Session 46 / Wave B0 — pgTAP suite for create_purchase_order_v2.
--
-- Covers the two behaviours v2 adds over the dropped v1:
--   T1 — persists unit_factor_to_base on the created line (R2/D5)
--   T2 — factor defaults to 1 when omitted (backward-compatible)
--   T3 — rejects a non raw_material product (R1/D1, P0001)
--   T4 — CASHIER forbidden (P0003 gate preserved)
--   T5 — anon does not have EXECUTE on create_purchase_order_v2 (REVOKE)
--   T6 — v1 has been dropped (monotonic versioning)
--
-- Run via MCP execute_sql inside BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

DO $fix$
DECLARE
  v_cat_raw_id  UUID;
  v_cat_fin_id  UUID;
  v_supplier_id UUID;
  v_prod_raw_id UUID;
  v_prod_fin_id UUID;
  v_mgr_uid     UUID;
  v_cashier_uid UUID;
  v_po_id       UUID;
BEGIN
  SELECT id INTO v_cat_raw_id FROM categories WHERE category_type = 'raw_material' LIMIT 1;
  SELECT id INTO v_cat_fin_id FROM categories WHERE category_type <> 'raw_material' LIMIT 1;
  IF v_cat_fin_id IS NULL THEN v_cat_fin_id := v_cat_raw_id; END IF;

  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T46_CRE_SUPP', 'S46 Create Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- Raw-material product (identity via categories.category_type, not product_type).
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_CRE_RAW', 'S46 Create Raw Product', v_cat_raw_id,
            5000, 0, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_prod_raw_id;

  -- Finished product under a non raw_material category (for rejection test).
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_CRE_FIN', 'S46 Create Finished Product', v_cat_fin_id,
            8000, 0, 'pcs', 5000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_prod_fin_id;

  SELECT auth_user_id INTO v_mgr_uid     FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles WHERE employee_code = 'EMP001' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  -- Create a PO with a NON-base unit + explicit factor 1000 (e.g. sack→kg).
  SELECT (create_purchase_order_v2(
    p_supplier_id := v_supplier_id,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', v_prod_raw_id, 'quantity', 2,
                         'unit', 'sack', 'unit_cost', 300000,
                         'unit_factor_to_base', 1000)
    ),
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_id;

  PERFORM set_config('t46c.mgr_uid',     v_mgr_uid::text,     true);
  PERFORM set_config('t46c.cashier_uid', v_cashier_uid::text, true);
  PERFORM set_config('t46c.supplier',    v_supplier_id::text, true);
  PERFORM set_config('t46c.prod_raw',    v_prod_raw_id::text, true);
  PERFORM set_config('t46c.prod_fin',    v_prod_fin_id::text, true);
  PERFORM set_config('t46c.po_factor',   v_po_id::text,       true);
END $fix$;

-- ─── T1: factor persisted ─────────────────────────────────────────────────────
SELECT is(
  (SELECT unit_factor_to_base::numeric FROM purchase_order_items
   WHERE po_id = current_setting('t46c.po_factor', true)::uuid LIMIT 1),
  1000::numeric,
  'T1: create_v2 persists unit_factor_to_base on the created line'
);

-- ─── T2: factor defaults to 1 when omitted ────────────────────────────────────
DO $$
DECLARE
  v_uid   UUID := current_setting('t46c.mgr_uid', true)::uuid;
  v_po_id UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  SELECT (create_purchase_order_v2(
    p_supplier_id := current_setting('t46c.supplier', true)::uuid,
    p_items := jsonb_build_array(
      jsonb_build_object('product_id', current_setting('t46c.prod_raw', true)::uuid,
                         'quantity', 5, 'unit', 'kg', 'unit_cost', 3000)
    ),
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_id;
  PERFORM set_config('t46c.po_default', v_po_id::text, true);
END $$;

SELECT is(
  (SELECT unit_factor_to_base::numeric FROM purchase_order_items
   WHERE po_id = current_setting('t46c.po_default', true)::uuid LIMIT 1),
  1::numeric,
  'T2: omitted unit_factor_to_base defaults to 1'
);

-- ─── T3: non raw_material rejected ────────────────────────────────────────────
SELECT throws_ok(
  $nonraw$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46c.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM create_purchase_order_v2(
        p_supplier_id := current_setting('t46c.supplier', true)::uuid,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', current_setting('t46c.prod_fin', true)::uuid,
                             'quantity', 1, 'unit', 'pcs', 'unit_cost', 8000)
        )
      );
    END $blk$;
  $nonraw$,
  'P0001',
  NULL,
  'T3: non raw_material product rejected (P0001)'
);

-- ─── T4: CASHIER forbidden ────────────────────────────────────────────────────
SELECT throws_ok(
  $gate$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46c.cashier_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM create_purchase_order_v2(
        p_supplier_id := current_setting('t46c.supplier', true)::uuid,
        p_items := jsonb_build_array(
          jsonb_build_object('product_id', current_setting('t46c.prod_raw', true)::uuid,
                             'quantity', 1, 'unit', 'kg', 'unit_cost', 3000)
        )
      );
    END $blk$;
  $gate$,
  'P0003',
  NULL,
  'T4: CASHIER forbidden (P0003)'
);

-- ─── T5: anon REVOKE ──────────────────────────────────────────────────────────
SELECT is(
  (SELECT has_function_privilege('anon',
     'create_purchase_order_v2(uuid,jsonb,date,date,text,numeric,text,uuid)', 'execute')),
  false,
  'T5: anon does not have EXECUTE on create_purchase_order_v2'
);

-- ─── T6: v1 dropped ───────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM pg_proc WHERE proname = 'create_purchase_order_v1'),
  0,
  'T6: create_purchase_order_v1 dropped (monotonic versioning)'
);

SELECT * FROM finish();

ROLLBACK;
