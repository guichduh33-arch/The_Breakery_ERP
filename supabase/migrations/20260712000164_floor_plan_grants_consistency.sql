-- 20260712000164_floor_plan_grants_consistency.sql
-- S75 closeout — pattern-guardian findings #1/#2 on _161 (both MEDIUM,
-- belt-and-suspenders convention, no active hole):
-- 1. Re-assert the S20 default-privileges line the _161 REVOKE trio omitted
--    (present in every RPC-creating migration since S38).
-- 2. Explicit write REVOKE on table_sections for authenticated (RLS
--    default-deny already blocks writes; matches customer_product_prices /
--    pos_devices convention for RPC-only tables).

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

REVOKE INSERT, UPDATE, DELETE ON table_sections FROM authenticated;
