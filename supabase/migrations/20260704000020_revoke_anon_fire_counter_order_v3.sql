-- 20260704000020_revoke_anon_fire_counter_order_v3.sql
-- Session 47 — canonical REVOKE pair for fire_counter_order_v3.
REVOKE EXECUTE ON FUNCTION public.fire_counter_order_v3(uuid, uuid, jsonb, uuid, text, order_type, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fire_counter_order_v3(uuid, uuid, jsonb, uuid, text, order_type, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
