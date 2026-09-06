-- Audit lot 1, P1 sécurité n°5 — gates fail-open : fermer le grant résiduel.
--
-- `enqueue_notification_v2` porte `IF auth.uid() IS NOT NULL AND NOT has_permission(...)`.
-- Un jeton PIN sans sujet (P1 n°6) rend `auth.uid()` NULL et emprunte la branche
-- fail-open. Le grant à `authenticated` est RÉSIDUEL : aucun appelant applicatif
-- (relevé sur apps/ et packages/ le 2026-09-06) — le seul appelant vivant est
-- l'EF `customer-birthday-notify`, qui utilise un client service_role, plus la
-- RPC `notify_birthday_customers_v2` (elle-même service_role only).
--
-- On ferme la porte plutôt que de mieux la garder : même geste que le P0 n°1
-- (`verify_user_pin`, 2026-08-31).

REVOKE EXECUTE ON FUNCTION public.enqueue_notification_v2(
  TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.enqueue_notification_v2(
  TEXT, TEXT, JSONB, TEXT, TIMESTAMPTZ, UUID
) IS 'Machine-only depuis 2026-09-06 : service_role uniquement (EF customer-birthday-notify, notify_birthday_customers_v2). Le gate has_permission interne est fail-open sur acteur NULL — c est l ACL qui verrouille, pas le corps. Ne pas re-grant a authenticated sans inverser le gate en fail-closed.';
