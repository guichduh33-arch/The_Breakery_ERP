-- pgTAP — get_pos_voids_refunds_v1 (Reports POS refonte, Lot C).
-- Run via MCP execute_sql inside a BEGIN … ROLLBACK envelope (Docker retired).
-- Verifies: permission gate, date-range guards, envelope shape/timezone, the
-- discounts block reconciliation (total + order_count + comp_count over the same
-- order scope as the Overview), and — via a seeded full-void refund on an
-- in-scope order — that the reversals aggregation counts and sums correctly.

BEGIN;
SELECT plan(10);

-- ── Seed a full-void refund on an in-scope order (as owner, before role switch) ─
INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                     reason, refunded_by, authorized_by, is_full_void)
SELECT 'R-PGTAP-9999', o.id, o.session_id, 12345, 1111,
       'pgtap seeded void', '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-000000000001', true
FROM orders o
WHERE o.order_type <> 'b2b'
  AND o.is_historical_import = false
  AND o.session_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                  WHERE oi.order_id=o.id AND p.is_test)
ORDER BY o.created_at DESC
LIMIT 1;

-- ── Gate: anon (no auth.uid()) is denied ──────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') $$,
  '42501', NULL,
  'anon / no-perm caller is denied (reports.sales.read)'
);

-- ── Impersonate an owner holding reports.sales.read ───────────────────────
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-000000000001')::text, true);
SET LOCAL role authenticated;

-- ── Date-range guards ─────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT get_pos_voids_refunds_v1(NULL, '2026-07-11') $$, 'P0001', NULL,
  'NULL start date raises P0001');
SELECT throws_ok(
  $$ SELECT get_pos_voids_refunds_v1('2026-07-11','2026-05-14') $$, 'P0001', NULL,
  'start > end raises invalid_date_range');

-- ── Envelope shape + timezone ─────────────────────────────────────────────
WITH r AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT ok((SELECT j ? 'timezone' AND j ? 'reversals' AND j ? 'discounts' FROM r),
          'envelope exposes timezone/reversals/discounts');
WITH r AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT j->>'timezone' FROM r), 'Asia/Makassar',
          'timezone is the business tz (WITA)');

-- ── Discounts reconcile with an independent recompute over Overview scope ──
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.discount_amount, o.discount_type, o.discount_value FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false AND COALESCE(o.discount_amount,0) > 0
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->'discounts'->>'total_amount')::numeric FROM got),
          (SELECT COALESCE(SUM(discount_amount),0) FROM scoped),
          'discounts.total_amount matches independent recompute');

WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.id FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false AND COALESCE(o.discount_amount,0) > 0
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->'discounts'->>'order_count')::int FROM got),
          (SELECT COUNT(*)::int FROM scoped),
          'discounts.order_count matches the scoped order count');

-- ── comp_count matches percentage>=100 discounts over the scope ────────────
WITH tz AS (SELECT COALESCE(MAX(timezone),'Asia/Makassar') v FROM business_config WHERE id=1),
scoped AS (
  SELECT o.discount_type, o.discount_value FROM orders o
  WHERE o.status IN ('paid','completed') AND o.order_type <> 'b2b'
    AND o.is_historical_import = false AND COALESCE(o.discount_amount,0) > 0
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN products p ON p.id=oi.product_id
                    WHERE oi.order_id=o.id AND p.is_test)
    AND ((COALESCE(o.paid_at,o.created_at) AT TIME ZONE (SELECT v FROM tz))::date)
        BETWEEN '2026-05-14' AND '2026-07-11'
),
got AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->'discounts'->>'comp_count')::int FROM got),
          (SELECT COUNT(*)::int FROM scoped WHERE discount_type='percentage' AND discount_value >= 100),
          'discounts.comp_count matches percentage>=100 discounts');

-- ── Seeded full-void is aggregated in reversals.voids ─────────────────────
WITH got AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->'reversals'->'voids'->>'count')::int FROM got), 1,
          'seeded full-void is counted in reversals.voids.count');
WITH got AS (SELECT get_pos_voids_refunds_v1('2026-05-14','2026-07-11') AS j)
SELECT is((SELECT (j->'reversals'->'voids'->>'amount')::numeric FROM got), 12345::numeric,
          'seeded full-void amount is summed in reversals.voids.amount');

SELECT * FROM finish();
ROLLBACK;
