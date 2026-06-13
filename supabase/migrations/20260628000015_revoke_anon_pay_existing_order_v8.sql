-- 20260628000015_revoke_anon_pay_existing_order_v8.sql
-- REVOKE pair canonique S25 (3 lignes distinctes — DEV-S43-P11-01).
GRANT EXECUTE ON FUNCTION pay_existing_order_v8(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION pay_existing_order_v8(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION pay_existing_order_v8(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
