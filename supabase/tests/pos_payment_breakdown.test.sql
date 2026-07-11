-- pgTAP — get_pos_payment_breakdown_v1 (Reports POS refonte, Lot B).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, share
-- reconciliation (Σ share ≈ 100), and that the tendered total equals an
-- independent recomputation of order_payments over the same order scope as the
-- Overview (paid+completed, non-B2B, non-historical, no test-product line).

BEGIN;
SELECT plan(8);

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') $$,
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
  $$ SELECT get_pos_payment_breakdown_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_payment_breakdown_v1('2026-07-11','2026-05-14') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'total_amount' AND j ? 'total_orders'
             AND j ? 'total_tenders' AND j ? 'by_method' FROM r),
          'envelope exposes timezone/total_amount/total_orders/total_tenders/by_method');
WITH r AS (SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── Shares reconcile to ~100 (allowing rounding when any tender exists) ────
WITH r AS (SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') AS j),
sums AS (
  SELECT (SELECT (r.j->>'total_amount')::numeric FROM r) AS total,
         COALESCE((SELECT SUM((e->>'share_pct')::numeric)
                   FROM r, jsonb_array_elements(r.j->'by_method') e), 0) AS share_sum
)
SELECT ok(total = 0 OR abs(share_sum - 100) <= 0.5,
          'share_pct across methods reconciles to ~100 when there are tenders')
FROM sums;

-- ── Tendered total equals independent recomputation over the same scope ───
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.id FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
expected AS (
  SELECT COALESCE(SUM(op.amount),0) tendered
  FROM order_payments op JOIN scoped s ON s.id = op.order_id
),
got AS (SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->>'total_amount')::numeric FROM got), (SELECT tendered FROM expected),
          'tendered total matches independent recomputation over Overview scope');

WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.id FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_payment_breakdown_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->>'total_orders')::int FROM got), (SELECT COUNT(*)::int FROM scoped),
          'total_orders matches the scoped order count');

SELECT * FROM finish();
ROLLBACK;
