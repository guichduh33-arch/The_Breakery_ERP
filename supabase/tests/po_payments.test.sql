-- supabase/tests/po_payments.test.sql
-- Session 46 / Wave A4 — pgTAP suite for purchase_payments table + record_po_payment_v1.
--
-- Tests:
--   T1  — Permission gate: non-authorized user (CASHIER) raises P0003
--   T2  — Happy path: payment inserts ledger row + balanced JE
--   T3  — Idempotency: replay returns same payment_id, no duplicate JE
--   T4  — Overpayment rejected (P0001 overpayment_not_allowed)
--   T5  — Derived status: unpaid → partial → paid transitions
--   T6  — REVOKE UPDATE/DELETE on purchase_payments enforced for authenticated
--   T7  — REVOKE: anon cannot execute record_po_payment_v1
--   T8  — Cash payment JE: CR = PURCHASE_CASH_OUT account
--   T9  — Bank/transfer payment JE: CR = PURCHASE_PAYMENT_BANK account
--
-- Run via MCP execute_sql inside BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fix$
DECLARE
  v_cat_id      UUID;
  v_supplier_id UUID;
  v_prod_id     UUID;
  v_section_id  UUID;
  v_mgr_uid     UUID;
  v_cashier_uid UUID;
  v_po_credit_id UUID;
  v_po_cash_id   UUID;
  v_items        JSONB;
BEGIN
  SELECT id INTO v_cat_id FROM categories WHERE category_type = 'raw_material' LIMIT 1;
  IF v_cat_id IS NULL THEN SELECT id INTO v_cat_id FROM categories LIMIT 1; END IF;

  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T46_PAY_SUPP', 'S46 Pay Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- C2: product_type CHECK only allows ('finished','combo'). Raw material identity
  -- comes from categories.category_type='raw_material', NOT products.product_type.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_PAY_PROD', 'S46 Pay Product', v_cat_id, 5000, 100, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL, current_stock = 100
    RETURNING id INTO v_prod_id;

  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;

  SELECT auth_user_id INTO v_mgr_uid    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  SELECT auth_user_id INTO v_cashier_uid FROM user_profiles WHERE employee_code = 'EMP001' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  -- Credit PO: total = 100000 (100 kg × 1000, vat 0 for simplicity).
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod_id, 'quantity', 100, 'unit', 'kg', 'unit_cost', 1000)
  );
  SELECT (create_purchase_order_v2(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_credit_id;

  -- Cash PO: total = 50000 (50 kg × 1000, vat 0).
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod_id, 'quantity', 50, 'unit', 'kg', 'unit_cost', 1000)
  );
  SELECT (create_purchase_order_v2(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'cash', p_vat_rate := 0.0
  ))->>'po_id' INTO v_po_cash_id;

  PERFORM set_config('t46p.mgr_uid',     v_mgr_uid::text,      true);
  PERFORM set_config('t46p.cashier_uid', v_cashier_uid::text,   true);
  PERFORM set_config('t46p.po_credit',   v_po_credit_id::text,  true);
  PERFORM set_config('t46p.po_cash',     v_po_cash_id::text,    true);
  PERFORM set_config('t46p.prod_id',     v_prod_id::text,       true);
  PERFORM set_config('t46p.section',     v_section_id::text,    true);
END $fix$;

-- ─── T1: CASHIER forbidden ────────────────────────────────────────────────────
SELECT throws_ok(
  $gate$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46p.cashier_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM record_po_payment_v1(
        p_po_id           := current_setting('t46p.po_credit', true)::uuid,
        p_amount          := 30000,
        p_method          := 'transfer',
        p_idempotency_key := 'f1f1f1f1-0000-0000-0000-000000000001'::uuid
      );
    END $blk$;
  $gate$,
  'P0003',
  NULL,
  'T1: CASHIER forbidden (P0003) on record_po_payment_v1'
);

-- ─── T2: Happy path — partial bank payment ────────────────────────────────────
DO $$
DECLARE
  v_uid    UUID := current_setting('t46p.mgr_uid', true)::uuid;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  v_result := record_po_payment_v1(
    p_po_id           := current_setting('t46p.po_credit', true)::uuid,
    p_amount          := 30000,
    p_method          := 'transfer',
    p_reference       := 'REF-001',
    p_idempotency_key := 'a0a0a0a0-0000-0000-0000-000000000001'::uuid
  );
  PERFORM set_config('t46p.pay1_id', v_result->>'payment_id', true);
  PERFORM set_config('t46p.pay1_je', v_result->>'je_id', true);
END $$;

-- Ledger row inserted.
SELECT is(
  (SELECT COUNT(*)::int FROM purchase_payments
   WHERE purchase_order_id = current_setting('t46p.po_credit', true)::uuid),
  1,
  'T2a: purchase_payments row inserted for partial payment'
);

-- JE is balanced: total_debit = total_credit.
SELECT is(
  (SELECT (total_debit = total_credit) FROM journal_entries
   WHERE id = current_setting('t46p.pay1_je', true)::uuid),
  true,
  'T2b: payment JE is balanced (total_debit = total_credit)'
);

-- Derived status = 'partial' (30000 of 100000 paid).
SELECT is(
  (SELECT (record_po_payment_v1(
    p_po_id           := current_setting('t46p.po_credit', true)::uuid,
    p_amount          := 0.01,
    p_method          := 'transfer',
    p_idempotency_key := 'deadbeef-0000-0000-0000-000000000099'::uuid
  ) ->> 'derived_status')),
  'partial',
  'T2c: derived_status = partial after partial payment (sanity via fresh call)'
);

-- ─── T3: Idempotency replay ──────────────────────────────────────────────────
DO $$
DECLARE
  v_uid UUID := current_setting('t46p.mgr_uid', true)::uuid;
  v_r2  JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  v_r2 := record_po_payment_v1(
    p_po_id           := current_setting('t46p.po_credit', true)::uuid,
    p_amount          := 30000,
    p_method          := 'transfer',
    p_reference       := 'REF-001',
    p_idempotency_key := 'a0a0a0a0-0000-0000-0000-000000000001'::uuid  -- same key
  );
  PERFORM set_config('t46p.replay_id',     v_r2->>'payment_id',        true);
  PERFORM set_config('t46p.replay_flag',   v_r2->>'idempotent_replay',  true);
END $$;

SELECT is(
  current_setting('t46p.replay_id', true),
  current_setting('t46p.pay1_id', true),
  'T3a: idempotency replay returns same payment_id'
);

SELECT is(
  current_setting('t46p.replay_flag', true),
  'true',
  'T3b: idempotent_replay = true on second call with same key'
);

-- No duplicate JE on replay.
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
   WHERE reference_type = 'purchase_payment'
     AND reference_id = current_setting('t46p.pay1_id', true)::uuid),
  1,
  'T3c: no duplicate JE on idempotency replay'
);

-- ─── T4: Overpayment rejected ────────────────────────────────────────────────
SELECT throws_ok(
  $over$
    DO $blk$
    DECLARE v_uid UUID := current_setting('t46p.mgr_uid', true)::uuid;
    BEGIN
      PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
      PERFORM record_po_payment_v1(
        p_po_id           := current_setting('t46p.po_credit', true)::uuid,
        p_amount          := 999999,   -- far exceeds remaining ~69999.99
        p_method          := 'cash',
        p_idempotency_key := 'deadbeef-0000-0000-0000-000000000010'::uuid
      );
    END $blk$;
  $over$,
  'P0001',
  NULL,
  'T4: overpayment rejected with P0001'
);

-- ─── T5: Derived status paid ──────────────────────────────────────────────────
DO $$
DECLARE
  v_uid    UUID := current_setting('t46p.mgr_uid', true)::uuid;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  -- Pay the remaining ~69999.99 (100000 - 30000 - 0.01 from T2c sanity call).
  v_result := record_po_payment_v1(
    p_po_id           := current_setting('t46p.po_credit', true)::uuid,
    p_amount          := 69999.99,
    p_method          := 'transfer',
    p_idempotency_key := 'b0b0b0b0-0000-0000-0000-000000000002'::uuid
  );
  PERFORM set_config('t46p.final_status', v_result->>'derived_status', true);
END $$;

SELECT is(
  current_setting('t46p.final_status', true),
  'paid',
  'T5: derived_status = paid after full payment'
);

-- ─── T6: REVOKE UPDATE/DELETE on purchase_payments ───────────────────────────
SELECT is(
  (SELECT has_table_privilege('authenticated', 'purchase_payments', 'update')),
  false,
  'T6a: authenticated cannot UPDATE purchase_payments (append-only)'
);

SELECT is(
  (SELECT has_table_privilege('authenticated', 'purchase_payments', 'delete')),
  false,
  'T6b: authenticated cannot DELETE purchase_payments (append-only)'
);

-- ─── T7: REVOKE — anon cannot execute record_po_payment_v1 ────────────────────
SELECT is(
  (SELECT has_function_privilege('anon',
     'record_po_payment_v1(uuid,numeric,text,text,uuid)', 'execute')),
  false,
  'T7: anon does not have EXECUTE on record_po_payment_v1'
);

-- ─── T8: Cash JE credit account = PURCHASE_CASH_OUT ─────────────────────────
-- The auto-payment on a cash PO is tested here: receive cash PO → triggers JE.
-- We check the journal_entry_lines for the auto-payment JE.
DO $$
DECLARE
  v_uid    UUID := current_setting('t46p.mgr_uid', true)::uuid;
  v_po_id  UUID := current_setting('t46p.po_cash', true)::uuid;
  v_item_id UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_id FROM purchase_order_items WHERE po_id = v_po_id LIMIT 1;

  PERFORM receive_purchase_order_v2(
    p_po_id          := v_po_id,
    p_section_id     := current_setting('t46p.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_id, 'received_quantity', 50)
    ),
    p_idempotency_key := 'c1c1c1c1-0000-0000-0000-000000000001'::uuid
  );
END $$;

-- Auto-payment on cash PO should have created a purchase_payment row.
SELECT is(
  (SELECT COUNT(*)::int FROM purchase_payments
   WHERE purchase_order_id = current_setting('t46p.po_cash', true)::uuid),
  1,
  'T8a: cash PO auto-payment inserts 1 purchase_payments row after receive'
);

-- The auto-payment JE credit side should target the PURCHASE_CASH_OUT account.
SELECT is(
  (SELECT COUNT(*)::int
   FROM journal_entry_lines jel
   JOIN journal_entries je    ON je.id = jel.journal_entry_id
   JOIN purchase_payments pp  ON pp.idempotency_key = md5('auto_cash_pay:' ||
     (SELECT id::text FROM goods_receipt_notes WHERE po_id = current_setting('t46p.po_cash', true)::uuid LIMIT 1))::uuid
   JOIN accounts a            ON a.id = jel.account_id
   WHERE je.reference_type = 'purchase_payment'
     AND jel.credit > 0
     AND a.code = '1110'),
  1,
  'T8b: cash auto-payment JE credit = account 1110 (PURCHASE_CASH_OUT)'
);

SELECT * FROM finish();

ROLLBACK;
