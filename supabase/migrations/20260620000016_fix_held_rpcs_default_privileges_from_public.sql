-- Session 35 — F-003 corrective (pattern-guardian P11).
-- The REVOKE pairs in _012/_013/_014 ran `ALTER DEFAULT PRIVILEGES ... REVOKE
-- EXECUTE ON FUNCTIONS FROM anon` (mirroring the older S25 tablet migration), but
-- the canonical S20 defense-in-depth template cuts the PUBLIC inheritance pipeline
-- via FROM PUBLIC (anon inherits EXECUTE through PUBLIC membership). The 3
-- held-order RPCs are already fully protected by their explicit per-function
-- REVOKE EXECUTE ... FROM PUBLIC + FROM anon; this fixes the default-privileges
-- future-proofing to the canonical form. Idempotent.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
