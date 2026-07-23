-- supabase/tests/close_shift_pin_gate.test.sql
-- S66 (12 D2.1) — close_shift_v8 : approbation manager (approbateur désigné +
-- PIN 6 chiffres) exigée serveur au-delà des seuils
-- business_config.shift_variance_pin_threshold_abs/pct (défauts 200 000 / 2 %).
--   T1  : variance dans la bande « note seule » (1 %) + note, sans approbateur -> OK
--   T2  : variance sur-seuil PIN + note, sans approbateur -> pin_approval_required (P0001)
--   T3  : approbateur sans shift.variance.approve (cashier) -> approver_not_authorized (P0003)
--   T4  : PIN au mauvais format (pas 6 chiffres) -> invalid_pin (P0003)…
--   T4b : … SANS consommer de tentative (miroir manager-pin.ts : un typo de
--         format n'est pas un signal brute-force)
--   T5  : PIN faux -> invalid_pin (P0003)…
--   T5b : … l'incrément de failed_login_attempts est ANNULÉ par l'exception
--         (⚠️ FINDING F-1 S66, pré-existant S38 : pour TOUS les RPCs PIN-in-arg
--         qui RAISE après _verify_pin_with_lockout — void_zreport_v2,
--         sign_zreport_v2, etc. — le rollback de la transaction emporte le
--         compteur ; seul le chemin EF (auth-verify-pin / manager-pin.ts)
--         persiste les échecs. Le helper reste utile : il honore locked_until
--         posé par le chemin EF. Fix envisageable = comptage via EF ou
--         transaction autonome — hors périmètre S66, dette D-x INDEX)
--   T6  : approbateur légitime + bon PIN -> clôture OK
--   T6b : session closed + variance_approved_by = approbateur
--   T6c : compteur d'échecs remis à zéro par le succès PIN
--   T7  : replay sur session fermée -> idempotent_replay=true, gardes court-circuitées
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

-- ===========================================================================
-- Fixtures (pattern close_shift_note_enforced) :
--  - caller EMP003 (shift.close) ; approbateur EMP000 (rôle manager, PIN posé
--    à 654321 pour la durée de la transaction) ; un cashier actif quelconque
--    comme approbateur NON autorisé.
--  - s1 (EMP003, opening 500 000) : compté 800 000 -> variance +300 000
--    (> 200 000 abs) — sert T2..T7.
--  - s2 (EMP000, opening 10 000 000) : compté 10 100 000 -> variance +100 000
--    (1 % : note requise, PIN non requis) — sert T1.
-- ===========================================================================
DO $fixture$
DECLARE
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_appr_auth UUID; v_appr_prof UUID;
  v_cashier_prof UUID;
  v_s2_owner UUID;
BEGIN
  SELECT auth_user_id, id INTO v_mgr_auth, v_mgr_prof
    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP003 profile not found'; END IF;

  SELECT auth_user_id, id INTO v_appr_auth, v_appr_prof
    FROM user_profiles WHERE employee_code = 'EMP000' AND deleted_at IS NULL;
  IF v_appr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP000 profile not found'; END IF;

  SELECT id INTO v_cashier_prof
    FROM user_profiles
   WHERE role_code = 'CASHIER' AND is_active = TRUE AND deleted_at IS NULL
   LIMIT 1;
  IF v_cashier_prof IS NULL THEN RAISE EXCEPTION 'fixture: no active CASHIER profile'; END IF;

  -- Propriétaire de s2 : n'importe quel profil actif SANS session ouverte
  -- (exclusion one_open_session_per_user — la base dev vivante peut avoir des
  -- sessions ouvertes, EMP000 en avait une au premier run) et != EMP003 (s1).
  SELECT up.id INTO v_s2_owner
    FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id <> v_mgr_prof
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps
                      WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  IF v_s2_owner IS NULL THEN RAISE EXCEPTION 'fixture: no free profile for s2'; END IF;

  -- PIN connu + compteurs propres pour l'approbateur (rollback = sans trace).
  UPDATE user_profiles
     SET pin_hash = extensions.crypt('654321', extensions.gen_salt('bf')),
         failed_login_attempts = 0,
         locked_until = NULL
   WHERE id = v_appr_prof;

  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);

  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('66c50001-0000-0000-0000-000000000001', v_mgr_prof, 500000, 'open');

  INSERT INTO pos_sessions (id, opened_by, opening_cash, status)
  VALUES ('66c50001-0000-0000-0000-000000000002', v_s2_owner, 10000000, 'open');

  PERFORM set_config('shift66.appr_prof', v_appr_prof::text, false);
  PERFORM set_config('shift66.cashier_prof', v_cashier_prof::text, false);
END $fixture$;

-- ===========================================================================
-- T1 — bande « note seule » : +100 000 sur 10 000 000 (1 %) avec note, sans
-- approbateur -> passe (le seuil PIN par défaut est 200 000 / 2 %).
-- ===========================================================================
SELECT lives_ok(
  $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000002'::uuid, 10100000, 'over from event float', NULL)$$,
  'T1: note-band variance with a note, no approver -> succeeds'
);

-- ===========================================================================
-- T2 — sur-seuil PIN (+300 000), note fournie mais pas d'approbateur/PIN.
-- ===========================================================================
SELECT throws_ok(
  $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, 'large overage, event cash', NULL)$$,
  'P0001', 'pin_approval_required',
  'T2: above-PIN-threshold variance without approver -> pin_approval_required (P0001)'
);

-- ===========================================================================
-- T3 — approbateur sans la permission (cashier).
-- ===========================================================================
SELECT throws_ok(
  format(
    $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, 'large overage, event cash', NULL, %L::uuid, '654321')$$,
    current_setting('shift66.cashier_prof')
  ),
  'P0003', 'approver_not_authorized',
  'T3: approver without shift.variance.approve -> approver_not_authorized (P0003)'
);

-- ===========================================================================
-- T4 — PIN au mauvais format -> invalid_pin, tentative NON consommée.
-- ===========================================================================
SELECT throws_ok(
  format(
    $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, 'large overage, event cash', NULL, %L::uuid, '12ab56')$$,
    current_setting('shift66.appr_prof')
  ),
  'P0003', 'invalid_pin',
  'T4: malformed PIN (not 6 digits) -> invalid_pin (P0003)'
);

SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('shift66.appr_prof')::uuid),
  0,
  'T4b: malformed PIN did NOT consume a failed attempt (format errors are not brute-force signals)'
);

-- ===========================================================================
-- T5 — PIN faux -> invalid_pin, tentative comptée (lockout S38).
-- ===========================================================================
SELECT throws_ok(
  format(
    $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, 'large overage, event cash', NULL, %L::uuid, '111111')$$,
    current_setting('shift66.appr_prof')
  ),
  'P0003', 'invalid_pin',
  'T5: wrong PIN -> invalid_pin (P0003)'
);

-- ⚠️ Comportement RÉEL ancré (FINDING F-1) : l'incrément du helper est annulé
-- par le RAISE 'invalid_pin' qui suit dans la même transaction. Si un futur
-- fix rend le comptage durable, cette assertion DOIT passer à 1.
SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('shift66.appr_prof')::uuid),
  0,
  'T5b (FINDING F-1): wrong-PIN increment rolled back with the raised exception (pre-existing S38 limitation)'
);

-- ===========================================================================
-- T6 — approbateur légitime + bon PIN -> clôture OK, trace posée, compteur
-- remis à zéro.
-- ===========================================================================
SELECT lives_ok(
  format(
    $$SELECT close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, 'large overage, event cash', NULL, %L::uuid, '654321')$$,
    current_setting('shift66.appr_prof')
  ),
  'T6: designated approver with correct PIN -> close succeeds'
);

SELECT is(
  (SELECT (status::text = 'closed' AND variance_approved_by = current_setting('shift66.appr_prof')::uuid)
     FROM pos_sessions WHERE id = '66c50001-0000-0000-0000-000000000001'),
  TRUE,
  'T6b: session closed with variance_approved_by = approver profile'
);

SELECT is(
  (SELECT failed_login_attempts FROM user_profiles WHERE id = current_setting('shift66.appr_prof')::uuid),
  0,
  'T6c: counter at 0 after successful PIN (reset path — trivially 0 while F-1 stands)'
);

-- ===========================================================================
-- T7 — replay sur la session fermée : sort AVANT les gardes (ni note ni PIN).
-- ===========================================================================
DO $t7$
DECLARE
  v_res JSONB;
  v_caught BOOLEAN := false;
BEGIN
  BEGIN
    v_res := close_shift_v8('66c50001-0000-0000-0000-000000000001'::uuid, 800000, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  PERFORM set_config('shift66.t7',
    (NOT v_caught AND v_res ->> 'idempotent_replay' = 'true' AND v_res ->> 'status' = 'closed')::text,
    false);
END $t7$;
SELECT ok(current_setting('shift66.t7')::boolean,
  'T7: replay on closed session -> idempotent_replay=true, guards bypassed');

SELECT * FROM finish();
ROLLBACK;
