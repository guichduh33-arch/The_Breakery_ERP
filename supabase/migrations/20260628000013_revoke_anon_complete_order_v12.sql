-- 20260628000013_revoke_anon_complete_order_v12.sql
-- REVOKE pair canonique S25 (3 lignes distinctes — DEV-S43-P11-01).
GRANT EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION complete_order_with_payment_v12(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
