-- Session 27c / Wave 2 — Canonical REVOKE pair (S20 pattern).

REVOKE EXECUTE ON FUNCTION convert_product_to_parent_v1(UUID, TEXT, variant_axis_type, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION convert_product_to_parent_v1(UUID, TEXT, variant_axis_type, TEXT) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
