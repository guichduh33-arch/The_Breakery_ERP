-- 20260615000017_revoke_pair_get_stock_movements_v1.sql
-- S30 Wave 1.A.2 — REVOKE pair (S25 canonical pattern).
-- Covers both overloads of get_stock_movements_v1 (S30 6-arg + pre-existing 8-arg).
REVOKE EXECUTE ON FUNCTION get_stock_movements_v1(TEXT, TEXT, UUID, TEXT, INT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_stock_movements_v1(UUID, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, UUID, INT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
