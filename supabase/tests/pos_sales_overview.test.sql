-- pgTAP — get_pos_sales_overview_v1 (Reports POS refonte, Lot A).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guard, envelope shape/timezone, and that
-- the aggregate equals an independent recomputation of the same filter (paid+
-- completed, non-B2B, non-historical, no test-product line) over live data.

BEGIN;
SELECT plan(8);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') $$,
  '42501',
  NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_sales_overview_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_sales_overview_v1('2026-07-11','2026-05-14') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') AS j)
SELECT ok((SELECT j ? 'revenue' AND j ? 'tax' AND j ? 'orders'
             AND j ? 'avg_basket' AND j ? 'sales_by_hour' FROM r),
          'envelope exposes revenue/tax/orders/avg_basket/sales_by_hour');
WITH r AS (SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');
WITH r AS (SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT jsonb_array_length(j->'sales_by_hour') FROM r), 24,
          'sales_by_hour is a full 0..23 axis');

-- ── Aggregate equals independent recomputation of the same filter ─────────
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
expected AS (
  SELECT COALESCE(SUM(o.total),0) rev, COALESCE(SUM(o.tax_amount),0) tax, COUNT(*)::int ord
  FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->>'orders')::int FROM got), (SELECT ord FROM expected),
          'orders match independent recomputation');
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
expected AS (
  SELECT COALESCE(SUM(o.total),0) rev
  FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_sales_overview_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->>'revenue')::numeric FROM got), (SELECT rev FROM expected),
          'revenue (TTC) matches independent recomputation');

SELECT * FROM finish();
ROLLBACK;
