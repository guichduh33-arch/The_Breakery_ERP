-- Audit POS Waiter du 2026-08-22, lot C (a) — la politique qui mentait. [types-noop]
--
-- Le constat : `orders` portait DEUX politiques SELECT, toutes deux
-- PERMISSIVES. Les politiques permissives se combinent par OU. La première,
-- `auth_read` (`is_authenticated() OR has_kiosk_jwt(NULL)`), accorde déjà la
-- lecture de toute la table à tout compte authentifié. La seconde,
-- `tablet_waiter_own_pending`, ne pouvait donc RIEN restreindre — elle
-- n'élargissait rien non plus, puisque son prédicat est un sous-ensemble du
-- premier. Elle ne faisait qu'une chose : laisser croire, à qui lit le schéma,
-- qu'une serveuse est cloisonnée à ses propres commandes. Elle ne l'est pas, et
-- ne l'a jamais été depuis `20260507000007_tablet_rls.sql`.
--
-- Arbitrage du propriétaire (2026-08-22, décision 2 du rapport d'audit) :
-- version ALLÉGÉE. Chaque serveur peut ouvrir toutes les commandes. Le
-- cloisonnement n'est pas un besoin métier — un serveur reprend couramment la
-- table d'un collègue en fin de service — et la version stricte aurait privé le
-- plan de salle de l'occupation des tables tenues par les autres, ce qui aurait
-- fait asseoir des clients sur une table déjà occupée.
--
-- On retire donc la politique décorative plutôt que de la durcir, et on écrit
-- la règle réelle à l'endroit où elle s'applique. Une politique qui ne fait
-- rien coûte plus qu'elle ne rapporte : elle fait conclure à tort qu'un
-- cloisonnement existe, et le prochain audit repart de cette illusion.
--
-- Ce qui NE change pas :
--  * l'onglet « My Orders » de la tablette continue de filtrer côté client
--    (`useMyTabletOrders`) — c'est un confort d'affichage, pas une frontière de
--    sécurité, et ce commentaire est le seul endroit qui le dit ;
--  * les ÉCRITURES restent verrouillées : aucune politique INSERT/UPDATE/DELETE
--    sur `orders` ni `order_items`, tout passe par les RPC SECURITY DEFINER ;
--  * l'identité du serveur reste vérifiée à l'écriture par
--    `create_tablet_order_v8` (migration 20260822000002).
--
-- Aucun changement de schéma ni de signature : les types n'ont pas à être
-- régénérés.

DROP POLICY IF EXISTS "tablet_waiter_own_pending" ON public.orders;

COMMENT ON POLICY "auth_read" ON public.orders IS
  'Lecture LARGE et DÉLIBÉRÉE (arbitrage propriétaire 2026-08-22, audit POS waiter lot C) : tout compte authentifié lit TOUTES les commandes, serveurs de salle compris. Le plan de salle en dépend — l''occupation des tables se dérive de commandes tenues par d''autres. Le filtre « mes commandes » de la tablette est côté client, ce n''est pas une frontière de sécurité. Les écritures, elles, ne passent que par les RPC SECURITY DEFINER.';
