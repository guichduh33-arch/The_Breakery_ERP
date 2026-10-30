-- supabase/tests/s40_reports.test.sql
-- S40 Wave A — pgTAP suite (26 assertions T1-T22, T23-T24 lot I 2026-08-15,
-- T25-T26 bump get_daily_sales_v3 du 2026-08-21).
--
-- Covers:
--   T1  : INSERT role_permissions → audit_logs row action='role.permission_granted'
--   T2  : DELETE role_permissions → audit_logs row action='role.permission_revoked'
--   T3  : get_daily_sales_v3 CASHIER → 42501 (no reports.sales.read)
--   T4  : get_daily_sales_v3 MANAGER happy path → summary.order_count = 2, by_day length = 2
--   T5  : get_daily_sales_v3 refunds deducted in net (net = gross - refund)
--   T6  : get_purchase_items_v1 CASHIER → 42501
--   T7  : get_purchase_items_v1 MANAGER → 2 lines returned; p_supplier_id filter scopes correctly
--   T8  : get_purchase_by_date_v1 CASHIER → 42501
--   T9  : get_purchase_by_date_v1 MANAGER → summary.po_count = 1
--   T10 : get_purchase_by_supplier_v2 CASHIER → 42501
--   T11 : get_purchase_by_supplier_v2 MANAGER → share_pct = 100 for single supplier
--   T12 : get_daily_sales_v3 end < start → P0001
--   T13 : get_staff_performance_v1 CASHIER → 42501
--   T14 : get_staff_performance_v1 MANAGER → cashier row orders_served >= 2 ; manager row voids_count >= 1
--   T15 : get_production_report_v1 CASHIER → 42501
--   T16 : get_production_report_v1 MANAGER (isolated past window) → total_produced = 10
--   T17 : get_production_efficiency_v1 CASHIER → 42501
--   T18 : get_production_efficiency_v1 MANAGER → waste_rate_pct = 16.67, avg_yield_variance_pct = -10
--   T19 : get_price_changes_v1 CASHIER → 42501
--   T20 : get_price_changes_v1 MANAGER → LAG correct (old 1000 → new 1500, delta 50) + p_product_id filter
--   T21 : get_permission_changes_v3 CASHIER → 42501 (gate reports.audit.read, MANAGER+ — corrective _021)
--   T22 : get_permission_changes_v3 MANAGER → finds the T2 revoked row
--   T23 : get_daily_sales_v3 MANAGER → summary.discount_total/discount_orders_count present,
--         voids_count/voids_value cover the T14 seeded void (ORD-S40-VOID-001, total 33000)
--   T24 : get_daily_sales_v3 MANAGER → sessions is a non-empty jsonb array, contains the
--         seeded session with cashier name resolved
--   T25 : get_daily_sales_v3 settlement split RECONCILES — summary.total =
--         tendered_total + on_account_total AND order_count =
--         tendered_order_count + on_account_order_count
--   T26 : a B2B order settled on the AR ledger (no order_payments row) lands on the
--         on_account side, and leaves the tendered side untouched
--
-- Seeded users (from seed.sql):
--   SUPER_ADMIN : auth_user_id = 00000000-0000-0000-0000-000000000001 (EMP000)
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004  (EMP003, MANAGER role)
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002  (EMP001, CASHIER role)
--
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK — self-cleaning.

BEGIN;
\ir helpers/s40_reports_cases_01.sql
\ir helpers/s40_reports_cases_02.sql
\ir helpers/s40_reports_cases_03.sql
ROLLBACK;
