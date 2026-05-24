-- 20260606000016_revoke_pair_close_shift_v2.sql
-- S29 Wave 1.B.3 — REVOKE EXECUTE FROM PUBLIC + anon (S25 canonical REVOKE pair pattern).
-- Pairs with _015 which created close_shift_v2.

REVOKE EXECUTE ON FUNCTION close_shift_v2(uuid, numeric, text, uuid) FROM PUBLIC, anon;

-- Future-proof: ensure default privileges don't re-grant EXECUTE to PUBLIC
-- for functions created by postgres role going forward (S19 DEV pattern).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
