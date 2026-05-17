-- 20260524000040_tighten_authenticated_select_policies.sql
-- Session 20 / Wave 3 — Permission-gate 5 operational SELECT policies that
-- currently use USING(true). The remaining 6 (display_screens, email_templates,
-- expense_categories, holidays, notification_templates, receipt_templates) are
-- intentionally readable by any authenticated user (printing receipts uses
-- receipt_templates; POS picks holidays; etc.). Documented as design intent.
--
-- DEVIATIONS from spec (all permission codes absent from public.permissions):
--   DEV-S20-3.A-01 : 'cashier.view' missing → using 'cash_register.read'
--   DEV-S20-3.A-02 : 'settings.view' missing → using 'settings.read'
--   DEV-S20-3.A-03 : 'orders.view' missing → using 'print_queue.read'
--   DEV-S20-3.A-04 : 'inventory.view' missing → using 'inventory.read'
--   DEV-S20-3.A-05 : 'pos.access' missing → not needed (fallback to cash_register.read covers cashier path)
--   lan_devices uses 'lan.devices.read' (more semantically precise than 'settings.read')

-- cash_movements : cashier reads own shift movements ; financial.read for admins
DROP POLICY IF EXISTS cash_movements_select_auth ON public.cash_movements;
CREATE POLICY cash_movements_select_auth
  ON public.cash_movements
  FOR SELECT
  TO authenticated
  USING (
    has_permission(auth.uid(), 'cash_register.read')
    OR has_permission(auth.uid(), 'reports.financial.read')
  );

-- lan_devices : device-management read (lan.devices.read is more precise than settings.read)
DROP POLICY IF EXISTS lan_devices_select_authenticated ON public.lan_devices;
CREATE POLICY lan_devices_select_authenticated
  ON public.lan_devices
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'lan.devices.read'));

-- notification_outbox : settings-level read (settings.read is the actual code present)
DROP POLICY IF EXISTS notification_outbox_select_authenticated ON public.notification_outbox;
CREATE POLICY notification_outbox_select_authenticated
  ON public.notification_outbox
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.read'));

-- print_queue : kiosk printers (kiosk-JWT) + print_queue.read for operators
DROP POLICY IF EXISTS print_queue_select_authenticated ON public.print_queue;
CREATE POLICY print_queue_select_authenticated
  ON public.print_queue
  FOR SELECT
  TO authenticated
  USING (
    has_kiosk_jwt()
    OR has_permission(auth.uid(), 'print_queue.read')
  );

-- stock_reservations : inventory.read (inventory.view absent; inventory.read is canonical)
DROP POLICY IF EXISTS stock_reservations_select_auth ON public.stock_reservations;
CREATE POLICY stock_reservations_select_auth
  ON public.stock_reservations
  FOR SELECT
  TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));
