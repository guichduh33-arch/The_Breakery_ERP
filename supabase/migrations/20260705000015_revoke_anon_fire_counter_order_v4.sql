-- 20260705000015_revoke_anon_fire_counter_order_v4.sql
-- Phase 2 — canonical anon defense-in-depth REVOKE pair + GRANT to the roles
-- v3 carried (authenticated + service_role; the POS fire hook calls it as authenticated).

REVOKE EXECUTE ON FUNCTION public.fire_counter_order_v4(
  uuid, uuid, jsonb, uuid, text, order_type, uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fire_counter_order_v4(
  uuid, uuid, jsonb, uuid, text, order_type, uuid
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v4(
  uuid, uuid, jsonb, uuid, text, order_type, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fire_counter_order_v4(
  uuid, uuid, jsonb, uuid, text, order_type, uuid
) TO service_role;
