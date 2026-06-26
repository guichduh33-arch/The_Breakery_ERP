-- 20260710000055_close_definer_view_mv_leaks.sql
-- Session 50 / W1.5 — Fermer les fuites DEFINER sur les vues et MVs.
--
-- Contexte :
--   Par défaut en Postgres, les vues héritent du rôle DEFINER (le créateur),
--   ce qui permet à un rôle authenticated de lire des colonnes que RLS bloquerait
--   sur la table cible si la vue est SECURITY DEFINER.
--   En Postgres 15+, ALTER VIEW ... SET (security_invoker = on) corrige cela
--   sans changer le schéma de la vue.
--
-- Vues traitées :
--   1. audit_log         (20260517000034) → security_invoker=on
--      AUCUN REVOKE : les RPCs hérités (audit_log_insert_trigger) écrivent via
--      l'INSTEAD-OF trigger. audit_log est accessible à authenticated pour lecture
--      (permissions), le RLS sur audit_logs contrôle déjà les lignes.
--
--   2. v_product_available_stock (20260517000132) → security_invoker=on
--      GRANT SELECT authenticated déjà en place, RLS sur products + stock_reservations
--      contrôle l'accès ; security_invoker transporte l'identité du caller.
--
--   3. view_product_allergens_resolved (20260519000162) → security_invoker=on
--      READ par POS et BO — REVOKE SELECT authenticated non-négociable.
--      security_invoker uniquement (pas de REVOKE).
--
-- Vues non traitées :
--   - view_b2b_invoices, view_ar_aging : gates futures via b2b.read ; ce ticket
--     ne les couvre pas (pas de call-site BO confirmé).
--
-- MVs (mv_sales_daily, mv_stock_variance, mv_pl_monthly) :
--   REVOKE SELECT TO authenticated + ne garder que service_role pour refresh CRON.
--   ⚠️  ESCALATION : aucun call-site BO/POS confirmé (grep retourne 0 résultats).
--                    Vérifier avant d'appliquer si un tableau de bord les lit.
--                    Si une query doit subsister, créer une RPC DEFINER dédiée.
--
-- Stockage (buckets) :
--   DEFERRED to V4: migrate ProductImageUploader to signed URLs before making
--   bucket private. ProductImageUploader.tsx:64 uses getPublicUrl() — a private
--   bucket would break product image display in BackOffice. Images are non-sensitive
--   (product photos). No SQL action here.
--
-- DEV-S50-W1.5

-- ============================================================
-- 1. Vues — security_invoker
-- ============================================================

ALTER VIEW public.audit_log
  SET (security_invoker = true);

COMMENT ON VIEW public.audit_log IS
  'Vue de compatibilité legacy sur audit_logs. S50 W1.5 : security_invoker=on '
  '(le RLS sur audit_logs filtre désormais par identité du caller, '
  'pas par le rôle postgres/definer créateur). INSTEAD-OF trigger préservé.';

ALTER VIEW public.v_product_available_stock
  SET (security_invoker = true);

COMMENT ON VIEW public.v_product_available_stock IS
  'Stock disponible = stock - réservations. S50 W1.5 : security_invoker=on '
  '(RLS sur products + stock_reservations contrôle les lignes du caller).';

ALTER VIEW public.view_product_allergens_resolved
  SET (security_invoker = true);

COMMENT ON VIEW public.view_product_allergens_resolved IS
  'Allergènes produits résolus (POS + BO). S50 W1.5 : security_invoker=on. '
  'GRANT SELECT authenticated maintenu — ne pas révoquer (call-sites POS actifs).';

-- ============================================================
-- 2. Vues B2B — annotation (pas encore gatées dans ce ticket)
-- ============================================================

-- ⚠️  view_b2b_invoices et view_ar_aging :
--    Gate b2b.read seedé en _053. L'application du gate RLS sur ces vues
--    est différée à une migration future une fois le BO câblé.
COMMENT ON VIEW public.view_b2b_invoices IS
  'Factures B2B en attente. FUTURE : gate b2b.read (permission seedée _053). '
  'Actuellement accessible à authenticated via GRANT (legacy — pas de RLS).';

COMMENT ON VIEW public.view_ar_aging IS
  'Aging AR B2B (30/60/90 jours). FUTURE : gate b2b.read. '
  'Même statut que view_b2b_invoices.';

-- ============================================================
-- 3. MVs — REVOKE SELECT FROM authenticated ET PUBLIC
-- Validé team-lead S50 : aucun call-site apps/ (grep .from('mv_') → 0 résultats),
-- pas de RPC FROM/JOIN sur ces MVs. Rafraîchissement cron uniquement → service_role
-- suffit. Accès futur via RPC DEFINER dédiée + permission gate.
-- ============================================================

REVOKE SELECT ON public.mv_sales_daily    FROM authenticated;
REVOKE SELECT ON public.mv_sales_daily    FROM PUBLIC;
REVOKE SELECT ON public.mv_stock_variance FROM authenticated;
REVOKE SELECT ON public.mv_stock_variance FROM PUBLIC;
REVOKE SELECT ON public.mv_pl_monthly     FROM authenticated;
REVOKE SELECT ON public.mv_pl_monthly     FROM PUBLIC;

COMMENT ON MATERIALIZED VIEW public.mv_sales_daily IS
  'Daily sales summary MV. S50 W1.5 : REVOKE SELECT FROM authenticated + PUBLIC '
  '(validé : aucun call-site BO/POS). Accès futur via RPC DEFINER + permission gate.';

COMMENT ON MATERIALIZED VIEW public.mv_stock_variance IS
  'Stock variance MV. S50 W1.5 : REVOKE SELECT FROM authenticated + PUBLIC. '
  'Même traitement que mv_sales_daily.';

COMMENT ON MATERIALIZED VIEW public.mv_pl_monthly IS
  'Monthly P&L MV. S50 W1.5 : REVOKE SELECT FROM authenticated + PUBLIC. '
  'Même traitement que mv_sales_daily.';
