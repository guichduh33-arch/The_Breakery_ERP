-- supabase/tests/seed_dev_printers.sql
-- DEV FIXTURE ONLY — run via MCP execute_sql against V3 dev (ikcyvlovptebroadgtvd).
-- NOT a migration, NOT for prod (prod IPs are site-specific — see ops runbook in
-- docs/reference/05-integrations/06-print-server.md).
-- Seeds 5 lan_devices printer rows so useStationPrinters resolves a 5-entry Map
-- without physical hardware. ip_address is INET (valid IP literals required).

INSERT INTO lan_devices (code, name, device_type, ip_address, port, is_active, capabilities)
VALUES
  ('DEV-PRINTER-BARISTA', 'Barista printer (dev)', 'printer', '192.168.99.11'::inet, 9100, TRUE, jsonb_build_object('station', 'barista')),
  ('DEV-PRINTER-KITCHEN', 'Kitchen printer (dev)', 'printer', '192.168.99.12'::inet, 9100, TRUE, jsonb_build_object('station', 'kitchen')),
  ('DEV-PRINTER-BAKERY',  'Bakery printer (dev)',  'printer', '192.168.99.13'::inet, 9100, TRUE, jsonb_build_object('station', 'bakery')),
  ('DEV-PRINTER-CASHIER', 'Cashier printer (dev)', 'printer', '192.168.99.14'::inet, 9100, TRUE, jsonb_build_object('station', 'cashier')),
  ('DEV-PRINTER-WAITER',  'Waiter printer (dev)',  'printer', '192.168.99.15'::inet, 9100, TRUE, jsonb_build_object('station', 'waiter'))
ON CONFLICT (code) DO NOTHING;
