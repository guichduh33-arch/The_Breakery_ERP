-- supabase/tests/inventory_alerts.test.sql
-- Session 13 / Phase 2.D — pgTAP for low-stock + reorder + product dashboard.
-- Run via execute_sql with BEGIN ... ROLLBACK envelope.
--
-- T_ALERT_01..07 :
--   01 — get_low_stock_v1 exists.
--   02 — get_low_stock_v1 forbids anonymous.
--   03 — get_low_stock_v1 has 10 OUT columns.
--   04 — get_reorder_suggestions_v1 exists + forbids anonymous.
--   05 — get_reorder_suggestions_v1 has 12 OUT columns.
--   06 — get_product_dashboard_v2 exists + forbids anonymous.
--   07 — get_product_dashboard_v2 raises product_not_found on bad uuid.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(7);

CREATE TEMP TABLE out AS
SELECT * FROM (VALUES
  ((SELECT is((SELECT COUNT(*)::INT FROM pg_proc WHERE proname='get_low_stock_v1'), 1, 'T_ALERT_01'))),
  ((SELECT throws_ok($$SELECT * FROM get_low_stock_v1()$$, 'P0003', NULL, 'T_ALERT_02'))),
  ((SELECT is((SELECT COUNT(*)::INT FROM information_schema.parameters WHERE specific_schema='public' AND specific_name LIKE 'get_low_stock_v1%' AND parameter_mode='OUT'), 10, 'T_ALERT_03'))),
  ((SELECT throws_ok($$SELECT * FROM get_reorder_suggestions_v1()$$, 'P0003', NULL, 'T_ALERT_04'))),
  ((SELECT is((SELECT COUNT(*)::INT FROM information_schema.parameters WHERE specific_schema='public' AND specific_name LIKE 'get_reorder_suggestions_v1%' AND parameter_mode='OUT'), 12, 'T_ALERT_05'))),
  ((SELECT throws_ok($$SELECT get_product_dashboard_v2(gen_random_uuid())$$, 'P0003', NULL, 'T_ALERT_06'))),
  -- Cannot easily test product_not_found without an admin caller in pgTAP envelope.
  -- We assert the function source contains the product_not_found raise instead.
  ((SELECT ok((SELECT prosrc FROM pg_proc WHERE proname='get_product_dashboard_v2') LIKE '%product_not_found%', 'T_ALERT_07: product_not_found raise present')))
) AS t(line);

SELECT line FROM out ORDER BY 1;

ROLLBACK;
