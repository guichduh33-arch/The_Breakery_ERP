-- supabase/tests/sign_zreport_pin.test.sql
-- S37 Wave A Task A5 (BO-01) — sign_zreport_v2 valide réellement le PIN manager.
-- Exécuter via MCP execute_sql (BEGIN..ROLLBACK).
BEGIN;
SELECT plan(6);

DO $$
DECLARE
  v_auth UUID; v_prof UUID; v_sess UUID; v_zr UUID;
BEGIN
  -- Caller : un user avec zreports.sign, PIN connu (tx-local, rollback).
  SELECT up.auth_user_id, up.id INTO v_auth, v_prof
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.auth_user_id IS NOT NULL
     AND has_permission(up.auth_user_id, 'zreports.sign')
   LIMIT 1;
  PERFORM set_config('request.jwt.claim.sub', v_auth::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth)::text, true);
  UPDATE user_profiles SET pin_hash = extensions.crypt('424242', extensions.gen_salt('bf'))
   WHERE id = v_prof;

  -- S77 (D-7) : clôture transactionnelle d'une éventuelle session ouverte
  -- fuitée pour ce profil (annulée par le ROLLBACK final).
  UPDATE pos_sessions SET status='closed', closed_at=now(), closed_by=v_prof, closing_cash=0
   WHERE opened_by = v_prof AND status='open';

  INSERT INTO pos_sessions (opened_by, opening_cash, status)
    VALUES (v_prof, 0, 'open') RETURNING id INTO v_sess;
  INSERT INTO z_reports (shift_id, snapshot) VALUES (v_sess, '{}'::jsonb) RETURNING id INTO v_zr;

  PERFORM set_config('breakery.v_zr', v_zr::text, true);
END $$;

-- T1 : PIN NULL → P0001, status reste draft
SELECT throws_ok(
  $$ SELECT sign_zreport_v2(current_setting('breakery.v_zr')::uuid, NULL) $$,
  'P0001', NULL, 'T1 NULL PIN raises pin_required');

-- T2 : mauvais PIN → P0003, status reste draft
SELECT throws_ok(
  $$ SELECT sign_zreport_v2(current_setting('breakery.v_zr')::uuid, '999999') $$,
  'P0003', NULL, 'T2 wrong PIN raises invalid_pin');
SELECT is(
  (SELECT status::text FROM z_reports WHERE id = current_setting('breakery.v_zr')::uuid),
  'draft', 'T2b status still draft after rejected PINs');

-- T3 : bon PIN → signed + audit
DO $$ DECLARE v_res JSONB; v_audit INT;
BEGIN
  v_res := sign_zreport_v2(current_setting('breakery.v_zr')::uuid, '424242');
  SELECT count(*) INTO v_audit FROM audit_logs
   WHERE action = 'zreport.sign' AND entity_id = current_setting('breakery.v_zr')::uuid;
  PERFORM set_config('breakery.t3_ok', ((v_res->>'status') = 'signed' AND (v_res->>'idempotent_replay')::boolean = false)::text, true);
  PERFORM set_config('breakery.t3_audit', (v_audit = 1)::text, true);
END $$;
SELECT is(current_setting('breakery.t3_ok'), 'true', 'T3 correct PIN signs the Z-report');
SELECT is(current_setting('breakery.t3_audit'), 'true', 'T4 emits zreport.sign audit row');

-- T5 : replay avec bon PIN → idempotent_replay = true
DO $$ DECLARE v_res JSONB;
BEGIN
  v_res := sign_zreport_v2(current_setting('breakery.v_zr')::uuid, '424242');
  PERFORM set_config('breakery.t5_ok', ((v_res->>'idempotent_replay')::boolean = true AND (v_res->>'status') = 'signed')::text, true);
END $$;
SELECT is(current_setting('breakery.t5_ok'), 'true', 'T5 idempotent replay returns same result');

SELECT * FROM finish();
ROLLBACK;
