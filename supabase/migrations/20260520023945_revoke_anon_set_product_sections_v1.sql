-- Session 27 / Wave 1.A.4 — S25 canonical REVOKE pair for set_product_sections_v1.

REVOKE EXECUTE ON FUNCTION set_product_sections_v1(UUID, UUID[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION set_product_sections_v1(UUID, UUID[], UUID) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION set_product_sections_v1(UUID, UUID[], UUID) IS
  'M2M reconcile + primary guard for product sections. SECURITY DEFINER + perm products.sections.update. '
  'REVOKE pair S25 canonical.';
