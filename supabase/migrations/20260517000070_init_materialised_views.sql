-- 20260517000070_init_materialised_views.sql
-- Session 13 / Phase 2.B / migration 1 :
--   Create 3 materialised views (mv_sales_daily, mv_stock_variance,
--   mv_pl_monthly) that back the BO reports module.
--
-- Each MV has a UNIQUE index so it can be refreshed via
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY` (cf. migration 000071 which
-- schedules the refresh via pg_cron).
--
-- Source of truth :
--   orders.paid_at (TIMESTAMPTZ, present only on paid orders ; we filter
--   status='paid'). Bucketing always converts to the business timezone
--   (`business_config.timezone`, default 'Asia/Makassar').
--
-- Plan ref : docs/workplan/plans/2026-05-13-session-13-phase-2.B-reports-infra.md §1.C

-- ============================================================
-- 1) mv_sales_daily — one row per business-local date
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_sales_daily AS
WITH cfg AS (
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
    FROM business_config WHERE id = 1
)
SELECT
  ((o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date                AS business_date,
  SUM(o.total)::DECIMAL(14,2)                                          AS total_sales,
  COUNT(*)::INT                                                        AS total_orders,
  CASE WHEN COUNT(*) > 0
       THEN (SUM(o.total) / COUNT(*))::DECIMAL(14,2)
       ELSE 0::DECIMAL(14,2) END                                       AS avg_basket
FROM orders o
WHERE o.status = 'paid'
  AND o.paid_at IS NOT NULL
  AND o.voided_at IS NULL
GROUP BY business_date;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_sales_daily_pk
  ON mv_sales_daily (business_date);

COMMENT ON MATERIALIZED VIEW mv_sales_daily IS
  'Phase 2.B — Daily revenue rollup (paid orders, voided excluded, bucketed by '
  'business_config.timezone). Refresh hourly via pg_cron job refresh-mv-sales-daily.';

-- ============================================================
-- 2) mv_stock_variance — one row per product (snapshot, all-time)
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_stock_variance AS
SELECT
  p.id                                                                 AS product_id,
  p.name                                                               AS product_name,
  p.sku                                                                AS sku,
  COALESCE(SUM(CASE WHEN sm.movement_type IN ('purchase','incoming','production_in')
                    THEN sm.quantity ELSE 0 END), 0)::DECIMAL(12,3)    AS opened,
  COALESCE(SUM(CASE WHEN sm.movement_type IN ('sale','sale_void')
                    THEN sm.quantity ELSE 0 END), 0)::DECIMAL(12,3)    AS sold,
  COALESCE(SUM(CASE WHEN sm.movement_type IN
                         ('adjustment','adjustment_in','adjustment_out',
                          'waste','opname_in','opname_out',
                          'production_out','purchase_return')
                    THEN sm.quantity ELSE 0 END), 0)::DECIMAL(12,3)    AS adjusted,
  p.current_stock                                                      AS current_qty,
  COALESCE(SUM(sm.quantity), 0)::DECIMAL(12,3)                         AS expected,
  (p.current_stock - COALESCE(SUM(sm.quantity), 0))::DECIMAL(12,3)     AS variance
FROM products p
LEFT JOIN stock_movements sm ON sm.product_id = p.id
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.name, p.sku, p.current_stock;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_stock_variance_pk
  ON mv_stock_variance (product_id);

COMMENT ON MATERIALIZED VIEW mv_stock_variance IS
  'Phase 2.B — Per-product variance snapshot (all-time SUM of stock_movements vs '
  'current_stock cache). Refresh every 15m via pg_cron.';

-- ============================================================
-- 3) mv_pl_monthly — one row per business-local month
-- ============================================================
-- Revenue is sourced directly from orders.total (NOT from journal_entries) so
-- this MV is decoupled from the JE accounting layer. COGS is sourced from
-- journal_entry_lines posted to any account of class 5 (COGS), summed by
-- entry_date month.

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_pl_monthly AS
WITH cfg AS (
  SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
    FROM business_config WHERE id = 1
),
revenue AS (
  SELECT
    date_trunc('month', (o.paid_at AT TIME ZONE (SELECT tz FROM cfg)))::date AS month,
    SUM(o.total)::DECIMAL(14,2)                                              AS revenue
  FROM orders o
  WHERE o.status = 'paid'
    AND o.paid_at IS NOT NULL
    AND o.voided_at IS NULL
  GROUP BY 1
),
cogs AS (
  SELECT
    date_trunc('month', je.entry_date)::date         AS month,
    SUM(jel.debit)::DECIMAL(14,2)                    AS cogs
  FROM journal_entry_lines jel
  JOIN journal_entries je    ON je.id = jel.journal_entry_id
  JOIN accounts        a     ON a.id  = jel.account_id
  WHERE a.account_class = 5
    AND je.status IN ('posted','locked')
  GROUP BY 1
)
SELECT
  COALESCE(r.month, c.month)                                       AS month,
  COALESCE(r.revenue, 0)::DECIMAL(14,2)                            AS revenue,
  COALESCE(c.cogs,    0)::DECIMAL(14,2)                            AS cogs,
  (COALESCE(r.revenue, 0) - COALESCE(c.cogs, 0))::DECIMAL(14,2)    AS gross_profit
FROM revenue r
FULL OUTER JOIN cogs c ON c.month = r.month;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_pl_monthly_pk
  ON mv_pl_monthly (month);

COMMENT ON MATERIALIZED VIEW mv_pl_monthly IS
  'Phase 2.B — Monthly P&L (revenue from orders, COGS from journal_entry_lines on '
  'class-5 accounts). Refresh nightly at 02:00 via pg_cron.';

-- ============================================================
-- Grants — authenticated users can SELECT all 3 MVs
-- ============================================================
GRANT SELECT ON mv_sales_daily    TO authenticated;
GRANT SELECT ON mv_stock_variance TO authenticated;
GRANT SELECT ON mv_pl_monthly     TO authenticated;
