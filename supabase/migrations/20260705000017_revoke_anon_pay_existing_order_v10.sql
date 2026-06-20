-- 20260705000017_revoke_anon_pay_existing_order_v10.sql
-- Phase 2 — canonical anon defense-in-depth REVOKE pair + GRANT to the roles
-- v9 carried (authenticated + service_role).

REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v10(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v10(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v10(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_existing_order_v10(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb
) TO service_role;
