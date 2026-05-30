-- 20260530190903_revoke_pair_complete_order_v10.sql
-- REVOKE pair canonique S25 sur complete_order_with_payment_v10 (16 params).
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v10(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v10(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
