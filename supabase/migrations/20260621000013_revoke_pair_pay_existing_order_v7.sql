-- 20260621000013_revoke_pair_pay_existing_order_v7.sql
-- Session 37 / Wave A / Task A2 — REVOKE pair canonique S25 sur pay_existing_order_v7.
-- Caller : le POS appelle directement supabase.rpc → GRANT authenticated.

REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v7(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.pay_existing_order_v7(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb
) FROM anon;

GRANT EXECUTE ON FUNCTION public.pay_existing_order_v7(
  uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb
) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
