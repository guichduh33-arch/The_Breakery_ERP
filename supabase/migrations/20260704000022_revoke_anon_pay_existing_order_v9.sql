-- 20260704000022_revoke_anon_pay_existing_order_v9.sql
-- Session 47 — canonical REVOKE pair for pay_existing_order_v9.
REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v9(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v9(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
