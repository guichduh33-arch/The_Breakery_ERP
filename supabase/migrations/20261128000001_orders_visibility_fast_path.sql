-- Lecture des commandes en attente sur la caisse : la policy restrictive
-- confidentiality_finished_orders appelait can_view_order_v2(id) sur CHAQUE ligne
-- de public.orders, avant le filtre de la requête (l'égalité sur l'enum
-- order_status n'est pas leakproof, donc PostgreSQL ne la descend pas sous la
-- barrière RLS). Relevé de production du 2026-11-28 : ~0,9 ms par ligne, 6,6 s
-- pour 7 209 commandes ; la liste des commandes en attente durait 4,1 s en moyenne
-- et dépassait le statement_timeout de 8 s une fois sur deux.
--
-- Correctif : la décision de visibilité ne change pas. La policy garde
-- can_view_order_v2(id) en dernier recours, et la fait précéder de conditions
-- SUFFISANTES de cette même fonction, évaluées sur les colonnes de la ligne et sur
-- des valeurs calculées une fois par requête (sous-requêtes scalaires = InitPlan).
-- Chaque condition rapide implique can_view_order_v2(id) ; la policy obtenue lui est
-- donc équivalente, ligne pour ligne. Seules les lignes qu'aucune condition rapide
-- n'accepte paient encore l'appel complet : les commandes réglées des journées dont
-- un shift reste ouvert.

-- Borne de can_view_sales_day_v1 pour un non-propriétaire, calculée une fois :
-- can_view_sales_day_v1(d) est vrai, hors propriétaire, ssi d < cette borne.
--   * NOT EXISTS(shift ouvert avec opened_at::date <= d)  ⟺ d < min(opened_at::date)
--     des shifts ouverts (même WHERE), +infini sans shift ouvert ;
--   * d <= current_date ET (d < current_date OU un shift clos couvre current_date)
--     ⟺ d < current_date + (1 si ce shift clos existe, sinon 0).
-- Pour le propriétaire, can_view_sales_day_v1 est toujours vrai : la borne reste
-- une condition suffisante. Un d NULL donne NULL, donc non visible, comme l'original.
CREATE FUNCTION public.sales_day_visible_before_v1()
 RETURNS date
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT LEAST(
  coalesce((SELECT min(s.opened_at::date) FROM public.pos_sessions s
    WHERE s.status<>'closed' OR s.closed_at IS NULL), 'infinity'::date),
  current_date + CASE WHEN EXISTS(SELECT 1 FROM public.pos_sessions s
    WHERE s.status='closed' AND s.closed_at IS NOT NULL
     AND s.opened_at::date<=current_date AND s.closed_at::date>=current_date)
   THEN 1 ELSE 0 END)
$function$;

COMMENT ON FUNCTION public.sales_day_visible_before_v1() IS
 'Borne exclusive des journées de vente visibles hors propriétaire : can_view_sales_day_v1(d) ⟺ d < borne. Évaluée une fois par requête dans la policy confidentiality_finished_orders.';

REVOKE EXECUTE ON FUNCTION public.sales_day_visible_before_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_day_visible_before_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_day_visible_before_v1() TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Conditions rapides, dans l'ordre d'évaluation (un OR s'évalue de gauche à droite
-- et s'arrête au premier vrai) ; chacune reprend une branche de can_view_order_v2 :
--   propriétaire ; commande B2B ; brouillon ou en attente hors rôle ADMIN ;
--   journée de vente déjà publiée ; sinon l'appel complet.
ALTER POLICY confidentiality_finished_orders ON public.orders USING (
 (SELECT auth.uid()) IS NOT NULL AND (
  (SELECT public.is_business_owner_v1())
  OR order_type='b2b'
  OR (status::text IN('draft','pending_payment','b2b_pending')
      AND (SELECT public.get_current_role())<>'ADMIN')
  OR coalesce(outstanding_at,paid_at,created_at)::date < (SELECT public.sales_day_visible_before_v1())
  OR public.can_view_order_v2(id)
 )
);
