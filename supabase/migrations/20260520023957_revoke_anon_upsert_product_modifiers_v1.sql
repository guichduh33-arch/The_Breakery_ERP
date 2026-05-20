-- Session 27 / Wave 1.A.4 — S25 canonical REVOKE pair for upsert_product_modifiers_v1.

REVOKE EXECUTE ON FUNCTION upsert_product_modifiers_v1(UUID, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_product_modifiers_v1(UUID, JSONB) FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION upsert_product_modifiers_v1(UUID, JSONB) IS
  'Clean-slate UPSERT product modifiers with soft-delete-then-revive pattern. '
  'SECURITY DEFINER + perm products.modifiers.update. REVOKE pair S25 canonical.';
