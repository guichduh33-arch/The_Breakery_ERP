-- 20261111000004_reporting_owner_check_once.sql
-- Lenteur des rapports pour le propriétaire : le contrôle de visibilité des
-- ventes tournait UNE FOIS PAR COMMANDE.
--
-- Mesure en production, lecture seule, 2026-11-11, compte propriétaire :
--   * une lecture complète de reporting_private.closed_pos_orders_v1 (5 290
--     commandes) : 1,2 s, soit un appel de can_view_sales_day_v1 par ligne
--     (fonction SQL SECURITY DEFINER avec search_path : non inlinée) ;
--   * la même lecture avec le test propriétaire évalué une seule fois : 3 ms ;
--   * get_production_vs_sales relit cette vue plusieurs fois, dont une fois par
--     commande dans son NOT EXISTS : 23 à 42 s pour 7 jours, au-delà de la
--     limite de 8 s du rôle authenticated.
--
-- Correctif : la vue teste d'abord `(SELECT public.is_business_owner_v1())`.
-- La sous-requête ne dépend d'aucune ligne : Postgres l'évalue UNE fois par
-- requête (InitPlan). Pour le propriétaire le OR s'arrête là et
-- can_view_sales_day_v1 n'est plus appelée.
--
-- Équivalence stricte : can_view_sales_day_v1 rend déjà vrai pour le
-- propriétaire (`auth.uid() IS NOT NULL AND (is_business_owner_v1() OR …)`),
-- et is_business_owner_v1 est faux sans session. L'ensemble des lignes
-- visibles ne change pour AUCUN compte ; seul le coût change. Un compte non
-- propriétaire garde le contrôle par ligne.
--
-- Mêmes colonnes, même ordre : CREATE OR REPLACE conserve les droits de la vue
-- (aucun pour PUBLIC, anon, authenticated) et ses dépendants
-- (closed_order_items_v1, recognized_sales_v2).

CREATE OR REPLACE VIEW reporting_private.closed_pos_orders_v1 AS
 SELECT * FROM public.orders o WHERE o.order_type='b2b'
 OR (SELECT public.is_business_owner_v1())
 OR public.can_view_sales_day_v1(coalesce(o.outstanding_at,o.paid_at,o.created_at)::date);

REVOKE ALL ON reporting_private.closed_pos_orders_v1 FROM PUBLIC,anon,authenticated;
