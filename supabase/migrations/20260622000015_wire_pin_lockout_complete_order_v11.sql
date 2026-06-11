-- 20260622000015_wire_pin_lockout_complete_order_v11.sql
-- Session 38 / Wave A / Task A2 (SEC-06) — câble _verify_pin_with_lockout dans
-- complete_order_with_payment_v11 (PIN du manager nommé p_discount_authorized_by — gate discount S37).
-- Même pattern que 20260622000011. Le comptage per-user est correct ici : l'attaquant doit nommer
-- sa cible ; au pire un cashier malveillant inflige 15 min de lockout à un manager (audité,
-- déblocable via reset_user_pin_v1).

DO $$
DECLARE
  v_def TEXT;
BEGIN
  v_def := pg_get_functiondef(
    'public.complete_order_with_payment_v11(uuid,order_type,jsonb,jsonb,uuid,uuid,integer,text,numeric,text,numeric,text,uuid,numeric,jsonb,jsonb,text)'::regprocedure
  );
  IF position('_verify_pin_with_lockout(' in v_def) > 0 THEN
    RAISE NOTICE 'complete_order_with_payment_v11 already wired — no-op';
    RETURN;
  END IF;
  IF position('verify_user_pin(' in v_def) = 0 THEN
    RAISE EXCEPTION 'complete_order_with_payment_v11: verify_user_pin call not found — definition drifted, manual review required';
  END IF;
  v_def := replace(v_def, 'verify_user_pin(', '_verify_pin_with_lockout(');
  EXECUTE v_def;
END $$;
