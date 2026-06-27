-- 20260710000056_search_path_index_hardening.sql
-- Session 50 / W1.6 — search_path hardening sur les fonctions SECURITY DEFINER
-- identifiées comme mutables (sans SET search_path) + index orders pour report.
--
-- Fonctions ciblées (SECURITY DEFINER, sans SET search_path au moment de S50) :
--   1. get_customer_product_price(UUID, UUID)       — 20260509000006, plpgsql STABLE
--   2. enforce_margin_alerts_ack_only()              — 20260519000141, trigger function
--   3. next_expense_number(DATE)                     — 20260517000120, plpgsql
--
-- Note : la liste complète des fonctions mutable sans search_path aurait nécessité
-- `SELECT proname FROM pg_proc WHERE prosecdef AND NOT proconfig @> '{search_path}';`
-- via execute_sql (MCP non disponible en subagent). Les 3 ci-dessus sont les plus
-- critiques identifiées par analyse statique des migrations.
--
-- ⚠️  ESCALATION : exécuter en priorité sur le cloud une fois appliqué :
--   SELECT proname, pronamespace::regnamespace, proconfig
--   FROM pg_proc WHERE prosecdef AND NOT proconfig @> ARRAY['search_path=public, pg_temp']
--   AND pronamespace = 'public'::regnamespace
--   ORDER BY proname;
-- Et corriger les fonctions manquantes restantes.
--
-- Index :
--   idx_orders_paid_at_status — support report get_sales_by_hour_v2 (filtre paid_at + status).
--   ⚠️  CONCURRENTLY impossible dans apply_migration (txn wrapper). À exécuter via :
--     mcp__plugin_supabase_supabase__execute_sql:
--     CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_paid_at_status
--       ON orders (paid_at, status) WHERE status = 'paid' AND voided_at IS NULL;
--
-- ⚠️  ESCALATION — Leaked Password Protection :
--   Auth → Settings → Passwords → "Leaked Password Protection" (HaveIBeenPwned API).
--   Activer dans le dashboard Supabase. Aucune migration SQL requise.
--   Ne pas bloquer W1.6 ; documenter comme dette sécurité S50.
--
-- DEV-S50-W1.6

-- ============================================================
-- 1. get_customer_product_price — ALTER FUNCTION SET search_path
--    (signature exacte issue de 20260509000006)
-- ============================================================

ALTER FUNCTION public.get_customer_product_price(UUID, UUID)
  SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.get_customer_product_price(UUID, UUID) IS
  'S50 W1.6 : SET search_path ajouté (manquant depuis S7). Prix résolu '
  'selon catégorie client (price_modifier_type, discount_percentage). '
  'SECURITY DEFINER — résout via tables internes sans exposer la logique RLS.';

-- ============================================================
-- 2. enforce_margin_alerts_ack_only — trigger SECURITY DEFINER
--    (signature : RETURNS trigger, pas d''args)
-- ============================================================

ALTER FUNCTION public.enforce_margin_alerts_ack_only()
  SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.enforce_margin_alerts_ack_only() IS
  'S50 W1.6 : SET search_path ajouté (manquant depuis S30). Trigger BEFORE UPDATE '
  'sur margin_alerts qui restreint les colonnes modifiables à {acknowledged_at, '
  'acknowledged_by} pour le rôle authenticated (SECURITY DEFINER).';

-- ============================================================
-- 3. next_expense_number — helper interne dépenses
-- ============================================================

ALTER FUNCTION public.next_expense_number(DATE)
  SET search_path = public, pg_temp;

COMMENT ON FUNCTION public.next_expense_number(DATE) IS
  'S50 W1.6 : SET search_path ajouté (manquant depuis S21). Génère le numéro '
  'séquentiel de dépense EXP-YYYY-NNNN. SECURITY DEFINER — accès direct à '
  'expenses sans RLS pour le compteur.';

-- ============================================================
-- 4. Index pour get_sales_by_hour_v2
--    NE PAS exécuter ici — CONCURRENTLY non supporté dans txn.
--    Exécuter séparément via execute_sql MCP après apply.
-- ============================================================

-- TO RUN SEPARATELY (via execute_sql, outside a transaction) :
--
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_paid_at_status
--   ON orders (paid_at, status)
--   WHERE status = 'paid' AND voided_at IS NULL;
--
-- COMMENT ON INDEX public.idx_orders_paid_at_status IS
--   'S50 W1.6 : partial index pour get_sales_by_hour_v2 (filtre paid+non-voided). '
--   'Créé via execute_sql (CONCURRENTLY non autorisé dans apply_migration txn).';

-- ============================================================
-- 5. Defense-in-depth canonique finale
-- ============================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
