-- S2-03 / S2-04 / S2-05 / S2-09 — retrait des objets abandonnés (décisions de Mamat).
--
--   S2-03  réservation de stock : table, vue de disponibilité, fonctions et tâche cron.
--   S2-04  planning de production hebdomadaire : table, triggers et fonctions.
--   S2-05  vues matérialisées mv_sales_daily / mv_pl_monthly, leurs fonctions de
--          rafraîchissement et leurs tâches cron. mv_stock_variance et
--          refresh_mv_stock_variance sont vivantes : on n'y touche pas.
--   S2-09  permissions sans objet : audit_log.read, users.view_audit,
--          settings.kiosk.manage (aucune policy ni fonction ne les cite).
--
-- Les valeurs reservation_hold / reservation_release de movement_type RESTENT :
-- stock_movements est un ledger append-only.
-- Les DROP FUNCTION n'ont volontairement pas de IF EXISTS : une signature fausse
-- doit faire échouer la migration. Aucun CASCADE : une dépendance inattendue
-- doit faire échouer la migration, pas disparaître en silence.

-- 1. Tâches pg_cron (absentes en production : conditionnel)
DO $$
DECLARE
  v_job text;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    FOREACH v_job IN ARRAY ARRAY[
      'release-expired-reservations',
      'refresh-mv-sales-daily',
      'refresh-mv-pl-monthly'
    ] LOOP
      IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job) THEN
        PERFORM cron.unschedule(v_job);
      END IF;
    END LOOP;
  END IF;
END $$;

-- 2. S2-03 — réservation de stock
DROP VIEW public.v_product_available_stock;

DROP FUNCTION public.reservation_hold_v3(uuid, numeric, text, timestamptz, uuid, uuid, text, uuid);
DROP FUNCTION stock_private.reservation_hold_v1(uuid, numeric, text, timestamptz, uuid, uuid, text, uuid);
DROP FUNCTION public.reservation_release_v1(uuid, text);
DROP FUNCTION public.reservation_consume_v1(uuid);
DROP FUNCTION public.release_expired_reservations();

DROP TABLE public.stock_reservations;

-- 3. S2-04 — planning de production hebdomadaire
DROP FUNCTION public.suggest_production_schedule_v3(date);

-- Les triggers production_schedules_lifecycle_guard / production_schedules_set_updated_at
-- partent avec la table ; la fonction de garde est retirée ensuite.
DROP TABLE public.production_schedules;
DROP FUNCTION public.enforce_production_schedule_lifecycle();

-- 4. S2-05 — vues matérialisées mortes
DROP MATERIALIZED VIEW public.mv_sales_daily;
DROP MATERIALIZED VIEW public.mv_pl_monthly;
DROP FUNCTION public.refresh_mv_sales_daily();
DROP FUNCTION public.refresh_mv_pl_monthly();

-- 5. S2-09 — permissions sans objet : attributions, overrides, puis catalogue
DELETE FROM public.role_permissions
 WHERE permission_code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage');

DELETE FROM public.user_permission_overrides
 WHERE permission_code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage');

DELETE FROM public.permissions
 WHERE code IN ('audit_log.read', 'users.view_audit', 'settings.kiosk.manage');
