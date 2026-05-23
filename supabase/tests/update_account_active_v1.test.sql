-- supabase/tests/update_account_active_v1.test.sql
-- Session 26b / Wave 1.C — pgTAP suite for update_account_active_v1.
--
-- Coverage (4 asserts) :
--   T1  SUPER_ADMIN happy path : toggle is_active mutates accounts row
--   T2  MANAGER (no accounting.coa.write) raises P0003 forbidden
--   T3  Unknown account_id raises P0002 account_not_found
--   T4  audit_log row emitted with action='accounting.account.active_toggled'
--
-- Run via MCP execute_sql wrap BEGIN/ROLLBACK ; pgtap extension is pre-created
-- on V3 dev. Convention ERRCODE alignée sur S26 cockpit family (P0003 forbidden).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(4);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Use account 5910 (Cash Variance Loss) -- non-system, safe to toggle in test
-- (will rollback). Capture id + baseline.
DO $$
DECLARE
  v_account_id UUID;
  v_baseline BOOLEAN;
BEGIN
  SELECT id, is_active INTO v_account_id, v_baseline
    FROM accounts WHERE code = '5910' AND deleted_at IS NULL LIMIT 1;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Seed account 5910 not found';
  END IF;
  PERFORM set_config('breakery.s26b_account_id', v_account_id::text, false);
  PERFORM set_config('breakery.s26b_baseline_active', v_baseline::text, false);
END $$;

-- EMP000 = SUPER_ADMIN (has accounting.coa.write)
DO $$
DECLARE
  v_admin_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_admin_uid FROM user_profiles
   WHERE employee_code = 'EMP000' LIMIT 1;
  IF v_admin_uid IS NULL THEN
    RAISE EXCEPTION 'Seed user EMP000 not found';
  END IF;
  PERFORM set_config('breakery.s26b_admin_uid', v_admin_uid::text, false);
END $$;

-- =============================================================================
-- T1 : SUPER_ADMIN happy path — toggle is_active to opposite of baseline.
-- =============================================================================

DO $t1$
DECLARE
  v_uid UUID := current_setting('breakery.s26b_admin_uid')::UUID;
  v_pid UUID := current_setting('breakery.s26b_account_id')::UUID;
  v_baseline BOOLEAN := current_setting('breakery.s26b_baseline_active')::BOOLEAN;
  v_target BOOLEAN := NOT v_baseline;
  v_result JSONB;
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_uid::TEXT, 'role', 'authenticated')::TEXT, true);

  v_result := update_account_active_v1(v_pid, v_target);

  PERFORM set_config('breakery.s26b_t1_active',
    (SELECT is_active::TEXT FROM accounts WHERE id = v_pid), false);
  PERFORM set_config('breakery.s26b_t1_target', v_target::TEXT, false);
END $t1$;

SELECT is(
  current_setting('breakery.s26b_t1_active')::BOOLEAN,
  current_setting('breakery.s26b_t1_target')::BOOLEAN,
  'T1 SUPER_ADMIN toggle update_account_active_v1 mutates accounts.is_active'
);

-- =============================================================================
-- T2 : MANAGER (has accounting.coa.read but NOT accounting.coa.write)
-- raises P0003 forbidden.
-- =============================================================================

DO $t2$
DECLARE
  v_mgr_uid UUID;
BEGIN
  SELECT auth_user_id INTO v_mgr_uid FROM user_profiles
   WHERE role_code = 'MANAGER' AND deleted_at IS NULL LIMIT 1;
  IF v_mgr_uid IS NULL THEN
    RAISE EXCEPTION 'No MANAGER user available for T2';
  END IF;
  PERFORM set_config('breakery.s26b_mgr_uid', v_mgr_uid::TEXT, false);
END $t2$;

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object(
      'sub', current_setting('breakery.s26b_mgr_uid'),
      'role', 'authenticated'
    )::TEXT, true);
END $$;

SELECT throws_ok(
  format($q$SELECT update_account_active_v1(%L::UUID, TRUE)$q$,
         current_setting('breakery.s26b_account_id')),
  'P0003',
  'forbidden',
  'T2 MANAGER without accounting.coa.write raises P0003 forbidden'
);

-- =============================================================================
-- T3 : Unknown account_id raises P0002 account_not_found.
-- Re-impersonate as SUPER_ADMIN.
-- =============================================================================

DO $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', current_setting('breakery.s26b_admin_uid'),
                       'role', 'authenticated')::TEXT, true);
END $$;

SELECT throws_ok(
  $q$SELECT update_account_active_v1(
       '00000000-0000-0000-0000-deadbeefdead'::UUID,
       TRUE
     )$q$,
  'P0002',
  'account_not_found',
  'T3 unknown account_id raises P0002 account_not_found'
);

-- =============================================================================
-- T4 : audit_log row emitted with action='accounting.account.active_toggled'.
-- T1 already inserted 1 row -- assert it exists with correct payload shape.
-- =============================================================================

SELECT is(
  (SELECT COUNT(*)::INT FROM audit_log
    WHERE action = 'accounting.account.active_toggled'
      AND subject_id = current_setting('breakery.s26b_account_id')::UUID
      AND occurred_at > now() - interval '1 minute'
      AND payload ? 'old_is_active'
      AND payload ? 'new_is_active'),
  1,
  'T4 audit_log has 1 accounting.account.active_toggled row from T1 with correct payload'
);

SELECT * FROM finish();
ROLLBACK;
