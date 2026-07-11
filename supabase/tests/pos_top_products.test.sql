-- pgTAP — get_pos_top_products_v1 (Reports POS refonte, Lot F).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, that
-- product revenue shares sum back to the total, the list is sorted DESC, and
-- the cross-report reconciliation — sum(products.revenue) equals the Mix
-- by_category revenue exactly (shared line-level scope).

BEGIN;
SELECT plan(9);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_top_products_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_top_products_v1('2026-07-11','2026-05-01') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'total_revenue' AND j ? 'products' FROM r),
          'envelope exposes timezone/total_revenue/products');
WITH r AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── Product revenue sums back to the envelope total_revenue ───────────────
WITH r AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT COALESCE(SUM((p->>'revenue')::numeric),0)
     FROM r, jsonb_array_elements(j->'products') p),
  (SELECT (j->>'total_revenue')::numeric FROM r),
  'sum(products.revenue) = total_revenue');

-- ── Products are sorted by revenue DESC ───────────────────────────────────
WITH r AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j),
arr AS (
  SELECT p, ROW_NUMBER() OVER () AS rn
    FROM r, jsonb_array_elements(j->'products') p
)
SELECT ok(
  COALESCE(bool_and(
    (SELECT (a.p->>'revenue')::numeric) >= (SELECT (b.p->>'revenue')::numeric)
  ), true),
  'products list is ordered by revenue DESC')
FROM arr a JOIN arr b ON b.rn = a.rn + 1;

-- ── Shares sum to ~100 when there is any revenue ──────────────────────────
WITH r AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j)
SELECT ok(
  (SELECT (j->>'total_revenue')::numeric FROM r) = 0
  OR (SELECT COALESCE(SUM((p->>'share_pct')::numeric),0)
        FROM r, jsonb_array_elements(j->'products') p) BETWEEN 99.0 AND 101.0,
  'product shares sum to ~100% (or no revenue)');

-- ── Cross-report reconciliation: products revenue = Mix by_category revenue ─
WITH tp AS (SELECT get_pos_top_products_v1('2026-05-01','2026-07-11') AS j),
mix AS (SELECT get_pos_order_type_category_mix_v1('2026-05-01','2026-07-11') AS j)
SELECT is(
  (SELECT COALESCE(SUM((p->>'revenue')::numeric),0)
     FROM tp, jsonb_array_elements(j->'products') p),
  (SELECT COALESCE(SUM((c->>'revenue')::numeric),0)
     FROM mix, jsonb_array_elements(j->'by_category') c),
  'sum(products.revenue) reconciles with Mix by_category revenue (shared scope)');

SELECT * FROM finish();
ROLLBACK;
