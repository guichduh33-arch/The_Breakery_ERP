-- Session 25 — Phase 1.A.1 — _012
-- Pattern S20 defense-in-depth : REVOKE FROM PUBLIC en plus de anon explicite.
-- Also re-asserts ALTER DEFAULT PRIVILEGES (idempotent, safe to re-run).

REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM anon;

-- Future-proof : default privileges (idempotent — ALTER DEFAULT PRIVILEGES is safe to re-run)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Defense-in-depth pour la table d'idempotency (déjà fait dans _010, explicit ici)
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
