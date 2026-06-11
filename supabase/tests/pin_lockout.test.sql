-- supabase/tests/pin_lockout.test.sql
-- S38 Wave A Task A3 (SEC-06) — _verify_pin_with_lockout + record_pin_failure_v1 + gate P0004.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
--
-- NOTE (DEV-S38-A-02) : on n'asserte PAS « un PIN faux via sign_zreport_v2 incrémente le
-- compteur » — c'est FAUX par construction : PostgREST enveloppe l'appel dans une transaction
-- unique, le RAISE P0003 de la RPC rollback l'incrément du helper. Les garanties réelles
-- testées ici : (1) le helper standalone compte + lock (politique 5/15min), (2) le gate
-- locked_until → P0004 est effectif DANS les RPCs (lecture seule, survit au raise),
-- (3) record_pin_failure_v1 (transaction séparée, EF service_role) compte + lock,
-- (4) REVOKEs, (5) non-régression du happy path.
BEGIN;
SELECT plan(12);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_zr UUID;
  v_failed_base INT; v_locked_base INT;
BEGIN
  -- Caller : un user avec zreports.sign, PIN connu (tx-local, rollback).
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'zreports.sign')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  UPDATE user_profiles
     SET pin_hash = extensions.crypt('424242', extensions.gen_salt('bf')),
         failed_login_attempts = 0, locked_until = NULL
   WHERE id = v_prof;

  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  INSERT INTO z_reports (shift_id, snapshot) VALUES (v_sess, '{}'::jsonb) RETURNING id INTO v_zr;

  SELECT count(*) INTO v_failed_base FROM audit_logs WHERE action = 'pin.failed' AND entity_id = v_prof;
  SELECT count(*) INTO v_locked_base FROM audit_logs WHERE action = 'pin.locked' AND entity_id = v_prof;

  PERFORM set_config('breakery.v_prof', v_prof::text, true);
  PERFORM set_config('breakery.v_zr', v_zr::text, true);
  PERFORM set_config('breakery.failed_base', v_failed_base::text, true);
  PERFORM set_config('breakery.locked_base', v_locked_base::text, true);
END $$;

-- T1 : helper happy path
SELECT is(
  _verify_pin_with_lockout(current_setting('breakery.v_prof')::uuid, '424242'),
  true, 'T1 helper returns true on correct PIN');

-- T2 : 5 échecs standalone → compteur + lock posés (le helper retourne false sans raise,
-- donc ses écritures persistent dans NOTRE transaction)
DO $$
DECLARE i INT; v_r BOOLEAN;
BEGIN
  FOR i IN 1..5 LOOP
    v_r := _verify_pin_with_lockout(current_setting('breakery.v_prof')::uuid, '000000');
    IF v_r THEN RAISE EXCEPTION 'helper returned true on wrong PIN'; END IF;
  END LOOP;
END $$;
SELECT isnt(
  (SELECT locked_until FROM user_profiles WHERE id = current_setting('breakery.v_prof')::uuid),
  NULL, 'T2a locked_until set after 5 failures');
SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('breakery.v_prof')::uuid),
  5, 'T2b failed_login_attempts = 5');

-- T3 : 6e tentative → P0004 account_locked
SELECT throws_ok(
  $$ SELECT _verify_pin_with_lockout(current_setting('breakery.v_prof')::uuid, '000000') $$,
  'P0004', NULL, 'T3 6th attempt raises P0004 account_locked');

-- T4 : audit trail — 4 pin.failed + 1 pin.locked (deltas vs baseline)
SELECT is(
  (SELECT count(*)::int - current_setting('breakery.failed_base')::int
     FROM audit_logs WHERE action = 'pin.failed' AND entity_id = current_setting('breakery.v_prof')::uuid),
  4, 'T4a 4 pin.failed audit rows');
SELECT is(
  (SELECT count(*)::int - current_setting('breakery.locked_base')::int
     FROM audit_logs WHERE action = 'pin.locked' AND entity_id = current_setting('breakery.v_prof')::uuid),
  1, 'T4b 1 pin.locked audit row');

-- T5 : reset admin, 1 échec puis 1 succès → compteur retombe à 0
DO $$
DECLARE v_r BOOLEAN;
BEGIN
  UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL
   WHERE id = current_setting('breakery.v_prof')::uuid;
  v_r := _verify_pin_with_lockout(current_setting('breakery.v_prof')::uuid, '111111'); -- échec → 1
  v_r := _verify_pin_with_lockout(current_setting('breakery.v_prof')::uuid, '424242'); -- succès → reset
END $$;
SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('breakery.v_prof')::uuid),
  0, 'T5 success resets failed_login_attempts to 0');

-- T6 : gate effectif DANS la RPC — caller locké → sign_zreport_v2 raise P0004 (même avec bon PIN)
DO $$ BEGIN
  UPDATE user_profiles SET locked_until = now() + interval '10 minutes'
   WHERE id = current_setting('breakery.v_prof')::uuid;
END $$;
SELECT throws_ok(
  $$ SELECT sign_zreport_v2(current_setting('breakery.v_zr')::uuid, '424242') $$,
  'P0004', NULL, 'T6 locked caller cannot sign zreport even with correct PIN');

-- T7 : REVOKEs — helper + record_pin_failure_v1 inaccessibles aux rôles applicatifs
SELECT is(
  (SELECT has_function_privilege('authenticated', 'public._verify_pin_with_lockout(uuid, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public._verify_pin_with_lockout(uuid, text)', 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.record_pin_failure_v1(uuid, text)', 'EXECUTE')
       OR has_function_privilege('anon', 'public.record_pin_failure_v1(uuid, text)', 'EXECUTE')),
  false, 'T7 helper + record_pin_failure_v1 revoked from authenticated and anon');

-- T8 : record_pin_failure_v1 — comptage transaction séparée (chemin EF) : 5 appels → locked
DO $$
DECLARE i INT; v_r JSONB;
BEGIN
  UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL
   WHERE id = current_setting('breakery.v_prof')::uuid;
  FOR i IN 1..5 LOOP
    v_r := record_pin_failure_v1(current_setting('breakery.v_prof')::uuid, 'process-payment');
  END LOOP;
  PERFORM set_config('breakery.t8_ok',
    ((v_r->>'locked')::boolean = true AND (v_r->>'attempts')::int = 5)::text, true);
END $$;
SELECT is(current_setting('breakery.t8_ok'), 'true', 'T8 record_pin_failure_v1 locks at 5th failure');

-- T9/T10 : non-régression happy path — caller débloqué, bon PIN → zreport signé
DO $$ DECLARE v_res JSONB;
BEGIN
  UPDATE user_profiles SET failed_login_attempts = 0, locked_until = NULL
   WHERE id = current_setting('breakery.v_prof')::uuid;
  v_res := sign_zreport_v2(current_setting('breakery.v_zr')::uuid, '424242');
  PERFORM set_config('breakery.t9_ok', ((v_res->>'status') = 'signed')::text, true);
END $$;
SELECT is(current_setting('breakery.t9_ok'), 'true', 'T9 correct PIN signs zreport after unlock');
SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('breakery.v_prof')::uuid),
  0, 'T10 happy path leaves counter at 0');

SELECT * FROM finish();
ROLLBACK;
