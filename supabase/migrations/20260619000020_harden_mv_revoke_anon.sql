-- 20260619000020_harden_mv_revoke_anon.sql
-- Security hardening (security-fraud-guard audit 2026-05-31, Pattern #9 / checklist D).
--
-- GAP 5 — materialized views leak to anon.
-- The S20 anon/PUBLIC sweep (20260524000020..031) used `REVOKE … ON ALL TABLES`,
-- which does NOT cover relkind='m' (materialized views). As a result
-- mv_sales_daily / mv_pl_monthly / mv_stock_variance remained SELECT-able by
-- `anon` (verified live: has_table_privilege('anon','mv_sales_daily','SELECT')=true).
-- A materialized view does not enforce RLS, so this is an unauthenticated read of
-- aggregated sales / P&L / stock-variance figures.
--
-- Fix: REVOKE ALL FROM anon, PUBLIC on each MV. `authenticated` keeps SELECT
-- (the BackOffice reports read these through SECURITY DEFINER report RPCs that run
-- as owner; keeping authenticated SELECT is harmless and avoids breaking a future
-- direct read). service_role is unaffected.

REVOKE ALL ON public.mv_sales_daily    FROM anon, PUBLIC;
REVOKE ALL ON public.mv_pl_monthly     FROM anon, PUBLIC;
REVOKE ALL ON public.mv_stock_variance FROM anon, PUBLIC;
