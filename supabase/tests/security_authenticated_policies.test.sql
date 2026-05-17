-- S20 Wave 3 — tightened authenticated SELECT policies regression suite.
-- All spec permission codes (cashier.view, settings.view, orders.view, inventory.view, pos.access)
-- were absent from public.permissions; actual codes used are documented in
-- DEV-S20-3.A-01..05 deviations in the migration header.
BEGIN;

SELECT plan(5);

-- A1 : cash_movements policy uses cash_register.read OR reports.financial.read
--      (spec: cashier.view OR reports.financial.read — DEV-S20-3.A-01)
SELECT ok(
  (SELECT (qual ILIKE '%has_permission%cash_register.read%'
           OR qual ILIKE '%has_permission%cashier.view%'
           OR qual ILIKE '%has_permission%pos.access%')
      AND qual ILIKE '%has_permission%reports.financial.read%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='cash_movements'
      AND policyname='cash_movements_select_auth'),
  'cash_movements_select_auth is permission-gated (cash_register.read OR reports.financial.read)'
);

-- A2 : lan_devices uses lan.devices.read (spec: settings.view — DEV-S20-3.A-02; lan.devices.read preferred)
SELECT ok(
  (SELECT qual ILIKE '%has_permission%lan.devices.read%'
           OR qual ILIKE '%has_permission%settings.view%'
           OR qual ILIKE '%has_permission%settings.read%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='lan_devices'
      AND policyname='lan_devices_select_authenticated'),
  'lan_devices_select_authenticated is permission-gated'
);

-- A3 : notification_outbox uses settings.read (spec: settings.view — DEV-S20-3.A-02)
SELECT ok(
  (SELECT qual ILIKE '%has_permission%settings.read%'
           OR qual ILIKE '%has_permission%settings.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='notification_outbox'
      AND policyname='notification_outbox_select_authenticated'),
  'notification_outbox_select_authenticated is permission-gated'
);

-- A4 : print_queue allows kiosk-JWT OR print_queue.read (spec: has_kiosk_jwt OR orders.view — DEV-S20-3.A-03)
SELECT ok(
  (SELECT qual ILIKE '%has_kiosk_jwt%'
       AND (qual ILIKE '%has_permission%print_queue.read%'
            OR qual ILIKE '%has_permission%orders.view%')
     FROM pg_policies
    WHERE schemaname='public' AND tablename='print_queue'
      AND policyname='print_queue_select_authenticated'),
  'print_queue_select_authenticated allows kiosk-JWT OR print_queue.read'
);

-- A5 : stock_reservations uses inventory.read (spec: inventory.view — DEV-S20-3.A-04)
SELECT ok(
  (SELECT qual ILIKE '%has_permission%inventory.read%'
           OR qual ILIKE '%has_permission%inventory.view%'
     FROM pg_policies
    WHERE schemaname='public' AND tablename='stock_reservations'
      AND policyname='stock_reservations_select_auth'),
  'stock_reservations_select_auth is permission-gated (inventory.read)'
);

SELECT * FROM finish();
ROLLBACK;
