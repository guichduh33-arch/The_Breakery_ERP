-- S1-08, paquet 1 — la vue confidentielle des tables passe du rôle à la permission (ADR-039).
--
-- Trois gestes, aucune fonction appelée par les écrans n'est renommée :
--   1. la permission `reports.statements.read` (états financiers) entre au
--      catalogue, donnée au seul rôle SUPER_ADMIN ;
--   2. deux fonctions d'aide neuves, `can_view_stock_v2()` et
--      `can_view_statements_v1()`, lisent une permission au lieu du rôle ;
--   3. les huit règles d'accès restrictives qui passaient par le test de rôle
--      lisent désormais une permission, ainsi que la règle permissive de
--      lecture des journaux.
--
-- Effet en production : aucun. Le rôle SUPER_ADMIN y détient
-- `reports.inventory.read`, `reports.audit.read` et la permission neuve ; aucun
-- autre rôle ni aucune dérogation individuelle ne détient l'une des trois
-- (relevé du 2026-11-17). La base dev diffère : ses rôles ADMIN et MANAGER
-- détiennent les deux premières, et y voient donc ces tables.
--
-- Chaque règle appelle sa fonction dans un `(SELECT …)` : PostgreSQL l'évalue
-- une seule fois par requête (InitPlan), jamais ligne par ligne. L'argument de
-- date des anciennes règles était ignoré par `can_view_business_day_v2`, qui ne
-- lisait que le rôle : le retirer ne change rien au résultat.
--
-- Restent volontairement en place : `can_view_stock_v1`,
-- `can_view_business_day_v2` et `assert_stock_owner_v1`, appelées par des
-- fonctions vivantes (dont la fonction de paiement). Elles suivront les paquets
-- suivants de S1-08.

INSERT INTO public.permissions(code,module,action,description)
VALUES('reports.statements.read','reports','statements.read',
  'View financial statements (balance sheet, P&L, cash flow, PB1, margin by product, general ledger, trial balance)')
ON CONFLICT(code) DO NOTHING;

INSERT INTO public.role_permissions(role_code,permission_code,is_granted)
VALUES('SUPER_ADMIN','reports.statements.read',true)
ON CONFLICT(role_code,permission_code) DO NOTHING;

CREATE FUNCTION public.can_view_stock_v2() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.has_permission(auth.uid(),'reports.inventory.read')
$$;
COMMENT ON FUNCTION public.can_view_stock_v2() IS
  'ADR-039 : vue du stock théorique, déléguée par reports.inventory.read.';

CREATE FUNCTION public.can_view_statements_v1() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND public.has_permission(auth.uid(),'reports.statements.read')
$$;
COMMENT ON FUNCTION public.can_view_statements_v1() IS
  'ADR-039 : vue des états financiers, déléguée par reports.statements.read.';

REVOKE ALL ON FUNCTION public.can_view_stock_v2() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.can_view_statements_v1() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_view_stock_v2() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.can_view_statements_v1() TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Stock : reports.inventory.read.
ALTER POLICY confidentiality_stock_movements ON public.stock_movements
  USING ((SELECT public.can_view_stock_v2()));
ALTER POLICY confidentiality_display_stock ON public.display_stock
  USING ((SELECT public.can_view_stock_v2()));
ALTER POLICY confidentiality_display_movements ON public.display_movements
  USING ((SELECT public.can_view_stock_v2()));
ALTER POLICY count_items_owner_only ON public.inventory_count_items
  USING ((SELECT public.can_view_stock_v2()));

-- Journaux : reports.audit.read, permission existante des rapports d'audit.
ALTER POLICY confidentiality_audit_logs ON public.audit_logs
  USING ((SELECT public.has_permission(auth.uid(),'reports.audit.read')));
ALTER POLICY confidentiality_pos_events ON public.pos_events
  USING ((SELECT public.has_permission(auth.uid(),'reports.audit.read')));
ALTER POLICY confidentiality_notifications ON public.notification_outbox
  USING ((SELECT public.has_permission(auth.uid(),'reports.audit.read')));
-- La règle permissive des journaux testait encore le rôle (SUPER_ADMIN ou ADMIN) :
-- sans elle, un délégué hors de ces deux rôles ne lirait rien. Le rôle ADMIN n'y
-- perd rien en production : la règle restrictive ci-dessus le bloquait déjà.
ALTER POLICY admin_read ON public.audit_logs
  USING ((SELECT public.has_permission(auth.uid(),'reports.audit.read')));

-- Rapports Z : états financiers.
ALTER POLICY confidentiality_zreports ON public.z_reports
  USING ((SELECT public.can_view_statements_v1()));
