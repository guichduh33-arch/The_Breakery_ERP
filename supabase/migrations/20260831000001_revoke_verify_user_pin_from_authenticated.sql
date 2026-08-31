-- P0 relevé par l'audit du 2026-08-31 (lot 1, skill security-fraud-guard).
--
-- `verify_user_pin` compare un PIN bcrypt SANS verrouillage, SANS rate-limit et SANS
-- ligne d'audit. Elle restait pourtant exécutable par `authenticated` : un oracle de
-- brute-force appelable en direct via PostgREST, sur un secret de 6 chiffres, avec
-- l'uuid de la cible lisible dans `orders.discount_authorized_by` / `orders.voided_by`.
--
-- Le grant est purement RÉSIDUEL. Vérifié le 2026-08-31 sur V3 dev :
--   · aucune fonction du schéma `public` ne l'appelle (balayage `pg_get_functiondef`) ;
--   · les trois seuls appelants applicatifs passent par un client service_role —
--     supabase/functions/_shared/manager-pin.ts, auth-verify-pin/, auth-change-pin/.
-- `service_role` n'est pas visé par ce REVOKE : ces trois chemins continuent de marcher.
--
-- La faille n°7 du 2026-05-31 avait été fermée côté APPELANTS (introduction de
-- `_verify_pin_with_lockout`) mais jamais côté GRANT. Ceci ferme le second volet.
--
-- Defense-in-depth : `REVOKE ... FROM anon` seul est insuffisant, anon hérite EXECUTE
-- via PUBLIC — d'où la révocation explicite de PUBLIC.

REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, text) FROM PUBLIC;

COMMENT ON FUNCTION public.verify_user_pin(uuid, text) IS
  'service_role only. No lockout, no rate-limit, no audit row: never grant to authenticated or anon. Application callers must use _verify_pin_with_lockout instead.';
