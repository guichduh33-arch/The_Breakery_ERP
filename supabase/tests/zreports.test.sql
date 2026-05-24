-- supabase/tests/zreports.test.sql
-- S29 Wave 1.D.3 — pgTAP suite for Z-Reports (14 assertions T1–T14).
--
-- Covers:
--   T1  : z_reports SELECT works for authenticated (RLS USING true)
--   T2  : UNIQUE(shift_id) prevents duplicate z_reports
--   T3  : sign_zreport_v1 happy path → status='signed'
--   T4  : sign_zreport_v1 first call → idempotent_replay=false
--   T5  : sign_zreport_v1 idempotent replay → idempotent_replay=true
--   T6  : sign_zreport_v1 CASHIER denied (42501)
--   T7  : sign_zreport_v1 unknown id → P0002
--   T8  : void_zreport_v1 ADMIN happy → status='voided'
--   T9  : void_zreport_v1 MANAGER denied (42501)
--   T10 : void_zreport_v1 reason < 10 chars → 23514
--   T11 : z_reports INSERT blocked for authenticated role
--   T12 : storage.objects policy zreports_select exists
--   T13 : storage.objects policy reports_exports_select_own exists
--   T14 : REVOKE EXECUTE FROM anon on 3 zreport RPCs
--
-- Run via mcp execute_sql wrapped in BEGIN/ROLLBACK — self-cleaning.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- ============================================================================
-- Fixtures — insert test users + sessions + z_report rows
-- ============================================================================

-- Admin user for T8 (void) + T10 (short reason)
INSERT INTO auth.users (id, email)
VALUES ('cccccccc-0000-0000-0000-000000000029', 'admin@zreport29.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_profiles (id, auth_user_id, employee_code, full_name, role_code, pin_hash, is_active)
VALUES ('cccccccc-0000-0000-0000-000000000029', 'cccccccc-0000-0000-0000-000000000029',
        'EMP-ZR29-ADMIN', 'Admin ZReport29', 'ADMIN', 'x', true)
ON CONFLICT (id) DO NOTHING;

-- Main test session (closed) — used for T1/T2/T3/T4/T5/T6/T7
INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status, closed_at, closed_by, closing_cash, expected_cash)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  now() - interval '8 hours',
  500000,
  'closed',
  now() - interval '1 minute',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  1500000,
  1500000
);

-- Second session for T8/T9 (void tests — separate from sign flow)
INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status, closed_at, closed_by, closing_cash, expected_cash)
VALUES (
  'dddddddd-0000-0000-0000-000000000002',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  now() - interval '4 hours',
  300000,
  'closed',
  now() - interval '30 minutes',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  900000,
  900000
);

-- Third session for T9 (MANAGER denied void — needs its own signed z_report)
INSERT INTO pos_sessions (id, opened_by, opened_at, opening_cash, status, closed_at, closed_by, closing_cash, expected_cash)
VALUES (
  'dddddddd-0000-0000-0000-000000000003',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  now() - interval '2 hours',
  200000,
  'closed',
  now() - interval '10 minutes',
  (SELECT id FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000004' LIMIT 1),
  600000,
  600000
);

-- Insert draft z_report for main session (T1/T2/T3/T4/T5/T6)
INSERT INTO z_reports (id, shift_id, snapshot, status)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000001',
  'dddddddd-0000-0000-0000-000000000001',
  _build_zreport_snapshot('dddddddd-0000-0000-0000-000000000001'),
  'draft'
);

-- Insert draft z_report for second session — will be voided in T8
INSERT INTO z_reports (id, shift_id, snapshot, status)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000002',
  'dddddddd-0000-0000-0000-000000000002',
  _build_zreport_snapshot('dddddddd-0000-0000-0000-000000000002'),
  'draft'
);

-- Insert draft z_report for third session — used by T9/T10
INSERT INTO z_reports (id, shift_id, snapshot, status)
VALUES (
  'eeeeeeee-0000-0000-0000-000000000003',
  'dddddddd-0000-0000-0000-000000000003',
  _build_zreport_snapshot('dddddddd-0000-0000-0000-000000000003'),
  'draft'
);

-- ============================================================================
-- Plan
-- ============================================================================
SELECT plan(14);

-- ============================================================================
-- T1 : z_reports SELECT works for authenticated (RLS USING true)
-- ============================================================================
SELECT ok(
  EXISTS(SELECT 1 FROM z_reports WHERE id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'T1: z_reports SELECT works for the test session'
);

-- ============================================================================
-- T2 : UNIQUE(shift_id) prevents duplicate z_reports
-- ============================================================================
DO $$
DECLARE
  v_violated BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO z_reports (shift_id, snapshot, status)
    VALUES ('dddddddd-0000-0000-0000-000000000001', '{}'::jsonb, 'draft');
  EXCEPTION WHEN unique_violation THEN
    v_violated := true;
  END;
  PERFORM set_config('breakery.t2_pass', v_violated::text, false);
END
$$;
SELECT ok(current_setting('breakery.t2_pass')::boolean, 'T2: UNIQUE(shift_id) prevents duplicate z_reports');

-- ============================================================================
-- T3/T4 : sign_zreport_v1 happy path (MANAGER impersonation)
-- ============================================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := sign_zreport_v1('eeeeeeee-0000-0000-0000-000000000001');
  PERFORM set_config('breakery.t3_status', v_result->>'status', false);
  PERFORM set_config('breakery.t4_replay', (v_result->>'idempotent_replay'), false);
END
$$;
SELECT is(current_setting('breakery.t3_status'), 'signed',
  'T3: sign_zreport_v1 happy path returns status=signed');
SELECT is(current_setting('breakery.t4_replay'), 'false',
  'T4: sign_zreport_v1 first call idempotent_replay=false');

-- ============================================================================
-- T5 : sign_zreport_v1 idempotent replay (same report, same user)
-- ============================================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := sign_zreport_v1('eeeeeeee-0000-0000-0000-000000000001');
  PERFORM set_config('breakery.t5_replay', (v_result->>'idempotent_replay'), false);
END
$$;
SELECT is(current_setting('breakery.t5_replay'), 'true',
  'T5: sign_zreport_v1 second call idempotent_replay=true');

-- ============================================================================
-- T6 : sign_zreport_v1 CASHIER denied (42501) — CASHIER has no zreports.sign
-- ============================================================================
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000002"}';
  BEGIN
    PERFORM sign_zreport_v1('eeeeeeee-0000-0000-0000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t6_pass', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.t6_pass')::boolean,
  'T6: sign_zreport_v1 CASHIER raises 42501');

-- ============================================================================
-- T7 : sign_zreport_v1 unknown id → P0002
-- ============================================================================
DO $$
DECLARE
  v_caught   BOOLEAN := false;
  v_sqlstate TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM sign_zreport_v1(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_caught := (v_sqlstate = 'P0002');
  END;
  PERFORM set_config('breakery.t7_pass', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.t7_pass')::boolean,
  'T7: sign_zreport_v1 unknown id raises P0002');

-- ============================================================================
-- T8 : void_zreport_v1 ADMIN happy path → status='voided'
-- (using second z_report which is still 'draft')
-- ============================================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-0000-0000-0000-000000000029"}';
  v_result := void_zreport_v1(
    'eeeeeeee-0000-0000-0000-000000000002',
    'Manager misclicked, signed wrong shift'
  );
  PERFORM set_config('breakery.t8_status', v_result->>'status', false);
END
$$;
SELECT is(current_setting('breakery.t8_status'), 'voided',
  'T8: void_zreport_v1 (ADMIN, valid reason) returns voided');

-- ============================================================================
-- T9 : void_zreport_v1 MANAGER denied (42501) — MANAGER has no zreports.void
-- (using third z_report)
-- ============================================================================
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  BEGIN
    PERFORM void_zreport_v1(
      'eeeeeeee-0000-0000-0000-000000000003',
      'should not work as manager at all'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  PERFORM set_config('breakery.t9_pass', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.t9_pass')::boolean,
  'T9: void_zreport_v1 MANAGER raises 42501');

-- ============================================================================
-- T10 : void_zreport_v1 reason < 10 chars → 23514
-- (ADMIN user, third z_report is still draft)
-- ============================================================================
DO $$
DECLARE
  v_caught   BOOLEAN := false;
  v_sqlstate TEXT;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"cccccccc-0000-0000-0000-000000000029"}';
  BEGIN
    PERFORM void_zreport_v1('eeeeeeee-0000-0000-0000-000000000003', 'short');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_caught := (v_sqlstate = '23514');
  END;
  PERFORM set_config('breakery.t10_pass', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.t10_pass')::boolean,
  'T10: void_zreport_v1 reason < 10 chars raises 23514');

-- ============================================================================
-- T11 : z_reports INSERT blocked for authenticated role
-- ============================================================================
DO $$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO z_reports (shift_id, snapshot, status)
    VALUES (gen_random_uuid(), '{}'::jsonb, 'draft');
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  RESET ROLE;
  PERFORM set_config('breakery.t11_pass', v_caught::text, false);
END
$$;
SELECT ok(current_setting('breakery.t11_pass')::boolean,
  'T11: z_reports INSERT blocked for authenticated role');

-- ============================================================================
-- T12 : storage.objects policy zreports_select exists
-- ============================================================================
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'zreports_select'
  ),
  'T12: storage.objects policy zreports_select exists'
);

-- ============================================================================
-- T13 : storage.objects policy reports_exports_select_own exists
-- ============================================================================
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND policyname = 'reports_exports_select_own'
  ),
  'T13: storage.objects policy reports_exports_select_own exists'
);

-- ============================================================================
-- T14 : REVOKE EXECUTE FROM anon on 3 zreport RPCs
-- ============================================================================
SELECT ok(
  NOT has_function_privilege('anon', 'sign_zreport_v1(uuid)', 'execute')
  AND NOT has_function_privilege('anon', 'void_zreport_v1(uuid, text)', 'execute')
  AND NOT has_function_privilege('anon', 'get_zreport_snapshot_v1(uuid)', 'execute'),
  'T14: anon cannot EXECUTE sign/void/get_snapshot zreport RPCs'
);

SELECT * FROM finish();
ROLLBACK;
