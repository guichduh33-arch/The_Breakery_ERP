-- supabase/tests/s2_retired_objects.test.sql
-- S2-03 / S2-04 / S2-05 / S2-09 — les objets abandonnés n'existent plus.
--
--   S2-03  réservation de stock (table, vue, fonctions, tâche cron)
--   S2-04  planning de production hebdomadaire (table, fonctions)
--   S2-05  vues matérialisées mv_sales_daily / mv_pl_monthly (+ rafraîchissements)
--   S2-09  permissions audit_log.read, users.view_audit, settings.kiosk.manage
--
-- Garde aussi ce qui doit survivre : mv_stock_variance et son rafraîchissement,
-- et les valeurs reservation_hold / reservation_release de movement_type
-- (stock_movements est un ledger append-only).
--
-- Exécution : MCP execute_sql enveloppé dans BEGIN/ROLLBACK, aucune écriture conservée.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;
SELECT plan(18);

-- Helper tolérant : pg_cron peut être absent d'une cible.
CREATE FUNCTION pg_temp.s2_cron_leftovers() RETURNS int
LANGUAGE plpgsql AS $f$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN 0;
  END IF;
  RETURN (SELECT count(*)::int FROM cron.job
           WHERE jobname IN ('release-expired-reservations',
                             'refresh-mv-sales-daily',
                             'refresh-mv-pl-monthly'));
END $f$;

-- ============================================================
-- Tables, vue, vues matérialisées
-- ============================================================
SELECT hasnt_table('public', 'stock_reservations', 'S2-03 — stock_reservations retirée');
SELECT hasnt_table('public', 'production_schedules', 'S2-04 — production_schedules retirée');
SELECT hasnt_view('public', 'v_product_available_stock', 'S2-03 — v_product_available_stock retirée');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_sales_daily'),
  'S2-05 — mv_sales_daily retirée'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_pl_monthly'),
  'S2-05 — mv_pl_monthly retirée'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname = 'public' AND matviewname = 'mv_stock_variance'),
  'conservée — mv_stock_variance existe toujours'
);

-- ============================================================
-- Fonctions (toutes signatures confondues, schémas public et stock_private)
-- ============================================================
SELECT ok(
  EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'refresh_mv_stock_variance'),
  'conservée — refresh_mv_stock_variance existe toujours'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'stock_private')
      AND p.proname IN ('reservation_hold_v1', 'reservation_hold_v2', 'reservation_hold_v3',
                        'reservation_release_v1', 'reservation_consume_v1',
                        'release_expired_reservations')),
  0,
  'S2-03 — aucune fonction de réservation'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'stock_private')
      AND p.proname IN ('suggest_production_schedule_v1', 'suggest_production_schedule_v2',
                        'suggest_production_schedule_v3', 'enforce_production_schedule_lifecycle')),
  0,
  'S2-04 — aucune fonction de planning de production'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('refresh_mv_sales_daily', 'refresh_mv_pl_monthly')),
  0,
  'S2-05 — aucune fonction de rafraîchissement des vues retirées'
);
SELECT is(pg_temp.s2_cron_leftovers(), 0, 'S2-03/S2-05 — aucune tâche cron des objets retirés');

-- ============================================================
-- Permissions
-- ============================================================
SELECT is(
  (SELECT count(*)::int FROM public.permissions
    WHERE code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage')),
  0,
  'S2-09 — les 3 permissions sont absentes du catalogue'
);
SELECT is(
  (SELECT count(*)::int FROM public.role_permissions
    WHERE permission_code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage')),
  0,
  'S2-09 — aucune attribution de rôle restante'
);
SELECT is(
  (SELECT count(*)::int FROM public.user_permission_overrides
    WHERE permission_code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage')),
  0,
  'S2-09 — aucun override utilisateur restant'
);
SELECT is(
  (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
      AND p.prosrc ~ '(audit_log\.read|users\.view_audit|settings\.kiosk\.manage)'),
  0,
  'S2-09 — aucune fonction ne cite les 3 permissions'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
          ~ '(audit_log\.read|users\.view_audit|settings\.kiosk\.manage)'),
  0,
  'S2-09 — aucune policy ne cite les 3 permissions'
);

-- ============================================================
-- Valeurs d'énumération conservées (ledger append-only)
-- ============================================================
SELECT ok(
  'reservation_hold'::text = ANY (ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.movement_type)) e)),
  'conservée — movement_type garde reservation_hold'
);
SELECT ok(
  'reservation_release'::text = ANY (ARRAY(SELECT e::text FROM unnest(enum_range(NULL::public.movement_type)) e)),
  'conservée — movement_type garde reservation_release'
);

SELECT * FROM finish();
ROLLBACK;
