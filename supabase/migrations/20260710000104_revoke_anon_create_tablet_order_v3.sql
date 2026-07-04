-- Session 59 — Task 5 (17 D1.1) — _104
-- Mirror of 20260602000012_revoke_anon_create_tablet_order_v2.sql for v3.
-- S20 defense-in-depth trio : REVOKE FROM PUBLIC + REVOKE FROM anon explicit,
-- in addition to the inline REVOKE already issued in _103 (belt-and-braces,
-- matches the historical two-migration pattern for this RPC).

REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v3(uuid, uuid, text, order_type, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_tablet_order_v3(uuid, uuid, text, order_type, jsonb, text) FROM anon;

-- Future-proof : default privileges (idempotent — ALTER DEFAULT PRIVILEGES is safe to re-run)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Defense-in-depth pour la table d'idempotency (déjà fait dans _000010/_000012, re-assert ici).
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
