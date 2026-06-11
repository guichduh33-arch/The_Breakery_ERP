-- 20260621000011_revoke_pair_complete_order_v11.sql
-- Session 37 / Wave A / Task A1 — REVOKE pair canonique S25 sur complete_order_with_payment_v11.
-- Caller : EF process-payment avec le JWT user (role authenticated) → GRANT authenticated conservé.

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v11(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v11(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb, text
) FROM anon;

GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v11(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, numeric, jsonb, jsonb, text
) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
