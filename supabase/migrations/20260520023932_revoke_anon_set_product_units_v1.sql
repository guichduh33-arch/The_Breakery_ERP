-- Session 27 / Wave 1.A.4 — S25 canonical REVOKE pair for set_product_units_v1.

REVOKE EXECUTE ON FUNCTION set_product_units_v1(UUID, JSONB, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION set_product_units_v1(UUID, JSONB, JSONB) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION set_product_units_v1(UUID, JSONB, JSONB) IS
  'REPLACE alts + UPSERT contexts for a product. SECURITY DEFINER + perm products.units.update. '
  'REVOKE pair S25 canonical.';
