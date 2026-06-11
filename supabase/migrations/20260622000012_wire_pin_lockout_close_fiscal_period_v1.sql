-- 20260622000012_wire_pin_lockout_close_fiscal_period_v1.sql
-- Session 38 / Wave A / Task A2 (SEC-06) — câble _verify_pin_with_lockout dans close_fiscal_period_v1.
-- Même pattern que 20260622000011 (voir ce fichier pour le contexte complet).

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef('public.close_fiscal_period_v1(uuid,text,boolean)'::regprocedure);
  IF position('_verify_pin_with_lockout(' in v_def) > 0 THEN
    RAISE NOTICE 'close_fiscal_period_v1 already wired — no-op';
    RETURN;
  END IF;
  IF position('verify_user_pin(' in v_def) = 0 THEN
    RAISE EXCEPTION 'close_fiscal_period_v1: verify_user_pin call not found — definition drifted, manual review required';
  END IF;
  v_def := replace(v_def, 'verify_user_pin(', '_verify_pin_with_lockout(');
  EXECUTE v_def;
END $$;
