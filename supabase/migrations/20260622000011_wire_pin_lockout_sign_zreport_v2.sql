-- 20260622000011_wire_pin_lockout_sign_zreport_v2.sql
-- Session 38 / Wave A / Task A2 (SEC-06) — câble _verify_pin_with_lockout dans sign_zreport_v2.
--
-- Pattern : on réécrit la définition COURANTE (pg_get_functiondef) en remplaçant l'appel
-- verify_user_pin( par _verify_pin_with_lockout( — signature STRICTEMENT inchangée (pas de bump,
-- précédent : corrective 20260519235821 S25). Le helper compte les échecs (audit pin.failed /
-- pin.locked) et raise P0004 account_locked après 5 échecs / 15 min. Le RAISE 'invalid_pin'
-- P0003 existant du RPC est conservé (le helper retourne false sur PIN faux après comptage).
-- Les privilèges EXECUTE existants sont préservés par CREATE OR REPLACE.

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.sign_zreport_v2(uuid,text)'::regprocedure);
  IF position('_verify_pin_with_lockout(' in v_def) > 0 THEN
    RAISE NOTICE 'sign_zreport_v2 already wired — no-op';
    RETURN;
  END IF;
  IF position('verify_user_pin(' in v_def) = 0 THEN
    RAISE EXCEPTION 'sign_zreport_v2: verify_user_pin call not found — definition drifted, manual review required';
  END IF;
  v_def := replace(v_def, 'verify_user_pin(', '_verify_pin_with_lockout(');
  EXECUTE v_def;
END $$;
