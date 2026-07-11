-- pgTAP — get_pos_order_type_category_mix_v1 (Reports POS refonte, Lot E).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, and
-- the reconciliation guarantees — order-type revenue/orders sum back to both
-- the envelope totals AND the Overview RPC (shared scope), shares sum to ~100,
-- and category revenue is a positive composition over the same scope.

BEGIN;
SELECT plan(10);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_order_type_category_mix_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_order_type_category_mix_v1('2026-07-11','2026-05-01') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'totals' AND j ? 'by_order_type' AND j ? 'by_category' FROM r),
          'envelope exposes timezone/totals/by_order_type/by_category');
WITH r AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── by_order_type revenue sums to the envelope totals.revenue ─────────────
WITH r AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT COALESCE(SUM((t->>'revenue')::numeric),0)
     FROM r, jsonb_array_elements(j->'by_order_type') t),
  (SELECT (j->'totals'->>'revenue')::numeric FROM r),
  'sum(by_order_type.revenue) = totals.revenue');

-- ── by_order_type order_count sums to totals.orders ───────────────────────
WITH r AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT COALESCE(SUM((t->>'order_count')::int),0)::int
     FROM r, jsonb_array_elements(j->'by_order_type') t),
  (SELECT (j->'totals'->>'orders')::int FROM r),
  'sum(by_order_type.order_count) = totals.orders');

-- ── Cross-report reconciliation: mix totals = Overview (shared scope) ─────
WITH mix AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j),
ov  AS (SELECT get_pos_sales_overview_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT (j->'totals'->>'revenue')::numeric FROM mix),
  (SELECT (j->>'revenue')::numeric FROM ov),
  'mix totals.revenue reconciles exactly with Overview revenue');

-- ── Order-type shares sum to ~100 (rounding tolerance) ────────────────────
WITH r AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  (SELECT COALESCE(SUM((t->>'share_pct')::numeric),0)
     FROM r, jsonb_array_elements(j->'by_order_type') t) BETWEEN 99.5 AND 100.5,
  'order-type shares sum to ~100%');

-- ── Category revenue reconciles with an independent line-level recompute ──
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.id FROM orders o
   WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
     AND o.is_historical_import = false
     AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                     WHERE oi.order_id=o.id AND p.is_test=true)
     AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
         BETWEEN '2026-05-01' AND '2026-07-11'
),
recompute AS (
  SELECT COALESCE(SUM(oi.line_total),0) AS rev
    FROM order_items oi JOIN scoped s ON s.id=oi.order_id
   WHERE oi.is_cancelled = false AND oi.is_promo_gift = false
),
got AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT COALESCE(SUM((c->>'revenue')::numeric),0)
     FROM got, jsonb_array_elements(j->'by_category') c),
  (SELECT rev FROM recompute),
  'sum(by_category.revenue) matches an independent line-level recompute');

SELECT * FROM finish();
ROLLBACK;
