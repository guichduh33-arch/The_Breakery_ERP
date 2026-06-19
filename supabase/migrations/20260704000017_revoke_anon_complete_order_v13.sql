-- 20260704000017_revoke_anon_complete_order_v13.sql
-- Session 47 / Wave A — canonical REVOKE pair for complete_order_with_payment_v13.

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v13(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v13(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
