-- supabase/tests/security_leak_guard.test.sql
-- Session 50 / pgTAP — Security leak guard tests.
--
-- Couvre :
--   T1–T3  : MVs inaccessibles à authenticated (W1.5)
--   T4–T6  : Vues security_invoker (W1.5)
--   T7–T9  : search_path hardening SECURITY DEFINER (W1.6)
--   T10–T11: _resolve_dispatch_stations_v1 non callable par authenticated (W1.1)
--   T12    : b2b.read seeded (W1.3)
--   T13    : settings.security.manage seeded (W1.3)
--
-- Exécution : mcp__plugin_supabase_supabase__execute_sql avec BEGIN/ROLLBACK.
-- DEV-S50-pgTAP-leaks

BEGIN;
SELECT plan(13);

-- ============================================================
-- T1–T3 : MVs — authenticated ne peut pas SELECT
-- ============================================================

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_sales_daily LIMIT 1;
  $$,
  'T1 — mv_sales_daily inaccessible à authenticated'
);

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_stock_variance LIMIT 1;
  $$,
  'T2 — mv_stock_variance inaccessible à authenticated'
);

SELECT throws_ok(
  $$
    SET LOCAL ROLE authenticated;
    SELECT 1 FROM mv_pl_monthly LIMIT 1;
  $$,
  'T3 — mv_pl_monthly inaccessible à authenticated'
);

-- ============================================================
-- T4–T6 : Vues security_invoker actif
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'audit_log'
      AND c.reloptions @> ARRAY['security_invoker=on']
  ),
  'T4 — audit_log security_invoker=on'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'v_product_available_stock'
      AND c.reloptions @> ARRAY['security_invoker=on']
  ),
  'T5 — v_product_available_stock security_invoker=on'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'view_product_allergens_resolved'
      AND c.reloptions @> ARRAY['security_invoker=on']
  ),
  'T6 — view_product_allergens_resolved security_invoker=on'
);

-- ============================================================
-- T7–T9 : search_path hardening sur SECURITY DEFINER
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_customer_product_price'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T7 — get_customer_product_price search_path set'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_margin_alerts_ack_only'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T8 — enforce_margin_alerts_ack_only search_path set'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'next_expense_number'
      AND p.prosecdef = true
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ),
  'T9 — next_expense_number search_path set'
);

-- ============================================================
-- T10–T11 : _resolve_dispatch_stations_v1 — REVOKE authenticated
-- ============================================================

SELECT ok(
  NOT has_function_privilege('authenticated', 'public._resolve_dispatch_stations_v1(uuid)', 'EXECUTE'),
  'T10 — authenticated cannot EXECUTE _resolve_dispatch_stations_v1'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public._resolve_dispatch_stations_v1(uuid)', 'EXECUTE'),
  'T11 — anon cannot EXECUTE _resolve_dispatch_stations_v1'
);

-- ============================================================
-- T12–T13 : Permissions seedées W1.3
-- ============================================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM permissions WHERE code = 'b2b.read'
  ),
  'T12 — permission b2b.read seedée'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM permissions WHERE code = 'settings.security.manage'
  ),
  'T13 — permission settings.security.manage seedée'
);

SELECT * FROM finish();
ROLLBACK;
