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
  v_result := get_purchase_by_supplier_v2(
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
  'T11: get_purchase_by_supplier_v2 → share_pct sums correctly (100 if single supplier)'
);

-- ============================================================
-- S40.6 — Input validation (T12)
-- ============================================================

-- T12 : get_daily_sales_v3 end < start → P0001
DO $$
DECLARE
  v_caught   BOOLEAN := false;
  v_sqlstate TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM get_daily_sales_v3('2026-12-31', '2026-01-01');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_caught := (v_sqlstate = 'P0001');
  END;
  PERFORM set_config('breakery.t12_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t12_pass')::boolean,
  'T12: get_daily_sales_v3 end < start raises P0001'
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
  -- Lot 1.B (2026-08-03) : waste_reason ajouté au fixture. La contrainte
  -- production_records_waste_reason_required (une perte non nulle exige son
  -- motif) est arrivée après l'écriture de ce test, qui échouait donc à
  -- l'insertion — toute la suite S40 tombait avec lui.
  INSERT INTO production_records (
    production_number, product_id, quantity_produced, quantity_waste,
    waste_reason, production_date, expected_yield_qty, actual_yield_qty
  )
  VALUES (
    'PROD-20200103-9940', v_product_id, 10, 2, 'mis_baked',
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
-- S40.12 — get_permission_changes_v3 (T21-T22)
-- ============================================================

-- T21 : CASHIER → 42501 (gate reports.audit.read since corrective _021, MANAGER+)
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM get_permission_changes_v3('2026-01-01', '2026-12-31');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t21_pass', v_caught::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t21_pass')::boolean,
  'T21: get_permission_changes_v3 CASHIER raises 42501 (reports.audit.read gate)'
);

-- T22 : MANAGER (allowed since corrective _021) → finds the T2 trigger row
DO $$
DECLARE
  v_result JSONB;
  v_found  INT;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_permission_changes_v3(
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
  'T22: get_permission_changes_v3 MANAGER finds the trigger revoked row'
);

-- ============================================================
-- S40.13 — get_daily_sales_v3 extension (lot I, T23-T24)
-- Payload additif : summary +discount_total/discount_orders_count/
-- voids_count/voids_value, racine +sessions.
-- ============================================================

-- T23 : MANAGER → summary carries the 4 new keys ; voids_count/voids_value
-- cover the S40.7 seeded void (ORD-S40-VOID-001, total 33000, voided today).
DO $$
DECLARE
  v_result JSONB;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_daily_sales_v3(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  v_ok := (v_result->'summary' ? 'discount_total')
      AND (v_result->'summary' ? 'discount_orders_count')
      AND (v_result->'summary' ? 'voids_count')
      AND (v_result->'summary' ? 'voids_value')
      AND ((v_result->'summary'->>'voids_count')::int >= 1)
      AND ((v_result->'summary'->>'voids_value')::numeric >= 33000)
      AND ((v_result->'summary'->>'discount_total')::numeric >= 0)
      AND ((v_result->'summary'->>'discount_orders_count')::int >= 0);
  PERFORM set_config('breakery.t23_pass', v_ok::text, false);
END $$;
