-- 20260705000013_revoke_anon_complete_order_v14.sql
-- Phase 2 — canonical anon defense-in-depth REVOKE pair + GRANT to the roles
-- v13 carried (authenticated + service_role). EF process-payment calls this via
-- the user's JWT (authenticated).

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) TO service_role;
