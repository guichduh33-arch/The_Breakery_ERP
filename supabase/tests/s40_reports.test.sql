-- supabase/tests/s40_reports.test.sql
-- S40 Wave A — pgTAP suite (22 assertions T1-T22).
--
-- Covers:
--   T1  : INSERT role_permissions → audit_logs row action='role.permission_granted'
--   T2  : DELETE role_permissions → audit_logs row action='role.permission_revoked'
--   T3  : get_daily_sales_v1 CASHIER → 42501 (no reports.sales.read)
--   T4  : get_daily_sales_v1 MANAGER happy path → summary.order_count = 2, by_day length = 2
--   T5  : get_daily_sales_v1 refunds deducted in net (net = gross - refund)
--   T6  : get_purchase_items_v1 CASHIER → 42501
--   T7  : get_purchase_items_v1 MANAGER → 2 lines returned; p_supplier_id filter scopes correctly
--   T8  : get_purchase_by_date_v1 CASHIER → 42501
--   T9  : get_purchase_by_date_v1 MANAGER → summary.po_count = 1
--   T10 : get_purchase_by_supplier_v1 CASHIER → 42501
--   T11 : get_purchase_by_supplier_v1 MANAGER → share_pct = 100 for single supplier
--   T12 : get_daily_sales_v1 end < start → P0001
--   T13 : get_staff_performance_v1 CASHIER → 42501
--   T14 : get_staff_performance_v1 MANAGER → cashier row orders_served >= 2 ; manager row voids_count >= 1
--   T15 : get_production_report_v1 CASHIER → 42501
--   T16 : get_production_report_v1 MANAGER (isolated past window) → total_produced = 10
--   T17 : get_production_efficiency_v1 CASHIER → 42501
--   T18 : get_production_efficiency_v1 MANAGER → waste_rate_pct = 16.67, avg_yield_variance_pct = -10
--   T19 : get_price_changes_v1 CASHIER → 42501
--   T20 : get_price_changes_v1 MANAGER → LAG correct (old 1000 → new 1500, delta 50) + p_product_id filter
--   T21 : get_permission_changes_v1 CASHIER → 42501 (gate reports.audit.read, MANAGER+ — corrective _021)
--   T22 : get_permission_changes_v1 MANAGER → finds the T2 revoked row
--
-- Seeded users (from seed.sql):
--   SUPER_ADMIN : auth_user_id = 00000000-0000-0000-0000-000000000001 (EMP000)
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004  (EMP003, MANAGER role)
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002  (EMP001, CASHIER role)
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK — self-cleaning.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

-- ============================================================
-- FIXTURES
-- Seed: 1 supplier, 1 PO with 2 items (received), 2 paid orders
-- on 2 different days in the test period, 1 refund.
-- All INSERT with specific test UUIDs to avoid collisions.
-- ============================================================

DO $$
DECLARE
  v_manager_auth UUID := '00000000-0000-0000-0000-000000000004';
  v_cashier_auth UUID := '00000000-0000-0000-0000-000000000002';
  v_manager_id   UUID;
  v_cashier_id   UUID;
  v_session_id   UUID;
  v_product_id   UUID;
  v_cat_id       UUID;
  v_supplier_id  UUID;
  v_po_id        UUID;
  v_order1_id    UUID;
  v_order2_id    UUID;
  v_refund_id    UUID;
BEGIN
  -- Resolve user profile IDs
  SELECT id INTO v_manager_id FROM user_profiles WHERE auth_user_id = v_manager_auth LIMIT 1;
  SELECT id INTO v_cashier_id FROM user_profiles WHERE auth_user_id = v_cashier_auth LIMIT 1;

  -- Get any active category and product for seeding
  SELECT id INTO v_cat_id FROM categories WHERE deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_product_id FROM products WHERE is_active = true AND deleted_at IS NULL LIMIT 1;

  -- Supplier for PO tests
  INSERT INTO suppliers (code, name, payment_terms_days, is_active)
  VALUES ('T_S40_SUPP', 'S40 Test Supplier', 30, true)
  ON CONFLICT (code) DO UPDATE SET is_active = true, deleted_at = NULL
  RETURNING id INTO v_supplier_id;

  -- PO with 2 items, status=received
  INSERT INTO purchase_orders (
    po_number, supplier_id, status, order_date, received_date,
    subtotal, vat_amount, total_amount
  )
  VALUES (
    'PO-S40-TEST-001', v_supplier_id, 'received',
    CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '3 days',
    200000, 0, 200000
  )
  ON CONFLICT (po_number) DO NOTHING
  RETURNING id INTO v_po_id;

  IF v_po_id IS NOT NULL AND v_product_id IS NOT NULL THEN
    INSERT INTO purchase_order_items (po_id, product_id, quantity, received_quantity, unit, unit_cost)
    VALUES
      (v_po_id, v_product_id, 10, 10, 'kg', 10000),
      (v_po_id, v_product_id, 10, 10, 'kg', 10000)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM set_config('breakery.t_s40_supplier_id', COALESCE(v_supplier_id::text, ''), true);

  -- POS session for orders
  INSERT INTO pos_sessions (opened_by, opening_cash, status)
  VALUES (v_cashier_id, 100000, 'open')
  RETURNING id INTO v_session_id;

  -- Order 1: paid, day = CURRENT_DATE - 2 days (within test window)
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, paid_at
  )
  VALUES (
    'ORD-S40-001', v_session_id, v_cashier_id, 'dine_in', 'paid',
    50000, 5000, 55000,
    (CURRENT_DATE - INTERVAL '2 days')::timestamptz + INTERVAL '10 hours'
  )
  RETURNING id INTO v_order1_id;

  -- Order 2: paid, day = CURRENT_DATE - 1 day (different day for by_day length=2)
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, paid_at
  )
  VALUES (
    'ORD-S40-002', v_session_id, v_cashier_id, 'dine_in', 'paid',
    80000, 8000, 88000,
    (CURRENT_DATE - INTERVAL '1 day')::timestamptz + INTERVAL '10 hours'
  )
  RETURNING id INTO v_order2_id;

  -- Refund on Order 1 (to test T5: net = gross - refund)
  INSERT INTO refunds (
    refund_number, order_id, session_id, total, tax_refunded,
    reason, refunded_by, authorized_by
  )
  VALUES (
    'REF-S40-001', v_order1_id, v_session_id, 20000, 2000,
    'S40 test refund', v_manager_id, v_manager_id
  )
  RETURNING id INTO v_refund_id;

  PERFORM set_config('breakery.t_s40_order1_total', '55000', true);
  PERFORM set_config('breakery.t_s40_order2_total', '88000', true);
  PERFORM set_config('breakery.t_s40_refund_total', '20000', true);
  PERFORM set_config('breakery.t_s40_date_start', (CURRENT_DATE - INTERVAL '7 days')::text, true);
  PERFORM set_config('breakery.t_s40_date_end',   CURRENT_DATE::text, true);

END $$;

-- ============================================================
-- S40.1 — RBAC audit trigger (T1-T2)
-- ============================================================

-- T1 : INSERT into role_permissions → 1 audit_logs row with action='role.permission_granted'
-- Strict assertion (spec-review fix): DELETE first so the INSERT is guaranteed
-- fresh, then assert count = before + 1 (mirrors T2). The preliminary DELETE's
-- own revoked row does not affect T2, which measures its own before/after.
DO $$
DECLARE
  v_count_before INT;
  v_count_after  INT;
  v_ok           BOOLEAN;
BEGIN
  DELETE FROM role_permissions WHERE role_code = 'CASHIER' AND permission_code = 'reports.read';

  SELECT COUNT(*) INTO v_count_before
    FROM audit_logs WHERE action = 'role.permission_granted' AND payload->>'role_code' = 'CASHIER'
      AND payload->>'permission_code' = 'reports.read';

  INSERT INTO role_permissions (role_code, permission_code, is_granted)
  VALUES ('CASHIER', 'reports.read', TRUE);

  SELECT COUNT(*) INTO v_count_after
    FROM audit_logs WHERE action = 'role.permission_granted' AND payload->>'role_code' = 'CASHIER'
      AND payload->>'permission_code' = 'reports.read';

  v_ok := (v_count_after = v_count_before + 1);
  PERFORM set_config('breakery.t1_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t1_pass')::boolean,
  'T1: INSERT role_permissions fires audit trigger → role.permission_granted row'
);

-- T2 : DELETE from role_permissions → 1 audit_logs row with action='role.permission_revoked'
DO $$
DECLARE
  v_count_before INT;
  v_count_after  INT;
  v_ok           BOOLEAN;
BEGIN
  -- Ensure the row exists to delete
  INSERT INTO role_permissions (role_code, permission_code, is_granted)
  VALUES ('CASHIER', 'reports.read', TRUE)
  ON CONFLICT (role_code, permission_code) DO NOTHING;

  SELECT COUNT(*) INTO v_count_before
    FROM audit_logs WHERE action = 'role.permission_revoked' AND payload->>'role_code' = 'CASHIER'
      AND payload->>'permission_code' = 'reports.read';

  DELETE FROM role_permissions WHERE role_code = 'CASHIER' AND permission_code = 'reports.read';

  SELECT COUNT(*) INTO v_count_after
    FROM audit_logs WHERE action = 'role.permission_revoked' AND payload->>'role_code' = 'CASHIER'
      AND payload->>'permission_code' = 'reports.read';

  v_ok := (v_count_after = v_count_before + 1);
  PERFORM set_config('breakery.t2_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t2_pass')::boolean,
  'T2: DELETE role_permissions fires audit trigger → role.permission_revoked row'
);

-- ============================================================
-- S40.2 — get_daily_sales_v1 (T3-T5 + T12)
-- ============================================================

-- T3 : CASHIER → 42501 (no reports.sales.read)
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_daily_sales_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t3_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass')::boolean,
  'T3: get_daily_sales_v1 CASHIER raises 42501'
);

-- T4 : MANAGER happy path → summary.order_count = 2, by_day length = 2
DO $$
DECLARE
  v_result  JSONB;
  v_ok      BOOLEAN;
  v_count   INT;
  v_by_day_len INT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_daily_sales_v1(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  v_count       := (v_result->'summary'->>'order_count')::int;
  v_by_day_len  := jsonb_array_length(v_result->'by_day');
  -- We seeded 2 orders on 2 different days; count >= 2 and by_day >= 2
  -- (might be higher if existing test data also falls in window — use >= to be safe)
  v_ok := (v_count >= 2) AND (v_by_day_len >= 2)
      AND (v_result ? 'period') AND (v_result ? 'summary') AND (v_result ? 'by_day');
  PERFORM set_config('breakery.t4_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t4_pass')::boolean,
  'T4: get_daily_sales_v1 MANAGER → summary.order_count >= 2, by_day length >= 2'
);

-- T5 : net = gross - refund_total (refund deducted correctly)
DO $$
DECLARE
  v_result       JSONB;
  v_net          NUMERIC;
  v_gross        NUMERIC;
  v_refund_total NUMERIC;
  v_ok           BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_daily_sales_v1(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  v_gross        := (v_result->'summary'->>'total')::numeric;
  v_refund_total := (v_result->'summary'->>'refund_total')::numeric;
  v_net          := (v_result->'summary'->>'net')::numeric;
  -- net must equal gross - refund_total
  v_ok := (v_net = v_gross - v_refund_total)
      AND (v_refund_total >= 20000);  -- at least our seeded refund
  PERFORM set_config('breakery.t5_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t5_pass')::boolean,
  'T5: get_daily_sales_v1 net = gross - refund_total (refund deducted)'
);

-- ============================================================
-- S40.3 — get_purchase_items_v1 (T6-T7)
-- ============================================================

-- T6 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_purchase_items_v1('2026-01-01', '2026-12-31', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t6_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t6_pass')::boolean,
  'T6: get_purchase_items_v1 CASHIER raises 42501'
);

-- T7 : MANAGER → lines returned for seeded PO; supplier filter works
DO $$
DECLARE
  v_result      JSONB;
  v_all         JSONB;
  v_filtered    JSONB;
  v_supplier_id UUID;
  v_ok          BOOLEAN;
  v_line_count  INT;
  v_filt_count  INT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_supplier_id := current_setting('breakery.t_s40_supplier_id')::uuid;

  -- All lines in window
  v_result := get_purchase_items_v1(
    (CURRENT_DATE - INTERVAL '7 days')::text,
    CURRENT_DATE::text,
    NULL
  );
  v_line_count := jsonb_array_length(v_result->'lines');

  -- Filtered by our test supplier → should return exactly our 2 seeded items
  v_result := get_purchase_items_v1(
    (CURRENT_DATE - INTERVAL '7 days')::text,
    CURRENT_DATE::text,
    v_supplier_id
  );
  v_filt_count := jsonb_array_length(v_result->'lines');

  -- Unknown supplier → 0 lines
  v_result := get_purchase_items_v1(
    (CURRENT_DATE - INTERVAL '7 days')::text,
    CURRENT_DATE::text,
    gen_random_uuid()
  );

  v_ok := (v_filt_count = 2)
      AND (v_line_count >= 2)
      AND (v_result ? 'period') AND (v_result ? 'summary') AND (v_result ? 'lines') AND (v_result ? 'truncated')
      AND ((v_result->'summary'->>'line_count')::int = 0);
  PERFORM set_config('breakery.t7_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t7_pass')::boolean,
  'T7: get_purchase_items_v1 → 2 lines for seeded supplier; unknown supplier returns 0'
);

-- ============================================================
-- S40.4 — get_purchase_by_date_v1 (T8-T9)
-- ============================================================

-- T8 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_purchase_by_date_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t8_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t8_pass')::boolean,
  'T8: get_purchase_by_date_v1 CASHIER raises 42501'
);

-- T9 : MANAGER → summary.po_count >= 1 (our seeded PO)
DO $$
DECLARE
  v_result  JSONB;
  v_ok      BOOLEAN;
  v_po_cnt  INT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_purchase_by_date_v1(
    (CURRENT_DATE - INTERVAL '7 days')::text,
    CURRENT_DATE::text
  );
  v_po_cnt := (v_result->'summary'->>'po_count')::int;
  v_ok := (v_po_cnt >= 1)
      AND (v_result ? 'period') AND (v_result ? 'summary') AND (v_result ? 'by_day');
  PERFORM set_config('breakery.t9_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t9_pass')::boolean,
  'T9: get_purchase_by_date_v1 MANAGER → summary.po_count >= 1'
);

-- ============================================================
-- S40.5 — get_purchase_by_supplier_v1 (T10-T11)
-- ============================================================

-- T10 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_purchase_by_supplier_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t10_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t10_pass')::boolean,
  'T10: get_purchase_by_supplier_v1 CASHIER raises 42501'
);

-- T11 : if only 1 supplier in the window, share_pct = 100
DO $$
DECLARE
  v_result     JSONB;
  v_suppliers  JSONB;
  v_supplier_id UUID;
  v_result2    JSONB;
  v_share      NUMERIC;
  v_ok         BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_supplier_id := current_setting('breakery.t_s40_supplier_id')::uuid;

  -- Query a narrow window that only has our single test supplier
  v_result := get_purchase_by_supplier_v1(
    (CURRENT_DATE - INTERVAL '7 days')::text,
    CURRENT_DATE::text
  );
  v_suppliers := v_result->'by_supplier';

  -- Find our supplier's share_pct
  SELECT (elem->>'share_pct')::numeric INTO v_share
    FROM jsonb_array_elements(v_suppliers) AS elem
   WHERE (elem->>'supplier_id') = v_supplier_id::text
   LIMIT 1;

  -- If our supplier is the only one in the window, its share_pct = 100
  -- If other suppliers exist, verify the total of all share_pcts ≈ 100
  IF jsonb_array_length(v_suppliers) = 1 THEN
    v_ok := (v_share = 100);
  ELSE
    -- Our supplier exists in the result and sum of all share_pcts <= 100
    DECLARE
      v_total_share NUMERIC := 0;
      v_elem JSONB;
    BEGIN
      FOR v_elem IN SELECT * FROM jsonb_array_elements(v_suppliers) LOOP
        v_total_share := v_total_share + (v_elem->>'share_pct')::numeric;
      END LOOP;
      v_ok := (v_share IS NOT NULL) AND (v_total_share <= 100.01);
    END;
  END IF;

  PERFORM set_config('breakery.t11_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t11_pass')::boolean,
  'T11: get_purchase_by_supplier_v1 → share_pct sums correctly (100 if single supplier)'
);

-- ============================================================
-- S40.6 — Input validation (T12)
-- ============================================================

-- T12 : get_daily_sales_v1 end < start → P0001
DO $$
DECLARE
  v_caught   BOOLEAN := false;
  v_sqlstate TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_daily_sales_v1('2026-12-31', '2026-01-01');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_caught := (v_sqlstate = 'P0001');
  END;
  PERFORM set_config('breakery.t12_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t12_pass')::boolean,
  'T12: get_daily_sales_v1 end < start raises P0001'
);

-- ============================================================
-- S40.7 — Wave A2 fixtures (production + price-change events)
-- Production seeded in an ISOLATED past window (2020-01-01..07) so the
-- aggregate assertions are exact regardless of pre-existing data.
-- Price-change events use a RANDOM entity_id so LAG history is clean.
-- ============================================================

DO $$
DECLARE
  v_manager_id  UUID;
  v_product_id  UUID;
  v_fake_product UUID := gen_random_uuid();
BEGIN
  SELECT id INTO v_manager_id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1;
  SELECT id INTO v_product_id FROM products WHERE is_active = true AND deleted_at IS NULL LIMIT 1;

  -- Production run: qty 10, waste 2, expected 10 / actual 9 → variance ratio -0.1
  INSERT INTO production_records (
    production_number, product_id, quantity_produced, quantity_waste,
    production_date, expected_yield_qty, actual_yield_qty
  )
  VALUES (
    'PROD-20200103-9940', v_product_id, 10, 2,
    '2020-01-03T10:00:00+08'::timestamptz, 10, 9
  );
  -- production_number CHECK requires ^PROD-[0-9]{8}-[0-9]{4,}$ — suffix 9940 = S40 test marker.

  -- Voided order by manager (for T14 voids_count) — voided today
  INSERT INTO orders (
    order_number, session_id, served_by, order_type, status,
    subtotal, tax_amount, total, voided_at, voided_by, void_reason, is_held
  )
  SELECT 'ORD-S40-VOID-001', ps.id, v_manager_id, 'dine_in', 'voided',
         30000, 3000, 33000, NOW(), v_manager_id, 'S40 test void', false
    FROM pos_sessions ps WHERE ps.status = 'open' LIMIT 1;

  -- Price-change events on a synthetic product id (clean LAG history):
  -- 1000 (older) then 1500 (newer), both inside 2021-01-01..2021-01-07.
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload, created_at)
  VALUES
    (NULL, 'product.update', 'product', v_fake_product,
     jsonb_build_object('retail_price', 1000), '2021-01-02T10:00:00+08'::timestamptz),
    (NULL, 'product.update', 'product', v_fake_product,
     jsonb_build_object('retail_price', 1500), '2021-01-03T10:00:00+08'::timestamptz);

  PERFORM set_config('breakery.t_s40_fake_product', v_fake_product::text, false);
  PERFORM set_config('breakery.t_s40_product_id', v_product_id::text, false);
  PERFORM set_config('breakery.t_s40_manager_profile', v_manager_id::text, false);
END $$;

-- ============================================================
-- S40.8 — get_staff_performance_v1 (T13-T14)
-- ============================================================

-- T13 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_staff_performance_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t13_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t13_pass')::boolean,
  'T13: get_staff_performance_v1 CASHIER raises 42501'
);

-- T14 : MANAGER → cashier row orders_served >= 2 ; manager row voids_count >= 1
DO $$
DECLARE
  v_result     JSONB;
  v_cashier_id UUID;
  v_manager_id UUID := current_setting('breakery.t_s40_manager_profile')::uuid;
  v_served     INT;
  v_voids      INT;
  v_ok         BOOLEAN;
BEGIN
  SELECT id INTO v_cashier_id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000002' LIMIT 1;
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_staff_performance_v1(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );

  SELECT (elem->>'orders_served')::int INTO v_served
    FROM jsonb_array_elements(v_result->'by_staff') AS elem
   WHERE (elem->>'staff_id') = v_cashier_id::text LIMIT 1;

  SELECT (elem->>'voids_count')::int INTO v_voids
    FROM jsonb_array_elements(v_result->'by_staff') AS elem
   WHERE (elem->>'staff_id') = v_manager_id::text LIMIT 1;

  v_ok := (v_served >= 2) AND (v_voids >= 1) AND (v_result ? 'period') AND (v_result ? 'by_staff');
  PERFORM set_config('breakery.t14_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t14_pass')::boolean,
  'T14: get_staff_performance_v1 → cashier served >= 2, manager voids >= 1'
);

-- ============================================================
-- S40.9 — get_production_report_v1 (T15-T16)
-- ============================================================

-- T15 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_production_report_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t15_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t15_pass')::boolean,
  'T15: get_production_report_v1 CASHIER raises 42501'
);

-- T16 : MANAGER, isolated 2020 window → total_produced = 10, total_waste = 2, runs = 1
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_production_report_v1('2020-01-01', '2020-01-07');
  v_ok := ((v_result->'summary'->>'total_produced')::numeric = 10)
      AND ((v_result->'summary'->>'total_waste')::numeric = 2)
      AND ((v_result->'summary'->>'runs')::int = 1)
      AND (jsonb_array_length(v_result->'by_product') = 1)
      AND (jsonb_array_length(v_result->'by_day') = 1);
  PERFORM set_config('breakery.t16_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t16_pass')::boolean,
  'T16: get_production_report_v1 → summary produced=10 waste=2 runs=1'
);

-- ============================================================
-- S40.10 — get_production_efficiency_v1 (T17-T18)
-- ============================================================

-- T17 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_production_efficiency_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t17_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t17_pass')::boolean,
  'T17: get_production_efficiency_v1 CASHIER raises 42501'
);

-- T18 : MANAGER → waste_rate_pct = 16.67 (2/(10+2)×100), avg_yield_variance_pct = -10
DO $$
DECLARE
  v_result JSONB;
  v_row    JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_production_efficiency_v1('2020-01-01', '2020-01-07');
  v_row := v_result->'by_product'->0;
  v_ok := ((v_row->>'waste_rate_pct')::numeric = 16.67)
      AND ((v_row->>'avg_yield_variance_pct')::numeric = -10.00)
      AND ((v_row->>'worst_variance_pct')::numeric = -10.00)
      AND ((v_row->>'has_variance_reasons')::boolean = false)
      AND (jsonb_array_length(v_result->'by_product') = 1);
  PERFORM set_config('breakery.t18_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t18_pass')::boolean,
  'T18: get_production_efficiency_v1 → waste_rate 16.67, variance -10'
);

-- ============================================================
-- S40.11 — get_price_changes_v1 (T19-T20)
-- ============================================================

-- T19 : CASHIER → 42501
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_price_changes_v1('2026-01-01', '2026-12-31', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t19_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t19_pass')::boolean,
  'T19: get_price_changes_v1 CASHIER raises 42501'
);

-- T20 : MANAGER → LAG correct on synthetic history + p_product_id filter operant
DO $$
DECLARE
  v_fake_product UUID := current_setting('breakery.t_s40_fake_product')::uuid;
  v_result JSONB;
  v_latest JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_price_changes_v1('2021-01-01', '2021-01-07', v_fake_product);
  -- changes sorted DESC → first element is the 1500 row
  v_latest := v_result->'changes'->0;
  v_ok := (jsonb_array_length(v_result->'changes') = 2)
      AND ((v_latest->>'new_price')::numeric = 1500)
      AND ((v_latest->>'old_price')::numeric = 1000)
      AND ((v_latest->>'delta_pct')::numeric = 50)
      AND ((v_result->'changes'->1->>'old_price') IS NULL)
      AND ((v_result->>'truncated')::boolean = false);

  -- filter on another random id → 0 changes
  v_result := get_price_changes_v1('2021-01-01', '2021-01-07', gen_random_uuid());
  v_ok := v_ok AND (jsonb_array_length(v_result->'changes') = 0);

  PERFORM set_config('breakery.t20_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t20_pass')::boolean,
  'T20: get_price_changes_v1 → LAG old/new/delta correct, filter operant'
);

-- ============================================================
-- S40.12 — get_permission_changes_v1 (T21-T22)
-- ============================================================

-- T21 : CASHIER → 42501 (gate reports.audit.read since corrective _021, MANAGER+)
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_permission_changes_v1('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t21_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t21_pass')::boolean,
  'T21: get_permission_changes_v1 CASHIER raises 42501 (reports.audit.read gate)'
);

-- T22 : MANAGER (allowed since corrective _021) → finds the T2 trigger row
DO $$
DECLARE
  v_result JSONB;
  v_found  INT;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_permission_changes_v1(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  SELECT COUNT(*) INTO v_found
    FROM jsonb_array_elements(v_result->'changes') AS elem
   WHERE elem->>'action' = 'role.permission_revoked'
     AND elem->>'role_code' = 'CASHIER'
     AND elem->>'permission_code' = 'reports.read';
  v_ok := (v_found >= 1) AND (v_result ? 'truncated');
  PERFORM set_config('breakery.t22_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t22_pass')::boolean,
  'T22: get_permission_changes_v1 MANAGER finds the trigger revoked row'
);

SELECT * FROM finish();
ROLLBACK;
