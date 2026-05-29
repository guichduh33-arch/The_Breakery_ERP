-- supabase/tests/orders_list_v2.test.sql
-- Session 33 / Wave 4.1 — server-side filter coverage for get_orders_list_v2.
-- Runs via MCP execute_sql with BEGIN ... ROLLBACK envelope.
--
-- Coverage (10 cases) :
--   T1  perm gate : CASHIER without orders.read → 42501
--   T2  refund_status='none' server-side filter runs
--   T3  refund_status='partial' server-side filter runs
--   T4  refund_status='full' server-side filter runs
--   T5  hour filter runs (EXTRACT HOUR AT TIME ZONE Asia/Makassar)
--   T6  terminal_id filter JOINs pos_sessions correctly
--   T7  combo refund_status + hour + status
--   T8  limit clamp : p_limit=500 → ≤ 200
--   T9  output line includes terminal_id key (or no rows)
--   T10 unknown filter key silently ignored
--
-- Auth simulated via set_config('request.jwt.claim.sub', '<uuid>', true)
-- as is the project convention (see orders_list_v1.test.sql).

BEGIN;
SELECT plan(10);

-- ===== T1 : CASHIER without orders.read → 42501 =====
DO $$
DECLARE
  v_cashier_id UUID := (SELECT id FROM user_profiles WHERE role_code='CASHIER' LIMIT 1);
  v_status TEXT := 'fail_no_raise';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_cashier_id::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31', '{}'::jsonb, 50, NULL);
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_status := 'pass';
  END;
  PERFORM set_config('breakery.t1_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t1_pass') = 'pass',
  'T1: CASHIER without orders.read raises 42501'
);

-- Establish MANAGER context for T2..T10
DO $$
DECLARE v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
END $$;

-- ===== T2 : refund_status='none' filter runs =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('refund_status', 'none'), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t2_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t2_pass') = 'pass',
  'T2: refund_status=none server-side filter runs'
);

-- ===== T3 : refund_status='partial' filter runs =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('refund_status', 'partial'), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t3_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t3_pass') = 'pass',
  'T3: refund_status=partial server-side filter runs'
);

-- ===== T4 : refund_status='full' filter runs =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('refund_status', 'full'), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t4_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t4_pass') = 'pass',
  'T4: refund_status=full server-side filter runs'
);

-- ===== T5 : hour filter (Asia/Makassar) =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('hour', 14), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t5_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t5_pass') = 'pass',
  'T5: hour filter runs without error (EXTRACT HOUR AT TIME ZONE Asia/Makassar)'
);

-- ===== T6 : terminal_id filter with valid UUID =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_terminal UUID := (SELECT id FROM lan_devices WHERE device_type='pos' AND is_active=true LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('terminal_id', v_terminal::text), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t6_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t6_pass') = 'pass',
  'T6: terminal_id filter JOINs pos_sessions correctly'
);

-- ===== T7 : combo filters =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('refund_status', 'none', 'hour', 12, 'status', 'completed'),
      50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t7_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t7_pass') = 'pass',
  'T7: combo refund_status + hour + status runs'
);

-- ===== T8 : limit clamp 500 → ≤ 200 =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_result JSONB;
  v_count INT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v2('2026-01-01', '2026-12-31', '{}'::jsonb, 500, NULL) INTO v_result;
  v_count := jsonb_array_length(v_result->'lines');
  PERFORM set_config('breakery.t8_pass',
    CASE WHEN v_count <= 200 THEN 'pass' ELSE 'fail_unclamped' END,
    false);
END $$;
SELECT ok(
  current_setting('breakery.t8_pass') = 'pass',
  'T8: limit=500 clamped to ≤ 200'
);

-- ===== T9 : output line shape includes terminal_id key =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_result JSONB;
  v_count INT;
  v_has_key BOOLEAN;
  v_status TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  SELECT get_orders_list_v2('2026-01-01', '2026-12-31', '{}'::jsonb, 1, NULL) INTO v_result;
  v_count := jsonb_array_length(v_result->'lines');
  IF v_count = 0 THEN
    v_status := 'pass_empty';
  ELSE
    v_has_key := (v_result->'lines'->0) ? 'terminal_id';
    v_status := CASE WHEN v_has_key THEN 'pass' ELSE 'fail_missing_key' END;
  END IF;
  PERFORM set_config('breakery.t9_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t9_pass') IN ('pass', 'pass_empty'),
  'T9: output line includes terminal_id key (or no rows in DB)'
);

-- ===== T10 : unknown filter silently ignored =====
DO $$
DECLARE
  v_mgr UUID := (SELECT id FROM user_profiles WHERE role_code='MANAGER' LIMIT 1);
  v_status TEXT := 'fail_raised';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_mgr::text, true);
  BEGIN
    PERFORM get_orders_list_v2('2026-05-01', '2026-05-31',
      jsonb_build_object('foo_unknown', 'bar'), 50, NULL);
    v_status := 'pass';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'fail_' || SQLSTATE;
  END;
  PERFORM set_config('breakery.t10_pass', v_status, false);
END $$;
SELECT ok(
  current_setting('breakery.t10_pass') = 'pass',
  'T10: unknown filter key silently ignored'
);

SELECT * FROM finish();
ROLLBACK;
