-- 20260620000017_revoke_send_items_to_kitchen_anon.sql
-- F-008 — send_items_to_kitchen (migration 20260505000004, pre-S20) carried an
-- explicit `GRANT EXECUTE ... TO authenticated, anon`. The S20 global hardening
-- sweep (20260517223012/223119) already revoked anon EXECUTE on every public
-- function, so anon cannot call it on the live DB today (verified: anon=false).
--
-- This migration makes that intent EXPLICIT and LOCAL to the function — the
-- canonical S25 REVOKE pair — so the protection no longer depends solely on the
-- global sweep and survives any future re-grant. REVOKE FROM anon alone is
-- insufficient (anon inherits EXECUTE via PUBLIC membership, ACL `=X/postgres`);
-- the pair REVOKEs PUBLIC + anon and re-asserts the authenticated grant.
-- See CLAUDE.md Critical patterns (S20 / S25). Idempotent.
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
