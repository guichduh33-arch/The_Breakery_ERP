-- 20260619000021_harden_views_security_invoker.sql
-- Security hardening (security-fraud-guard audit 2026-05-31, Pattern #9 / checklist D).
--
-- GAP 6 — PII/financial views run with the owner's rights, bypassing caller RLS.
-- view_b2b_invoices and view_ar_aging were created with migration comments implying
-- SECURITY INVOKER, but pg_class.reloptions is NULL on both (verified live), so they
-- execute as their owner (postgres) and a caller sees rows their own RLS would deny.
-- Both views project customer + financial data (AR aging, outstanding invoices).
--
-- Fix: set security_invoker=on (PG15+) so the view respects the caller's RLS and
-- column grants. The underlying tables (orders, customers, b2b_payments) already
-- grant the right SELECT to `authenticated`, so legitimate BackOffice reads are
-- unaffected; anon — already revoked at the table level — now also cannot leak
-- through the views.

ALTER VIEW public.view_b2b_invoices SET (security_invoker = on);
ALTER VIEW public.view_ar_aging     SET (security_invoker = on);
