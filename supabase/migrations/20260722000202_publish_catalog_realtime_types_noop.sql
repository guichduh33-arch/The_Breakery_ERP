-- ADR-011 décision 3 — publication Realtime du catalogue POS.
--
-- Ajoute products + categories à la publication supabase_realtime pour que
-- les changements catalogue faits en BO (désactivation, prix, visibilité POS,
-- variantes, catégories) se propagent en push < 2 s aux surfaces POS via
-- postgres_changes (hook useCatalogRealtime, miroir du pattern settings
-- 20260717000181). Les événements restent filtrés par les policies RLS
-- SELECT `auth_read` (authenticated) — une souscription anon ne reçoit rien.
--
-- [types-noop] : aucun changement de schéma, publication uniquement.

ALTER PUBLICATION supabase_realtime ADD TABLE public.products, public.categories;
