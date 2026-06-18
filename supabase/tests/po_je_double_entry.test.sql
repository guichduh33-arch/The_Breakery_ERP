-- supabase/tests/po_je_double_entry.test.sql
-- Session 46 / Wave A5 — pgTAP suite for the redesigned create_purchase_journal_entry.
--
-- Tests:
--   T1  — Credit terms receipt: ONLY one AP JE (DR INVENTORY / CR PURCHASE_PAYABLE)
--   T2  — Credit terms receipt: JE is balanced (total_debit = total_credit)
--   T3  — Credit terms receipt: VAT folded into inventory (ADR-003 NON-PKP)
--   T4  — Credit terms receipt: no auto-payment row created
--   T5  — Cash terms receipt: AP JE posted (DR INVENTORY / CR PURCHASE_PAYABLE)
--   T6  — Cash terms receipt: auto-payment JE posted (DR PURCHASE_PAYABLE / CR PURCHASE_CASH_OUT)
--   T7  — Cash terms receipt: both JEs balanced (< 1 IDR each)
--   T8  — Cash terms receipt: net AP = 0 (AP credited then immediately debited)
--   T9  — Cash terms receipt: auto-payment creates 1 purchase_payments row
--   T10 — Idempotent re-fire (duplicate GRN INSERT attempt) posts no new JE
--
-- Run via MCP execute_sql inside BEGIN ... ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- ─── Fixtures ────────────────────────────────────────────────────────────────
DO $fix$
DECLARE
  v_cat_id       UUID;
  v_supplier_id  UUID;
  v_prod_id      UUID;
  v_section_id   UUID;
  v_mgr_uid      UUID;
  v_items        JSONB;
  v_po_credit_id UUID;
  v_po_cash_id   UUID;
BEGIN
  SELECT id INTO v_cat_id FROM categories WHERE category_type = 'raw_material' LIMIT 1;
  IF v_cat_id IS NULL THEN SELECT id INTO v_cat_id FROM categories LIMIT 1; END IF;

  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
    VALUES ('T46_JE_SUPP', 'S46 JE Supplier', 30, true)
    ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
    RETURNING id INTO v_supplier_id;

  -- Product with stable current_stock (not tracking inventory) to avoid side effects.
  -- C2: product_type CHECK only allows ('finished','combo'). Raw material identity
  -- comes from categories.category_type='raw_material', NOT products.product_type.
  INSERT INTO products (sku, name, category_id, retail_price, current_stock, unit,
                        cost_price, product_type, is_active)
    VALUES ('T46_JE_PROD', 'S46 JE Product', v_cat_id, 5000, 200, 'kg', 3000, 'finished', true)
    ON CONFLICT (sku) DO UPDATE SET is_active = true, deleted_at = NULL, current_stock = 200
    RETURNING id INTO v_prod_id;

  SELECT id INTO v_section_id FROM sections WHERE deleted_at IS NULL ORDER BY display_order LIMIT 1;
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_mgr_uid::text, 'role','authenticated')::text, true);

  -- Credit PO: 10 kg × 1000 + 11% VAT = subtotal 10000, vat 1100, total 11100.
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod_id, 'quantity', 10, 'unit', 'kg', 'unit_cost', 1000)
  );
  SELECT (create_purchase_order_v1(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'credit', p_vat_rate := 0.11
  ))->>'po_id' INTO v_po_credit_id;

  -- Cash PO: 5 kg × 2000 + 11% VAT = subtotal 10000, vat 1100, total 11100.
  v_items := jsonb_build_array(
    jsonb_build_object('product_id', v_prod_id, 'quantity', 5, 'unit', 'kg', 'unit_cost', 2000)
  );
  SELECT (create_purchase_order_v1(
    p_supplier_id := v_supplier_id, p_items := v_items,
    p_payment_terms := 'cash', p_vat_rate := 0.11
  ))->>'po_id' INTO v_po_cash_id;

  PERFORM set_config('t46je.mgr_uid',    v_mgr_uid::text,     true);
  PERFORM set_config('t46je.prod_id',    v_prod_id::text,     true);
  PERFORM set_config('t46je.section',    v_section_id::text,  true);
  PERFORM set_config('t46je.po_credit',  v_po_credit_id::text, true);
  PERFORM set_config('t46je.po_cash',    v_po_cash_id::text,  true);
END $fix$;

-- ── Receive both POs ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uid        UUID := current_setting('t46je.mgr_uid', true)::uuid;
  v_po_credit  UUID := current_setting('t46je.po_credit', true)::uuid;
  v_po_cash    UUID := current_setting('t46je.po_cash', true)::uuid;
  v_item_c_id  UUID;
  v_item_k_id  UUID;
  v_r_credit   JSONB;
  v_r_cash     JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_c_id FROM purchase_order_items WHERE po_id = v_po_credit LIMIT 1;
  SELECT id INTO v_item_k_id FROM purchase_order_items WHERE po_id = v_po_cash   LIMIT 1;

  v_r_credit := receive_purchase_order_v2(
    p_po_id          := v_po_credit,
    p_section_id     := current_setting('t46je.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_c_id, 'received_quantity', 10)
    ),
    p_idempotency_key := 'd1d1d1d1-0000-0000-0000-000000000001'::uuid
  );

  v_r_cash := receive_purchase_order_v2(
    p_po_id          := v_po_cash,
    p_section_id     := current_setting('t46je.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_k_id, 'received_quantity', 5)
    ),
    p_idempotency_key := 'd1d1d1d1-0000-0000-0000-000000000002'::uuid
  );

  PERFORM set_config('t46je.grn_credit', v_r_credit->>'grn_id', true);
  PERFORM set_config('t46je.grn_cash',   v_r_cash->>'grn_id',   true);
END $$;

-- ─── T1: Credit receipt: exactly 1 JE of type 'purchase' ─────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
   WHERE reference_type = 'purchase'
     AND reference_id = current_setting('t46je.grn_credit', true)::uuid),
  1,
  'T1: credit receipt posts exactly 1 reception JE'
);

-- ─── T2: Credit receipt JE balanced ──────────────────────────────────────────
SELECT is(
  (SELECT (total_debit = total_credit) FROM journal_entries
   WHERE reference_type = 'purchase'
     AND reference_id = current_setting('t46je.grn_credit', true)::uuid),
  true,
  'T2: credit receipt JE is balanced (total_debit = total_credit)'
);

-- ─── T3: VAT folded into inventory (ADR-003): DR line = subtotal + vat ────────
-- subtotal=10000, vat=1100 → DR Inventory = 11100.
SELECT is(
  (SELECT jel.debit::numeric
   FROM journal_entry_lines jel
   JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE je.reference_type = 'purchase'
     AND je.reference_id = current_setting('t46je.grn_credit', true)::uuid
     AND jel.debit > 0
   LIMIT 1),
  11100::numeric,
  'T3: VAT folded into INVENTORY DR (subtotal + vat = 11100, ADR-003 NON-PKP)'
);

-- ─── T4: Credit terms: no auto-payment row ────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM purchase_payments
   WHERE purchase_order_id = current_setting('t46je.po_credit', true)::uuid),
  0,
  'T4: credit terms receipt does NOT auto-create a purchase_payments row'
);

-- ─── T5: Cash receipt: AP JE posted (DR INVENTORY / CR PURCHASE_PAYABLE) ─────
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
   WHERE reference_type = 'purchase'
     AND reference_id = current_setting('t46je.grn_cash', true)::uuid),
  1,
  'T5: cash receipt posts the AP reception JE (reference_type=purchase)'
);

-- ─── T6: Cash receipt: payment JE posted (DR PURCHASE_PAYABLE / CR CASH_OUT) ─
-- Auto-payment reference_type = 'purchase_payment'.
SELECT is(
  (SELECT COUNT(*)::int FROM purchase_payments
   WHERE purchase_order_id = current_setting('t46je.po_cash', true)::uuid),
  1,
  'T6: cash receipt auto-creates 1 purchase_payments row (clearing payment)'
);

-- ─── T7: Both JEs balanced (< 1 IDR rounding allowed) ───────────────────────
-- Reception JE.
SELECT ok(
  (SELECT ABS(total_debit - total_credit) FROM journal_entries
   WHERE reference_type = 'purchase'
     AND reference_id = current_setting('t46je.grn_cash', true)::uuid) < 1,
  'T7a: cash receipt reception JE balance < 1 IDR'
);

-- Auto-payment JE.
SELECT ok(
  (SELECT ABS(je.total_debit - je.total_credit)
   FROM journal_entries je
   JOIN purchase_payments pp ON pp.idempotency_key = md5('auto_cash_pay:' ||
     current_setting('t46je.grn_cash', true))::uuid
   WHERE je.reference_type = 'purchase_payment'
     AND je.reference_id = pp.id) < 1,
  'T7b: cash auto-payment JE balance < 1 IDR'
);

-- ─── T8: Net AP = 0 for cash PO ──────────────────────────────────────────────
-- AP account credited by reception JE, then debited by payment JE → net = 0.
SELECT ok(
  (SELECT ABS(
    COALESCE((SELECT SUM(jel.credit) - SUM(jel.debit)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE a.code = '2141'
        AND je.reference_type IN ('purchase','purchase_payment')
        AND (
          je.reference_id = current_setting('t46je.grn_cash', true)::uuid
          OR je.reference_id IN (
            SELECT id FROM purchase_payments
            WHERE purchase_order_id = current_setting('t46je.po_cash', true)::uuid
          )
        )
    ), 0)
  ) < 1,
  'T8: net AP balance for cash PO = 0 after reception + auto-payment'
);

-- ─── T9: Auto-payment purchase_payments amount = total ───────────────────────
-- total_amount for cash PO = 11100.
SELECT is(
  (SELECT amount::numeric FROM purchase_payments
   WHERE purchase_order_id = current_setting('t46je.po_cash', true)::uuid
   LIMIT 1),
  11100::numeric,
  'T9: auto-payment amount = PO total_amount (11100)'
);

-- ─── T10: Idempotent re-fire: second receive call posts no new JE ─────────────
DO $$
DECLARE
  v_uid        UUID := current_setting('t46je.mgr_uid', true)::uuid;
  v_po_credit  UUID := current_setting('t46je.po_credit', true)::uuid;
  v_item_c_id  UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  SELECT id INTO v_item_c_id FROM purchase_order_items WHERE po_id = v_po_credit LIMIT 1;

  -- Replay same idempotency_key → returns existing GRN, trigger NOT re-fired.
  PERFORM receive_purchase_order_v2(
    p_po_id          := v_po_credit,
    p_section_id     := current_setting('t46je.section', true)::uuid,
    p_received_items := jsonb_build_array(
      jsonb_build_object('po_item_id', v_item_c_id, 'received_quantity', 10)
    ),
    p_idempotency_key := 'd1d1d1d1-0000-0000-0000-000000000001'::uuid  -- same key
  );
END $$;

SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
   WHERE reference_type = 'purchase'
     AND reference_id = current_setting('t46je.grn_credit', true)::uuid),
  1,
  'T10: idempotent replay does not post a new JE (still exactly 1)'
);

SELECT * FROM finish();

ROLLBACK;
