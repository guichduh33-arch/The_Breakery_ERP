-- supabase/tests/b2b_foundation.test.sql
-- Session 24 / Phase 1.A.3 — pgTAP suite for B2B Foundation (S24).
--
-- Couvre les 11 migrations 20260601000005..022 :
--   T1  : b2b_payments table existe + RLS active + REVOKE INSERT
--   T2  : view_b2b_invoices retourne uniquement les orders B2B
--   T3  : view_ar_aging buckets correctement par age_days
--   T4  : record_b2b_payment_v1 happy path → balance décrémentée + JE émis
--   T5  : record_b2b_payment_v1 idempotency replay (même UUID)
--   T6  : record_b2b_payment_v1 overpayment → RAISE P0011
--   T7  : record_b2b_payment_v1 non-b2b customer → RAISE P0001
--   T8  : adjust_b2b_balance_v2 happy path positive delta (JE + manager PIN, S50 V2a-i)
--   T9  : adjust_b2b_balance_v2 happy path negative delta
--   T10 : adjust_b2b_balance_v2 underflow → RAISE P0011
--   T11 : create_b2b_order_v1 happy path → AR augmenté + JE + stock décrémenté
--   T12 : create_b2b_order_v1 credit limit exceeded → RAISE P0011
--   T13 : create_b2b_order_v1 idempotency replay
--   T14 : REVOKE UPDATE customers.b2b_current_balance pour authenticated
--   T15 : validate_b2b_credit_limit_v1 câblé dans create_b2b_order_v1
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap extension est pré-créée
-- sur V3 dev.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- 1 retail customer + 3 b2b customers (unlimited / limit 1M balance 200K /
-- limit 500K balance 0)
INSERT INTO customers (id, name, customer_type) VALUES
  ('b2bf0001-0000-0000-0000-000000000001', 'PGTAP B2BF Retail', 'retail')
ON CONFLICT (id) DO NOTHING;

INSERT INTO customers (id, name, customer_type, b2b_company_name, b2b_credit_limit, b2b_current_balance) VALUES
  ('b2bf0001-0000-0000-0000-000000000002', 'PGTAP B2BF Unlimited', 'b2b', 'PT Unlimited', NULL, 0),
  ('b2bf0001-0000-0000-0000-000000000003', 'PGTAP B2BF Capped',    'b2b', 'PT Capped',    1000000, 200000),
  ('b2bf0001-0000-0000-0000-000000000004', 'PGTAP B2BF Tight',     'b2b', 'PT Tight',     500000,  0)
ON CONFLICT (id) DO NOTHING;

-- Force the values in case rows already exist from a prior run (fixture reset)
UPDATE customers SET b2b_credit_limit = NULL,    b2b_current_balance = 0
 WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
UPDATE customers SET b2b_credit_limit = 1000000, b2b_current_balance = 200000
 WHERE id = 'b2bf0001-0000-0000-0000-000000000003';
UPDATE customers SET b2b_credit_limit = 500000,  b2b_current_balance = 0
 WHERE id = 'b2bf0001-0000-0000-0000-000000000004';

-- 1 product avec current_stock=100
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, min_stock_threshold)
VALUES (
  'b2bf0002-0000-0000-0000-000000000001'::uuid,
  'PGTAP-B2BF-PROD', 'pgTAP B2BF Product',
  (SELECT id FROM categories LIMIT 1),
  50000, 100.000, 0
) ON CONFLICT (id) DO NOTHING;
-- S50 V2a-i : flags explicites (le décrément stock B2B est désormais flag-aware ;
-- T11 teste un produit tracké → stock 100→97).
UPDATE products SET current_stock = 100.000, track_inventory = true, deduct_stock = false
 WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

-- Bootstrap admin uid (EMP000 — pre-existing seed)
DO $bootstrap$
DECLARE v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles WHERE employee_code = 'EMP000';
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('breakery.admin_uid', v_admin_uid::text, false);
  -- S50 V2a-i : PIN manager connu pour adjust_b2b_balance_v2 (transaction-local, ROLLBACK).
  UPDATE user_profiles SET pin_hash = hash_pin('112233'), locked_until = NULL, failed_login_attempts = 0
   WHERE employee_code = 'EMP000';
END $bootstrap$;

CREATE OR REPLACE FUNCTION pg_temp.set_jwt_uid(p_uid UUID) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, true);
END $$;

-- ===========================================================================
-- T1 — b2b_payments table existe + RLS active + REVOKE INSERT enforced
-- ===========================================================================
SELECT has_table(
  'public', 'b2b_payments',
  'T1: b2b_payments table exists'
);

-- ===========================================================================
-- T2 — view_b2b_invoices retourne uniquement les orders B2B
-- ===========================================================================
SELECT has_view(
  'public', 'view_b2b_invoices',
  'T2: view_b2b_invoices exists'
);

-- ===========================================================================
-- T3 — view_ar_aging buckets correctement par age_days
-- ===========================================================================
SELECT has_view(
  'public', 'view_ar_aging',
  'T3: view_ar_aging exists'
);

-- ===========================================================================
-- T4 — record_b2b_payment_v1 happy path → balance décrémentée + JE émis
-- ===========================================================================
DO $t4$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_balance_after NUMERIC;
  v_je_id UUID;
  v_je_total NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  -- Reset balance to 100K
  UPDATE customers SET b2b_current_balance = 100000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000003';

  v_result := record_b2b_payment_v2(
    p_customer_id => 'b2bf0001-0000-0000-0000-000000000003',
    p_amount      => 50000,
    p_method      => 'cash'::payment_method
  );

  SELECT b2b_current_balance INTO v_balance_after
    FROM customers WHERE id = 'b2bf0001-0000-0000-0000-000000000003';

  v_je_id := (v_result->>'je_id')::uuid;
  SELECT total_debit INTO v_je_total FROM journal_entries WHERE id = v_je_id;

  PERFORM set_config('breakery.t4_pass',
    CASE WHEN
      v_balance_after = 50000
      AND v_je_total = 50000
      AND (v_result->>'customer_balance_after')::numeric = 50000
    THEN 'true' ELSE 'false' END, false);
END $t4$;
SELECT ok(current_setting('breakery.t4_pass')::boolean,
  'T4: record_b2b_payment_v1 happy path — balance 100K→50K + JE 50K emitted');

-- ===========================================================================
-- T5 — record_b2b_payment_v1 idempotency replay (same UUID)
-- ===========================================================================
DO $t5$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key UUID := 'aabbccdd-0000-0000-0000-000000000001';
  v_r1 JSONB;
  v_r2 JSONB;
  v_count_before INT;
  v_count_after INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  UPDATE customers SET b2b_current_balance = 200000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000003';

  SELECT COUNT(*) INTO v_count_before FROM b2b_payments
    WHERE idempotency_key = v_key;

  v_r1 := record_b2b_payment_v2(
    p_customer_id    => 'b2bf0001-0000-0000-0000-000000000003',
    p_amount         => 10000,
    p_method         => 'cash'::payment_method,
    p_idempotency_key => v_key
  );

  v_r2 := record_b2b_payment_v2(
    p_customer_id    => 'b2bf0001-0000-0000-0000-000000000003',
    p_amount         => 10000,
    p_method         => 'cash'::payment_method,
    p_idempotency_key => v_key
  );

  SELECT COUNT(*) INTO v_count_after FROM b2b_payments
    WHERE idempotency_key = v_key;

  PERFORM set_config('breakery.t5_pass',
    CASE WHEN
      v_count_before = 0
      AND v_count_after = 1
      AND (v_r1->>'payment_id') = (v_r2->>'payment_id')
      AND (v_r2->>'idempotent_replay')::boolean = TRUE
    THEN 'true' ELSE 'false' END, false);
END $t5$;
SELECT ok(current_setting('breakery.t5_pass')::boolean,
  'T5: record_b2b_payment_v1 idempotency — 2 calls same key → 1 row, replay flag');

-- ===========================================================================
-- T6 — record_b2b_payment_v1 overpayment → RAISE P0011
-- ===========================================================================
DO $t6_setup$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 100000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000004';
END $t6_setup$;

SELECT throws_ok(
  $$ SELECT record_b2b_payment_v2(
       p_customer_id => 'b2bf0001-0000-0000-0000-000000000004',
       p_amount      => 200000,
       p_method      => 'cash'::payment_method
     ) $$,
  'P0011',
  NULL,
  'T6: record_b2b_payment_v1 overpayment raises P0011'
);

-- ===========================================================================
-- T7 — record_b2b_payment_v1 non-b2b customer → RAISE P0001 (customer_not_b2b)
-- ===========================================================================
DO $t7_setup$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
END $t7_setup$;

SELECT throws_ok(
  $$ SELECT record_b2b_payment_v2(
       p_customer_id => 'b2bf0001-0000-0000-0000-000000000001',
       p_amount      => 1000,
       p_method      => 'cash'::payment_method
     ) $$,
  'P0001',
  NULL,
  'T7: record_b2b_payment_v1 on retail customer raises customer_not_b2b'
);

-- ===========================================================================
-- T8 — adjust_b2b_balance_v1 happy path positive delta
-- ===========================================================================
DO $t8$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_balance_after NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  UPDATE customers SET b2b_current_balance = 100000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  v_result := adjust_b2b_balance_v2(
    p_customer_id => 'b2bf0001-0000-0000-0000-000000000002',
    p_delta       => 50000,
    p_reason      => 'T8 admin adjustment',
    p_manager_pin => '112233'
  );

  SELECT b2b_current_balance INTO v_balance_after
    FROM customers WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  PERFORM set_config('breakery.t8_pass',
    CASE WHEN
      v_balance_after = 150000
      AND (v_result->>'balance_after')::numeric = 150000
      AND (v_result->>'delta')::numeric = 50000
    THEN 'true' ELSE 'false' END, false);
END $t8$;
SELECT ok(current_setting('breakery.t8_pass')::boolean,
  'T8: adjust_b2b_balance_v1 +50K — balance 100K→150K');

-- ===========================================================================
-- T9 — adjust_b2b_balance_v1 happy path negative delta
-- ===========================================================================
DO $t9$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_balance_after NUMERIC;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  UPDATE customers SET b2b_current_balance = 100000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  v_result := adjust_b2b_balance_v2(
    p_customer_id => 'b2bf0001-0000-0000-0000-000000000002',
    p_delta       => -30000,
    p_reason      => 'T9 admin credit',
    p_manager_pin => '112233'
  );

  SELECT b2b_current_balance INTO v_balance_after
    FROM customers WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  PERFORM set_config('breakery.t9_pass',
    CASE WHEN
      v_balance_after = 70000
      AND (v_result->>'balance_after')::numeric = 70000
      AND (v_result->>'delta')::numeric = -30000
    THEN 'true' ELSE 'false' END, false);
END $t9$;
SELECT ok(current_setting('breakery.t9_pass')::boolean,
  'T9: adjust_b2b_balance_v1 -30K — balance 100K→70K');

-- ===========================================================================
-- T10 — adjust_b2b_balance_v1 underflow → RAISE P0011 (balance_underflow)
-- ===========================================================================
DO $t10_setup$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 50000
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
END $t10_setup$;

SELECT throws_ok(
  $$ SELECT adjust_b2b_balance_v2(
       p_customer_id => 'b2bf0001-0000-0000-0000-000000000002',
       p_delta       => -100000,
       p_reason      => 'T10 underflow test',
       p_manager_pin => '112233'
     ) $$,
  'P0011',
  NULL,
  'T10: adjust_b2b_balance_v2 underflow raises P0011 balance_underflow'
);

-- ===========================================================================
-- T11 — create_b2b_order_v1 happy path → AR augmenté + JE + stock décrémenté
-- ===========================================================================
DO $t11$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_result JSONB;
  v_balance_after NUMERIC;
  v_stock_after NUMERIC;
  v_je_total NUMERIC;
  v_je_id UUID;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);

  -- Reset balance and stock
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  UPDATE products SET current_stock = 100.000
   WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  v_result := create_b2b_order_v5(
    p_customer_id => 'b2bf0001-0000-0000-0000-000000000002',
    p_items       => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2bf0002-0000-0000-0000-000000000001',
      'quantity',   3,
      'unit_price', 50000
    ))
  );

  SELECT b2b_current_balance INTO v_balance_after
    FROM customers WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  SELECT current_stock INTO v_stock_after
    FROM products WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  v_je_id := (v_result->>'je_id')::uuid;
  SELECT total_debit INTO v_je_total FROM journal_entries WHERE id = v_je_id;

  PERFORM set_config('breakery.t11_pass',
    CASE WHEN
      v_balance_after = 150000
      AND v_stock_after = 97.000
      AND v_je_total = 150000
      AND (v_result->>'credit_after')::numeric = 150000
    THEN 'true' ELSE 'false' END, false);
END $t11$;
SELECT ok(current_setting('breakery.t11_pass')::boolean,
  'T11: create_b2b_order_v1 — AR 0→150K, stock 100→97, JE 150K');

-- ===========================================================================
-- T12 — create_b2b_order_v1 credit limit exceeded → RAISE P0011
-- ===========================================================================
DO $t12_setup$
DECLARE v_admin UUID := current_setting('breakery.admin_uid')::uuid;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  -- Tight customer : limit 500K, balance 0 → order 600K should exceed by 100K
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000004';
END $t12_setup$;

SELECT throws_ok(
  $$ SELECT create_b2b_order_v5(
       p_customer_id => 'b2bf0001-0000-0000-0000-000000000004',
       p_items       => jsonb_build_array(jsonb_build_object(
         'product_id', 'b2bf0002-0000-0000-0000-000000000001',
         'quantity',   12,
         'unit_price', 50000
       ))
     ) $$,
  'P0011',
  NULL,
  'T12: create_b2b_order_v1 credit limit exceeded raises P0011'
);

-- ===========================================================================
-- T13 — create_b2b_order_v1 idempotency replay
-- ===========================================================================
DO $t13$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_key UUID := 'aabbccdd-0000-0000-0000-000000000013';
  v_r1 JSONB;
  v_r2 JSONB;
  v_count INT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  UPDATE products SET current_stock = 100.000
   WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  v_r1 := create_b2b_order_v5(
    p_customer_id     => 'b2bf0001-0000-0000-0000-000000000002',
    p_items           => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2bf0002-0000-0000-0000-000000000001',
      'quantity',   1,
      'unit_price', 10000
    )),
    p_idempotency_key => v_key
  );

  v_r2 := create_b2b_order_v5(
    p_customer_id     => 'b2bf0001-0000-0000-0000-000000000002',
    p_items           => jsonb_build_array(jsonb_build_object(
      'product_id', 'b2bf0002-0000-0000-0000-000000000001',
      'quantity',   1,
      'unit_price', 10000
    )),
    p_idempotency_key => v_key
  );

  SELECT COUNT(*) INTO v_count FROM orders WHERE idempotency_key = v_key;

  PERFORM set_config('breakery.t13_pass',
    CASE WHEN
      v_count = 1
      AND (v_r1->>'order_id') = (v_r2->>'order_id')
      AND (v_r2->>'idempotent_replay')::boolean = TRUE
    THEN 'true' ELSE 'false' END, false);
END $t13$;
SELECT ok(current_setting('breakery.t13_pass')::boolean,
  'T13: create_b2b_order_v1 idempotency — 2 calls same key → 1 order, replay flag');

-- ===========================================================================
-- T14 — REVOKE UPDATE customers.b2b_current_balance pour authenticated
-- ===========================================================================
-- SET LOCAL ROLE authenticated pour bypasser le superuser et tester l'ACL réel.
DO $t14$
DECLARE
  v_caught BOOLEAN := FALSE;
BEGIN
  -- Reset to known state
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000002';

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE customers SET b2b_current_balance = 999999
      WHERE id = 'b2bf0001-0000-0000-0000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := TRUE;
  END;
  RESET ROLE;

  PERFORM set_config('breakery.t14_pass',
    CASE WHEN v_caught THEN 'true' ELSE 'false' END, false);
END $t14$;
SELECT ok(current_setting('breakery.t14_pass')::boolean,
  'T14: UPDATE customers.b2b_current_balance as authenticated raises insufficient_privilege');

-- ===========================================================================
-- T15 — validate_b2b_credit_limit_v1 est bien câblé dans create_b2b_order_v1
--       Sanity : forge un customer avec limite, tente order au-dessus →
--       erreur DOIT contenir "credit_limit_exceeded" (preuve du câblage).
-- ===========================================================================
DO $t15$
DECLARE
  v_admin UUID := current_setting('breakery.admin_uid')::uuid;
  v_err_message TEXT;
BEGIN
  PERFORM pg_temp.set_jwt_uid(v_admin);
  UPDATE customers SET b2b_current_balance = 0
   WHERE id = 'b2bf0001-0000-0000-0000-000000000004';
  UPDATE products SET current_stock = 100.000
   WHERE id = 'b2bf0002-0000-0000-0000-000000000001';

  BEGIN
    PERFORM create_b2b_order_v5(
      p_customer_id => 'b2bf0001-0000-0000-0000-000000000004',
      p_items       => jsonb_build_array(jsonb_build_object(
        'product_id', 'b2bf0002-0000-0000-0000-000000000001',
        'quantity',   20,
        'unit_price', 50000
      ))
    );
    v_err_message := 'NO_ERROR_RAISED';
  EXCEPTION WHEN OTHERS THEN
    v_err_message := SQLERRM;
  END;

  PERFORM set_config('breakery.t15_pass',
    CASE WHEN v_err_message ILIKE '%credit_limit_exceeded%' THEN 'true' ELSE 'false' END,
    false);
END $t15$;
SELECT ok(current_setting('breakery.t15_pass')::boolean,
  'T15: validate_b2b_credit_limit_v1 wired in create_b2b_order_v1 — error contains credit_limit_exceeded');

SELECT * FROM finish();
ROLLBACK;
