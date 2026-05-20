-- Session 27 / Wave 1.A.4 — S25 canonical REVOKE pair for update_product_v1.

REVOKE EXECUTE ON FUNCTION update_product_v1(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION update_product_v1(UUID, JSONB) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION update_product_v1(UUID, JSONB) IS
  'Update product fields via JSONB patch (whitelist 18 cols). SECURITY DEFINER + perm products.update. '
  'REVOKE pair S25 canonical: anon explicit + PUBLIC + ALTER DEFAULT PRIVILEGES.';
