-- supabase/tests/b2b_settlement.test.sql
-- Session 52 / P1.2 — pgTAP suite for B2B per-invoice settlement (closes T5/C3/C4).
--
--   T1  : b2b_payment_allocations table exists + append-only (anon no SELECT, auth no INSERT)
--   T2  : FIFO partial — pay 1 invoice worth → oldest settled (paid_at), newer untouched
--   T3  : FIFO full — pay both invoices → both settled
--   T4  : targeted allocation settles the chosen (newer) invoice, ignoring FIFO order
--   T5  : targeted + FIFO remainder — chosen settled, leftover falls to oldest (partial)
--   T6  : partial payment — view_b2b_invoices outstanding correct, is_unpaid TRUE, paid_at NULL
--   T7  : POS == BO — get_pos_b2b_debts_v3 outstanding == view_b2b_invoices outstanding
--   T8  : cancel unpaid — voided, gone from view, JE reversed balanced, balance + stock restored
--   T9  : cancel blocked when an allocation exists → order_has_payments (P0011)
--   T10 : create_b2b_order_v5 over credit limit → P0011 (TOCTOU gate fires)
--   T11 : reconcile_b2b_balance_v1 — consistent cache ⇒ has_drift FALSE (before & after settle)
--   T12 : gate — CASHIER calling record_b2b_payment_v2 → permission_denied (P0003)
--   T13 : idempotency replay record_b2b_payment_v2 — 1 payment, 1 alloc, replay flag
--   T14 : anon cannot EXECUTE record_b2b_payment_v2 (function ACL / REVOKE pair)
--
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope). pgtap pre-installed on V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ---------------------------------------------------------------------------
-- Fixtures : 10 unlimited b2b customers + 1 capped + 1 tracked product
-- ---------------------------------------------------------------------------
INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance) VALUES
  ('b2b52001-0000-0000-0000-000000000001','PGTAP S52 C1','b2b','PT C1',NULL,0),
  ('b2b52001-0000-0000-0000-000000000002','PGTAP S52 C2','b2b','PT C2',NULL,0),
  ('b2b52001-0000-0000-0000-000000000003','PGTAP S52 C3','b2b','PT C3',NULL,0),
  ('b2b52001-0000-0000-0000-000000000004','PGTAP S52 C4','b2b','PT C4',NULL,0),
  ('b2b52001-0000-0000-0000-000000000005','PGTAP S52 C5','b2b','PT C5',NULL,0),
  ('b2b52001-0000-0000-0000-000000000006','PGTAP S52 C6','b2b','PT C6',NULL,0),
  ('b2b52001-0000-0000-0000-000000000007','PGTAP S52 C7','b2b','PT C7',NULL,0),
  ('b2b52001-0000-0000-0000-000000000008','PGTAP S52 C8','b2b','PT C8',500000,0),
  ('b2b52001-0000-0000-0000-000000000009','PGTAP S52 C9','b2b','PT C9',NULL,0),
  ('b2b52001-0000-0000-0000-000000000010','PGTAP S52 C10','b2b','PT C10',NULL,0)
ON CONFLICT (id) DO NOTHING;

UPDATE customers SET b2b_credit_limit=NULL, b2b_current_balance=0
 WHERE id::text LIKE 'b2b52001-%' AND id <> 'b2b52001-0000-0000-0000-000000000008';
UPDATE customers SET b2b_credit_limit=500000, b2b_current_balance=0
 WHERE id = 'b2b52001-0000-0000-0000-000000000008';

INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES ('b2b52002-0000-0000-0000-000000000001','PGTAP-S52-PROD','pgTAP S52 Product',
        (SELECT id FROM categories LIMIT 1), 50000, 1000.000, 0)
ON CONFLICT (id) DO NOTHING;
UPDATE products SET current_stock=1000.000, track_inventory=true, deduct_stock=false
 WHERE id='b2b52002-0000-0000-0000-000000000001';

DO $bootstrap$
DECLARE v_admin UUID; v_cashier UUID;
BEGIN
  SELECT auth_user_id INTO v_admin   FROM user_profiles WHERE employee_code='EMP000';
  SELECT auth_user_id INTO v_cashier FROM user_profiles WHERE employee_code='EMP001';
  IF v_admin IS NULL OR v_cashier IS NULL THEN RAISE EXCEPTION 'Seed users EMP000/EMP001 missing'; END IF;
  PERFORM set_config('breakery.admin_uid', v_admin::text, false);
  PERFORM set_config('breakery.cashier_uid', v_cashier::text, false);
END $bootstrap$;

CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', p_uid::text, true); END $$;

-- Helper : create a b2b invoice for a customer, return its id, then stamp created_at.
CREATE OR REPLACE FUNCTION pg_temp.mk_invoice(p_cust UUID, p_qty NUMERIC, p_price NUMERIC, p_created TIMESTAMPTZ)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE v_res JSONB; v_id UUID;
BEGIN
  v_res := create_b2b_order_v5(
    p_customer_id => p_cust,
    p_items => jsonb_build_array(jsonb_build_object(
      'product_id','b2b52002-0000-0000-0000-000000000001','quantity',p_qty,'unit_price',p_price)));
  v_id := (v_res->>'order_id')::uuid;
  UPDATE orders SET created_at = p_created WHERE id = v_id;
  RETURN v_id;
END $$;

-- ===========================================================================
-- T1 — table exists + append-only ACL
-- ===========================================================================
SELECT ok(
  to_regclass('public.b2b_payment_allocations') IS NOT NULL
  AND NOT has_table_privilege('anon','public.b2b_payment_allocations','SELECT')
  AND     has_table_privilege('authenticated','public.b2b_payment_allocations','SELECT')
  AND NOT has_table_privilege('authenticated','public.b2b_payment_allocations','INSERT'),
  'T1: b2b_payment_allocations exists; anon no SELECT; authenticated SELECT-only (no INSERT)');

-- ===========================================================================
-- T2 — FIFO partial : pay invoice1 worth → oldest settled, newer untouched
-- ===========================================================================
DO $t2$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_inv1 UUID; v_inv2 UUID; v_res JSONB;
  v_inv1_out NUMERIC; v_inv1_paid TIMESTAMPTZ; v_inv1_status TEXT;
  v_inv2_out NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv1 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000001',2,50000,'2026-06-01'::timestamptz);
  v_inv2 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000001',2,50000,'2026-06-10'::timestamptz);
  v_res := record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000001', p_amount=>100000, p_method=>'cash'::payment_method);
  SELECT outstanding, paid_at, order_status INTO v_inv1_out, v_inv1_paid, v_inv1_status
    FROM view_b2b_invoices WHERE invoice_id = v_inv1;
  -- inv1 is now paid → excluded from view (status voided? no, paid). view excludes voided only,
  -- so paid invoice still present with outstanding 0. Confirm via orders too.
  SELECT outstanding INTO v_inv2_out FROM view_b2b_invoices WHERE invoice_id = v_inv2;
  PERFORM set_config('breakery.t2', CASE WHEN
    (SELECT paid_at FROM orders WHERE id=v_inv1) IS NOT NULL
    AND (SELECT status FROM orders WHERE id=v_inv1) = 'paid'
    AND COALESCE(v_inv1_out,0) = 0
    AND v_inv2_out = 100000
  THEN 'true' ELSE 'false' END, false);
END $t2$;
SELECT ok(current_setting('breakery.t2')::boolean,
  'T2: FIFO partial — oldest invoice fully settled (paid_at+status), newer still 100K outstanding');

-- ===========================================================================
-- T3 — FIFO full : pay both
-- ===========================================================================
DO $t3$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_inv1 UUID; v_inv2 UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv1 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000002',2,50000,'2026-06-01'::timestamptz);
  v_inv2 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000002',1,50000,'2026-06-10'::timestamptz);
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000002', p_amount=>150000, p_method=>'cash'::payment_method);
  PERFORM set_config('breakery.t3', CASE WHEN
    (SELECT status FROM orders WHERE id=v_inv1)='paid'
    AND (SELECT status FROM orders WHERE id=v_inv2)='paid'
    AND (SELECT b2b_current_balance FROM customers WHERE id='b2b52001-0000-0000-0000-000000000002')=0
  THEN 'true' ELSE 'false' END, false);
END $t3$;
SELECT ok(current_setting('breakery.t3')::boolean,
  'T3: FIFO full — both invoices settled, balance 0');

-- ===========================================================================
-- T4 — targeted allocation settles chosen (newer) invoice, ignoring FIFO
-- ===========================================================================
DO $t4$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_inv1 UUID; v_inv2 UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv1 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000003',2,50000,'2026-06-01'::timestamptz);
  v_inv2 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000003',2,50000,'2026-06-10'::timestamptz);
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000003', p_amount=>100000, p_method=>'cash'::payment_method,
    p_invoice_ids=>ARRAY[v_inv2]);
  PERFORM set_config('breakery.t4', CASE WHEN
    (SELECT status FROM orders WHERE id=v_inv2)='paid'
    AND (SELECT status FROM orders WHERE id=v_inv1)='b2b_pending'
    AND (SELECT outstanding FROM view_b2b_invoices WHERE invoice_id=v_inv1)=100000
  THEN 'true' ELSE 'false' END, false);
END $t4$;
SELECT ok(current_setting('breakery.t4')::boolean,
  'T4: targeted invoice (newer) settled first, older untouched');

-- ===========================================================================
-- T5 — targeted + FIFO remainder
-- ===========================================================================
DO $t5$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_inv1 UUID; v_inv2 UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv1 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000004',2,50000,'2026-06-01'::timestamptz);
  v_inv2 := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000004',2,50000,'2026-06-10'::timestamptz);
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000004', p_amount=>150000, p_method=>'cash'::payment_method,
    p_invoice_ids=>ARRAY[v_inv2]);
  PERFORM set_config('breakery.t5', CASE WHEN
    (SELECT status FROM orders WHERE id=v_inv2)='paid'
    AND (SELECT outstanding FROM view_b2b_invoices WHERE invoice_id=v_inv1)=50000
    AND (SELECT status FROM orders WHERE id=v_inv1)='b2b_pending'
  THEN 'true' ELSE 'false' END, false);
END $t5$;
SELECT ok(current_setting('breakery.t5')::boolean,
  'T5: targeted settles newer (100K), remainder 50K FIFO to older (partial)');

-- ===========================================================================
-- T6 — partial payment view correctness
-- ===========================================================================
DO $t6$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid; v_inv UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000005',2,50000,'2026-06-05'::timestamptz);
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000005', p_amount=>40000, p_method=>'cash'::payment_method);
  PERFORM set_config('breakery.t6', CASE WHEN
    (SELECT outstanding FROM view_b2b_invoices WHERE invoice_id=v_inv)=60000
    AND (SELECT is_unpaid FROM view_b2b_invoices WHERE invoice_id=v_inv)=TRUE
    AND (SELECT amount_paid FROM view_b2b_invoices WHERE invoice_id=v_inv)=40000
    AND (SELECT paid_at FROM orders WHERE id=v_inv) IS NULL
  THEN 'true' ELSE 'false' END, false);
END $t6$;
SELECT ok(current_setting('breakery.t6')::boolean,
  'T6: partial — outstanding 60K, amount_paid 40K, is_unpaid TRUE, paid_at NULL');

-- ===========================================================================
-- T7 — POS == BO
-- ===========================================================================
DO $t7$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid; v_inv UUID;
  v_pos NUMERIC; v_bo NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  -- reuse C5 inv from T6 (outstanding 60K)
  SELECT invoice_id INTO v_inv FROM view_b2b_invoices
   WHERE customer_id='b2b52001-0000-0000-0000-000000000005' LIMIT 1;
  SELECT outstanding INTO v_bo FROM view_b2b_invoices WHERE invoice_id=v_inv;
  SELECT outstanding INTO v_pos FROM get_pos_b2b_debts_v3('b2b52001-0000-0000-0000-000000000005', 3650)
   WHERE order_id=v_inv;
  PERFORM set_config('breakery.t7', CASE WHEN v_pos = v_bo AND v_bo = 60000 THEN 'true' ELSE 'false' END, false);
END $t7$;
SELECT ok(current_setting('breakery.t7')::boolean,
  'T7: POS get_pos_b2b_debts_v3 outstanding == BO view_b2b_invoices outstanding (60K)');

-- ===========================================================================
-- T8 — cancel unpaid : voided, gone from view, JE reversed, balance + stock restored
-- ===========================================================================
DO $t8$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid; v_inv UUID;
  v_stock_before NUMERIC; v_stock_after NUMERIC; v_je_debit NUMERIC; v_je_credit NUMERIC; v_res JSONB;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  SELECT current_stock INTO v_stock_before FROM products WHERE id='b2b52002-0000-0000-0000-000000000001';
  v_inv := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000006',3,50000,'2026-06-07'::timestamptz);
  v_res := cancel_b2b_order_v1(v_inv, 'erroneous invoice');
  SELECT current_stock INTO v_stock_after FROM products WHERE id='b2b52002-0000-0000-0000-000000000001';
  SELECT total_debit, total_credit INTO v_je_debit, v_je_credit
    FROM journal_entries WHERE reference_type='b2b_order_cancel' AND reference_id=v_inv;
  PERFORM set_config('breakery.t8', CASE WHEN
    (SELECT status FROM orders WHERE id=v_inv)='voided'
    AND NOT EXISTS (SELECT 1 FROM view_b2b_invoices WHERE invoice_id=v_inv)
    AND v_je_debit = 150000 AND v_je_credit = 150000
    AND v_stock_after = v_stock_before
    AND (SELECT b2b_current_balance FROM customers WHERE id='b2b52001-0000-0000-0000-000000000006')=0
  THEN 'true' ELSE 'false' END, false);
END $t8$;
SELECT ok(current_setting('breakery.t8')::boolean,
  'T8: cancel unpaid — voided, off view, reversal JE balanced 150K, stock + balance restored');

-- ===========================================================================
-- T9 — cancel blocked when allocation exists
-- ===========================================================================
DO $t9_setup$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid; v_inv UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000007',2,50000,'2026-06-08'::timestamptz);
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000007', p_amount=>50000, p_method=>'cash'::payment_method);
  PERFORM set_config('breakery.t9_inv', v_inv::text, false);
END $t9_setup$;
SELECT throws_ok(
  format($$ SELECT cancel_b2b_order_v1(%L, 'try cancel allocated') $$, current_setting('breakery.t9_inv')),
  'P0011', NULL,
  'T9: cancel_b2b_order_v1 on an allocated invoice raises P0011 (order_has_payments)');

-- ===========================================================================
-- T10 — create_b2b_order_v5 over credit limit (TOCTOU gate fires)
-- ===========================================================================
DO $t10_setup$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance=0 WHERE id='b2b52001-0000-0000-0000-000000000008';
END $t10_setup$;
SELECT throws_ok(
  $$ SELECT create_b2b_order_v5(
       p_customer_id=>'b2b52001-0000-0000-0000-000000000008',
       p_items=>jsonb_build_array(jsonb_build_object(
         'product_id','b2b52002-0000-0000-0000-000000000001','quantity',12,'unit_price',50000))) $$,
  'P0011', NULL,
  'T10: create_b2b_order_v5 over credit limit raises P0011 (re-check after lock)');

-- ===========================================================================
-- T11 — reconcile consistent ⇒ has_drift FALSE (before & after settling)
-- ===========================================================================
DO $t11$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid; v_inv UUID;
  v_drift1 BOOLEAN; v_derived1 NUMERIC; v_drift2 BOOLEAN; v_derived2 NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  v_inv := pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000009',2,50000,'2026-06-09'::timestamptz);
  SELECT has_drift, derived_balance INTO v_drift1, v_derived1
    FROM reconcile_b2b_balance_v1('b2b52001-0000-0000-0000-000000000009');
  PERFORM record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000009', p_amount=>100000, p_method=>'cash'::payment_method);
  SELECT has_drift, derived_balance INTO v_drift2, v_derived2
    FROM reconcile_b2b_balance_v1('b2b52001-0000-0000-0000-000000000009');
  PERFORM set_config('breakery.t11', CASE WHEN
    v_drift1=FALSE AND v_derived1=100000 AND v_drift2=FALSE AND v_derived2=0
  THEN 'true' ELSE 'false' END, false);
END $t11$;
SELECT ok(current_setting('breakery.t11')::boolean,
  'T11: reconcile — derived 100K then 0, has_drift FALSE both times');

-- ===========================================================================
-- T12 — gate : CASHIER record_b2b_payment_v2 → permission_denied
-- ===========================================================================
DO $t12_setup$
DECLARE v_cashier UUID := current_setting('breakery.cashier_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_cashier);
END $t12_setup$;
SELECT throws_ok(
  $$ SELECT record_b2b_payment_v2(
       p_customer_id=>'b2b52001-0000-0000-0000-000000000010', p_amount=>1000, p_method=>'cash'::payment_method) $$,
  'P0003', NULL,
  'T12: CASHIER lacking b2b.payment.record raises P0003 permission_denied');

-- ===========================================================================
-- T13 — idempotency replay (record_b2b_payment_v2)
-- ===========================================================================
DO $t13$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key UUID := 'cccc0000-0000-0000-0000-000000000013'; v_r1 JSONB; v_r2 JSONB;
  v_pay_count INT; v_alloc_count INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  PERFORM pg_temp.mk_invoice('b2b52001-0000-0000-0000-000000000010',2,50000,'2026-06-11'::timestamptz);
  v_r1 := record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000010', p_amount=>30000, p_method=>'cash'::payment_method,
    p_idempotency_key=>v_key);
  v_r2 := record_b2b_payment_v2(
    p_customer_id=>'b2b52001-0000-0000-0000-000000000010', p_amount=>30000, p_method=>'cash'::payment_method,
    p_idempotency_key=>v_key);
  SELECT COUNT(*) INTO v_pay_count FROM b2b_payments WHERE idempotency_key=v_key;
  SELECT COUNT(*) INTO v_alloc_count FROM b2b_payment_allocations
    WHERE payment_id = (v_r1->>'payment_id')::uuid;
  PERFORM set_config('breakery.t13', CASE WHEN
    v_pay_count=1 AND v_alloc_count=1
    AND (v_r1->>'payment_id')=(v_r2->>'payment_id')
    AND (v_r2->>'idempotent_replay')::boolean=TRUE
  THEN 'true' ELSE 'false' END, false);
END $t13$;
SELECT ok(current_setting('breakery.t13')::boolean,
  'T13: idempotency — 2 calls same key → 1 payment, 1 allocation, replay flag');

-- ===========================================================================
-- T14 — anon cannot EXECUTE record_b2b_payment_v2 (function ACL)
-- ===========================================================================
DO $t14$
DECLARE v_caught BOOLEAN := FALSE;
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM record_b2b_payment_v2(
      p_customer_id=>'b2b52001-0000-0000-0000-000000000010', p_amount=>1, p_method=>'cash'::payment_method);
  EXCEPTION WHEN insufficient_privilege THEN v_caught := TRUE;
  END;
  RESET ROLE;
  PERFORM set_config('breakery.t14', CASE WHEN v_caught THEN 'true' ELSE 'false' END, false);
END $t14$;
SELECT ok(current_setting('breakery.t14')::boolean,
  'T14: anon EXECUTE record_b2b_payment_v2 → insufficient_privilege');

SELECT * FROM finish();
ROLLBACK;
